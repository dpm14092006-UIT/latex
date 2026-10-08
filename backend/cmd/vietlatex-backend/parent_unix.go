//go:build darwin || linux

package main

import (
	"errors"
	"os"
	"syscall"
	"time"
)

func watchParent(pid int) <-chan struct{} {
	directChild := os.Getppid() == pid
	exited := make(chan struct{})
	go func() {
		ticker := time.NewTicker(parentPollInterval)
		defer ticker.Stop()
		for range ticker.C {
			// A direct child is re-parented when its parent dies; otherwise
			// probe the PID with signal 0.
			if directChild && os.Getppid() != pid {
				close(exited)
				return
			}
			process, err := os.FindProcess(pid)
			if err == nil {
				err = process.Signal(syscall.Signal(0))
			}
			if errors.Is(err, os.ErrProcessDone) || errors.Is(err, syscall.ESRCH) {
				close(exited)
				return
			}
		}
	}()
	return exited
}
