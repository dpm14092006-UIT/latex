//go:build windows

package service

import (
	"syscall"
	"testing"
)

const synchronize = 0x00100000

// watchProcess opens the process right away so a reused PID cannot be
// mistaken for the helper, then reports whether that process has exited.
func watchProcess(t *testing.T, pid int) func() bool {
	handle, err := syscall.OpenProcess(synchronize|syscall.PROCESS_TERMINATE, false, uint32(pid))
	if err != nil {
		return func() bool { return true }
	}
	t.Cleanup(func() { _ = syscall.TerminateProcess(handle, 1); _ = syscall.CloseHandle(handle) })
	return func() bool {
		event, _ := syscall.WaitForSingleObject(handle, 0)
		return event == syscall.WAIT_OBJECT_0
	}
}
