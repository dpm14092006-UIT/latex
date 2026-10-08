//go:build darwin || linux

package service

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestCancelCommandStopsDescendants(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	directory := t.TempDir()
	done := make(chan error, 1)
	go func() {
		_, err := runCommand(ctx, "/bin/sh", []string{"-c", "sleep 60 & child=$!; echo $child > child.pid; wait"}, directory, time.Minute)
		done <- err
	}()
	var pid int
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		data, _ := os.ReadFile(filepath.Join(directory, "child.pid"))
		pid, _ = strconv.Atoi(strings.TrimSpace(string(data)))
		if pid > 0 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if pid == 0 {
		t.Fatal("child did not start")
	}
	t.Cleanup(func() { _ = syscall.Kill(pid, syscall.SIGKILL) })
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, errClientCancelled) {
			t.Fatalf("got %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("cancellation hung")
	}
	// The orphan can briefly remain a zombie while launchd/init reaps it.
	deadline = time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if errors.Is(syscall.Kill(pid, 0), syscall.ESRCH) {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("compiler descendant survived cancellation")
}

func TestDarwinMemoryPageSizes(t *testing.T) {
	for _, pageSize := range []uint64{4096, 16384} {
		data := []byte("Mach Virtual Memory Statistics: (page size of " + strconv.FormatUint(pageSize, 10) + " bytes)\nPages free: 10.\nPages inactive: 20.\nPages speculative: 3.\nPages wired down: 999.\n")
		if got := parseDarwinAvailableMemory(data); got != 33*pageSize {
			t.Fatalf("page size %d: got %d", pageSize, got)
		}
	}
	if got := parseDarwinAvailableMemory([]byte("invalid")); got != 0 {
		t.Fatalf("invalid output: %d", got)
	}
}
