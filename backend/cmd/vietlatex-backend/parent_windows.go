//go:build windows

package main

import (
	"log"
	"os"
)

// watchParent holds a handle to the parent from startup, so a later reuse of
// its PID cannot be mistaken for the parent still running.
func watchParent(pid int) <-chan struct{} {
	process, err := os.FindProcess(pid)
	if err != nil {
		log.Printf("cannot watch parent process %d: %v", pid, err)
		return nil
	}
	exited := make(chan struct{})
	go func() {
		// Wait works for any process handle on Windows, not only children.
		_, _ = process.Wait()
		close(exited)
	}()
	return exited
}
