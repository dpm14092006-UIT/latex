package service

import (
	"os"
	"runtime"
	"sync"
	"time"
)

const (
	maintenanceInterval = 5 * time.Second
	// Memory one running XeLaTeX worker holds in the local load profile. Active
	// workers are added back to free memory so the backend does not shrink
	// just because its own compiles are using RAM.
	workerMemoryEstimate = uint64(250 << 20)
	criticalFreeMemory   = uint64(256 << 20)
	// Consecutive samples needed before changing the limit. Shrinking reacts
	// faster than growing; growth moves one worker at a time.
	shrinkAfterSamples = 2
	growAfterSamples   = 3
)

// workerController resizes the compile worker limit from free memory.
// VIETLATEX_COMPILE_WORKERS fixes the limit; VIETLATEX_ADAPTIVE_WORKERS=0
// keeps the startup value.
type workerController struct {
	mu         sync.Mutex
	cpus       int
	initial    int
	adaptive   bool
	shrinkSeen int
	growSeen   int
	lastTarget int
	changes    int
}

func newWorkerController() *workerController {
	cpus := runtime.NumCPU()
	if fixed, ok := compileWorkerOverride(); ok {
		return &workerController{cpus: cpus, initial: fixed, lastTarget: fixed}
	}
	initial := defaultCompileWorkerCount(cpus, availableMemoryBytes())
	return &workerController{cpus: cpus, initial: initial, lastTarget: initial, adaptive: os.Getenv("VIETLATEX_ADAPTIVE_WORKERS") != "0"}
}

// observe returns the next worker limit and whether it changed.
func (c *workerController) observe(current, active int, availableBytes uint64) (int, bool) {
	if !c.adaptive || availableBytes == 0 {
		return current, false
	}
	target := defaultCompileWorkerCount(c.cpus, availableBytes+uint64(max(0, active))*workerMemoryEstimate)
	// Under severe pressure, adding active workers back must not hide the
	// lack of memory available to the next process.
	if availableBytes < criticalFreeMemory {
		target = 1
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.lastTarget = target
	next := c.stepLocked(current, target)
	if next != current {
		c.changes++
	}
	return next, next != current
}

func (c *workerController) stepLocked(current, target int) int {
	switch {
	case target < current:
		c.growSeen = 0
		c.shrinkSeen++
		if c.shrinkSeen >= shrinkAfterSamples {
			c.shrinkSeen = 0
			return target
		}
	case target > current:
		c.shrinkSeen = 0
		c.growSeen++
		if c.growSeen >= growAfterSamples {
			c.growSeen = 0
			return current + 1
		}
	default:
		c.shrinkSeen, c.growSeen = 0, 0
	}
	return current
}

func (c *workerController) stats(limit int) map[string]any {
	c.mu.Lock()
	defer c.mu.Unlock()
	return map[string]any{"limit": limit, "initial": c.initial, "max": cpuWorkerLimit(c.cpus), "adaptive": c.adaptive, "target": c.lastTarget, "changes": c.changes}
}
