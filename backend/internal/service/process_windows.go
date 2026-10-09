//go:build windows

package service

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"syscall"
	"time"
)

// Compilers run without a console window, and cancellation stops the whole
// process tree: MiKTeX's biber.exe, for example, is a launcher for the real
// biber, and a surviving helper keeps the work directory busy.
func configureCommand(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	if command.Cancel != nil {
		command.Cancel = func() error { return killCommandGroup(command) }
	}
}

func killCommandGroup(command *exec.Cmd) error {
	if command.Process == nil {
		return os.ErrProcessDone
	}
	if root := os.Getenv("SystemRoot"); root != "" {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		taskkill := exec.CommandContext(ctx, filepath.Join(root, "System32", "taskkill.exe"), "/T", "/F", "/PID", strconv.Itoa(command.Process.Pid))
		taskkill.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
		_ = taskkill.Run()
	}
	err := command.Process.Kill()
	if errors.Is(err, os.ErrProcessDone) {
		return os.ErrProcessDone
	}
	return err
}

const texDistribution = "MiKTeX hoặc TeX Live"

func executableName(name string) string { return name + ".exe" }

// Windows has no execute bit; the .exe name is what makes a file runnable.
func isExecutableFile(info os.FileInfo) bool { return !info.IsDir() }

func platformXeLatexCandidates() []string {
	var candidates []string
	if local := os.Getenv("LOCALAPPDATA"); local != "" {
		candidates = append(candidates, filepath.Join(local, "Programs", "MiKTeX", "miktex", "bin", "x64", "xelatex.exe"))
	}
	if programFiles := os.Getenv("ProgramFiles"); programFiles != "" {
		candidates = append(candidates, filepath.Join(programFiles, "MiKTeX", "miktex", "bin", "x64", "xelatex.exe"))
	}
	return candidates
}
