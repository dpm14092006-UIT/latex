//go:build darwin || linux

package service

import (
	"errors"
	"os"
	"os/exec"
	"syscall"
)

// Each compiler owns a process group so cancellation also stops descendants.
func configureCommand(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if command.Cancel != nil {
		command.Cancel = func() error { return killCommandGroup(command) }
	}
}

func killCommandGroup(command *exec.Cmd) error {
	if command.Process == nil {
		return os.ErrProcessDone
	}
	err := syscall.Kill(-command.Process.Pid, syscall.SIGKILL)
	if errors.Is(err, syscall.ESRCH) {
		return os.ErrProcessDone
	}
	return err
}
