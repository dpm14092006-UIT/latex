package service

import (
	"context"
	"errors"
	"io"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"
)

// TeX Live spend a large share of a small compile just starting the
// process and loading the format. A warm XeLaTeX has already done that and is
// parked at TeX's "**" prompt; handing it the file name starts typesetting
// immediately. Warm processes always run with -no-pdf; xdvipdfmx follows.

var errWarmUnavailable = errors.New("warm xelatex unavailable")

const (
	maxWarmIdle     = 2
	maxWarmIdleTime = 10 * time.Minute
	// Auto mode releases every idle process after this long without a compile.
	warmReleaseAfter = 10 * time.Minute
	// Idle processes are dropped and not refilled while free RAM is below this.
	warmMinFreeMemory = uint64(1 << 30)
)

// warmConfig comes from VIETLATEX_WARM_TEX:
//   - "auto" (default): no processes at startup; the first compile turns the
//     pool on and it switches itself off after warmReleaseAfter of inactivity.
//   - "1" or "2": auto mode with that many idle processes at most.
//   - "eager": start 2 idle processes at launch and keep them (old behavior).
//   - "0" or "off": never keep warm processes. Docker sandbox forces this.
type warmConfig struct {
	mode string
	size int
}

func currentWarmConfig() warmConfig {
	if os.Getenv("VIETLATEX_SANDBOX") == "docker" {
		return warmConfig{mode: "off"}
	}
	switch value := strings.ToLower(strings.TrimSpace(os.Getenv("VIETLATEX_WARM_TEX"))); value {
	case "0", "off":
		return warmConfig{mode: "off"}
	case "1":
		return warmConfig{mode: "auto", size: 1}
	case "eager":
		return warmConfig{mode: "eager", size: maxWarmIdle}
	default:
		return warmConfig{mode: "auto", size: maxWarmIdle}
	}
}

type warmTeX struct {
	cmd       *exec.Cmd
	stdin     io.WriteCloser
	stdout    *limitedBuffer
	stderr    *limitedBuffer
	directory string
	started   time.Time
	exited    chan struct{}
	waitErr   error
	kill      func()
}

func warmEnabled() bool {
	return currentWarmConfig().mode != "off"
}

func spawnWarmXeLatex(directory string) (*warmTeX, error) {
	executable, err := findXeLatex()
	if err != nil {
		return nil, err
	}
	args := []string{"-interaction=nonstopmode", "-halt-on-error", "-file-line-error", "-no-shell-escape", "-no-pdf", "-output-directory", directory}
	command := exec.Command(executable, args...)
	command.Dir = directory
	configureCommand(command)
	stdin, err := command.StdinPipe()
	if err != nil {
		return nil, err
	}
	warm := &warmTeX{cmd: command, stdin: stdin, stdout: &limitedBuffer{max: 4 << 20}, stderr: &limitedBuffer{max: 4 << 20}, directory: directory, started: time.Now(), exited: make(chan struct{})}
	command.Stdout = warm.stdout
	command.Stderr = warm.stderr
	if err := command.Start(); err != nil {
		return nil, err
	}
	warm.kill = func() { _ = killCommandGroup(command) }
	go func() {
		warm.waitErr = command.Wait()
		close(warm.exited)
	}()
	return warm, nil
}

// run typesets document.tex in the warm process's directory. It returns
// errWarmUnavailable when the process died before use so callers can fall
// back to a cold start.
func (w *warmTeX) run(ctx context.Context, timeout time.Duration) error {
	select {
	case <-w.exited:
		return errWarmUnavailable
	default:
	}
	_, writeErr := io.WriteString(w.stdin, "document.tex\n")
	_ = w.stdin.Close()
	if writeErr != nil {
		w.discard()
		return errWarmUnavailable
	}
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case <-w.exited:
	case <-ctx.Done():
		w.discard()
		return errClientCancelled
	case <-timer.C:
		w.discard()
		return &commandError{timeout: true, output: joinOutput(w.stdout.data, w.stderr.data)}
	}
	if w.waitErr == nil {
		return nil
	}
	return &commandError{output: joinOutput(w.stdout.data, w.stderr.data), cause: w.waitErr}
}

func (w *warmTeX) discard() {
	w.kill()
	<-w.exited
}

// warmPool keeps a few idle XeLaTeX processes, each in its own empty
// temporary directory that the next compile adopts. Its size follows the warm
// mode, the current compile worker limit and free memory.
type warmPool struct {
	mu          sync.Mutex
	spawnWG     sync.WaitGroup
	idle        []*warmTeX
	config      warmConfig
	workerLimit int
	active      bool
	lowMemory   bool
	lastUse     time.Time
	spawning    int
	closed      bool
	hits        int
	misses      int
	released    int
	spawn       func() (*warmTeX, string)
}

type warmPoolStats struct {
	mode                                           string
	active                                         bool
	idle, target, spawning, hits, misses, released int
}

func newWarmPool(config warmConfig) *warmPool {
	return &warmPool{config: config, workerLimit: config.size, spawn: spawnInNewDirectory}
}

// targetLocked is how many idle processes the pool should hold right now.
func (p *warmPool) targetLocked() int {
	if p.closed || p.config.mode == "off" || !p.active || p.lowMemory {
		return 0
	}
	return max(0, min(p.config.size, p.workerLimit))
}

// startup prewarms only in eager mode; auto mode waits for the first compile.
func (p *warmPool) startup() {
	p.mu.Lock()
	if p.config.mode == "eager" {
		p.active = true
	}
	p.mu.Unlock()
	p.refill()
}

// take returns a warm process (and its directory) or nil, then refills.
func (p *warmPool) take() *warmTeX {
	if p.config.mode == "off" {
		return nil
	}
	var stale []*warmTeX
	var found *warmTeX
	p.mu.Lock()
	p.active = true
	p.lastUse = time.Now()
	for len(p.idle) > 0 && found == nil {
		last := p.idle[len(p.idle)-1]
		p.idle = p.idle[:len(p.idle)-1]
		if !last.usable(time.Now()) {
			stale = append(stale, last)
			continue
		}
		found = last
	}
	if found != nil {
		p.hits++
	} else {
		p.misses++
	}
	p.mu.Unlock()
	discardAll(stale)
	p.refill()
	return found
}

func (w *warmTeX) usable(now time.Time) bool {
	select {
	case <-w.exited:
		return false
	default:
	}
	return now.Sub(w.started) <= maxWarmIdleTime
}

func (p *warmPool) refill() {
	p.mu.Lock()
	needed := p.targetLocked() - len(p.idle) - p.spawning
	if needed <= 0 {
		p.mu.Unlock()
		return
	}
	p.spawning += needed
	p.spawnWG.Add(needed)
	spawn := p.spawn
	p.mu.Unlock()
	for range needed {
		go func() {
			defer p.spawnWG.Done()
			warm, directory := spawn()
			p.mu.Lock()
			p.spawning--
			keep := warm != nil && len(p.idle) < p.targetLocked()
			if keep {
				p.idle = append(p.idle, warm)
			}
			p.mu.Unlock()
			if !keep {
				if warm != nil {
					warm.discard()
				}
				if directory != "" {
					_ = os.RemoveAll(directory)
				}
			}
		}()
	}
}

// setWorkerLimit caps the pool at the compile worker limit; extra idle
// processes beyond the new target are discarded.
func (p *warmPool) setWorkerLimit(limit int) {
	p.mu.Lock()
	p.workerLimit = limit
	excess := p.trimLocked(time.Now())
	p.mu.Unlock()
	discardAll(excess)
	p.refill()
}

// maintain runs periodically: it records memory pressure, switches auto mode
// off after inactivity, drops dead/expired/excess processes and refills.
func (p *warmPool) maintain(now time.Time, availableBytes uint64) {
	p.mu.Lock()
	p.lowMemory = availableBytes > 0 && availableBytes < warmMinFreeMemory
	if p.config.mode == "auto" && p.active && now.Sub(p.lastUse) > warmReleaseAfter {
		p.active = false
		p.released++
	}
	drop := p.trimLocked(now)
	p.mu.Unlock()
	discardAll(drop)
	p.refill()
}

func (p *warmPool) trimLocked(now time.Time) []*warmTeX {
	var drop []*warmTeX
	kept := p.idle[:0]
	for _, item := range p.idle {
		if item.usable(now) {
			kept = append(kept, item)
		} else {
			drop = append(drop, item)
		}
	}
	if target := p.targetLocked(); len(kept) > target {
		drop = append(drop, kept[target:]...)
		kept = kept[:target]
	}
	p.idle = kept
	return drop
}

func discardAll(items []*warmTeX) {
	for _, item := range items {
		item.discard()
		_ = os.RemoveAll(item.directory)
	}
}

func spawnInNewDirectory() (*warmTeX, string) {
	directory, err := os.MkdirTemp("", "viet-latex-")
	if err != nil {
		return nil, ""
	}
	warm, err := spawnWarmXeLatex(directory)
	if err != nil {
		return nil, directory
	}
	return warm, directory
}

func (p *warmPool) close() {
	p.mu.Lock()
	p.closed = true
	idle := p.idle
	p.idle = nil
	p.mu.Unlock()
	discardAll(idle)
	// A spawn already in progress must discard its process and directory
	// before shutdown returns. No new Add can occur once closed is set.
	p.spawnWG.Wait()
}

func (p *warmPool) stats() warmPoolStats {
	p.mu.Lock()
	defer p.mu.Unlock()
	return warmPoolStats{mode: p.config.mode, active: p.active, idle: len(p.idle), target: p.targetLocked(), spawning: p.spawning, hits: p.hits, misses: p.misses, released: p.released}
}
