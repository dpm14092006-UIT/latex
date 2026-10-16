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

// The process group set up by configureCommand already holds every
// descendant, as the job object does on Windows.
func trackCommand(*exec.Cmd) {}

// releaseCommand stops helpers still running in the group after the command
// exited, so they cannot keep writing into a work directory being removed.
// A group ID is not reused while any member is alive, so this only reaches
// leftovers of this command; an empty group returns ESRCH.
func releaseCommand(command *exec.Cmd) {
	if command.Process != nil {
		_ = syscall.Kill(-command.Process.Pid, syscall.SIGKILL)
	}
}

const texDistribution = "MacTeX hoặc TeX Live"

func executableName(name string) string { return name }

func isExecutableFile(info os.FileInfo) bool { return !info.IsDir() && info.Mode()&0111 != 0 }

func platformXeLatexCandidates() []string { return nil }
