//go:build darwin || linux

package service

import (
	"errors"
	"syscall"
	"testing"
)

// watchProcess reports whether pid has exited. An orphan is reaped by
// launchd/init shortly after it dies, which then makes kill(pid, 0) fail.
func watchProcess(t *testing.T, pid int) func() bool {
	t.Cleanup(func() { _ = syscall.Kill(pid, syscall.SIGKILL) })
	return func() bool { return errors.Is(syscall.Kill(pid, 0), syscall.ESRCH) }
}
