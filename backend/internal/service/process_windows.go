//go:build windows

package service

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"syscall"
	"time"
)

func hideCommandWindow(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
}

// killTreeOnCancel makes cancellation and timeouts stop the whole process
// tree. Killing only the direct child leaves helpers running (MiKTeX's
// biber.exe, for example, is a launcher for the real biber), and those keep
// the work directory busy so it cannot be removed.
func killTreeOnCancel(command *exec.Cmd) {
	command.Cancel = func() error {
		if root := os.Getenv("SystemRoot"); root != "" {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			taskkill := exec.CommandContext(ctx, filepath.Join(root, "System32", "taskkill.exe"), "/T", "/F", "/PID", strconv.Itoa(command.Process.Pid))
			hideCommandWindow(taskkill)
			_ = taskkill.Run()
		}
		return command.Process.Kill()
	}
}
