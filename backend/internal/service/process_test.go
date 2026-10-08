package service

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

// A timed-out command must not leave its child processes running: on Windows
// they keep the work directory busy, so it can no longer be removed.
func TestCommandTimeoutStopsChildProcesses(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("process-tree cleanup is Windows-specific")
	}
	system := filepath.Join(os.Getenv("SystemRoot"), "System32")
	directory := filepath.Join(t.TempDir(), "work")
	if err := os.Mkdir(directory, 0o700); err != nil {
		t.Fatal(err)
	}
	_, err := runCommand(context.Background(), filepath.Join(system, "cmd.exe"), []string{"/c", filepath.Join(system, "PING.EXE"), "-n", "30", "127.0.0.1"}, directory, 300*time.Millisecond)
	var command *commandError
	if !errors.As(err, &command) || !command.timeout {
		t.Fatalf("expected timeout, got %v", err)
	}
	deadline := time.Now().Add(3 * time.Second)
	for {
		err := os.Remove(directory)
		if err == nil {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("child process still holds the work directory: %v", err)
		}
		time.Sleep(50 * time.Millisecond)
	}
}

// startIdleProcess starts a long-running stand-in for a prestarted warm
// XeLaTeX whose working directory is directory.
func startIdleProcess(t *testing.T, directory string) *warmTeX {
	t.Helper()
	command := exec.Command(filepath.Join(os.Getenv("SystemRoot"), "System32", "PING.EXE"), "-n", "30", "127.0.0.1")
	command.Dir = directory
	hideCommandWindow(command)
	stdin, err := command.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	warm := &warmTeX{cmd: command, stdin: stdin, stdout: &limitedBuffer{}, stderr: &limitedBuffer{}, directory: directory, started: time.Now(), exited: make(chan struct{})}
	warm.kill = func() { _ = command.Process.Kill() }
	go func() {
		warm.waitErr = command.Wait()
		close(warm.exited)
	}()
	return warm
}

// A failed or cancelled multi-pass compile still holds the prestarted next
// pass. Cleanup must stop it before removing the directory it runs in.
func TestTexRunCleanupRemovesDirectoryOfPrestartedPass(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("only Windows refuses to remove a live process's working directory")
	}
	directory, err := os.MkdirTemp(t.TempDir(), "viet-latex-")
	if err != nil {
		t.Fatal(err)
	}
	run := &texRun{directory: directory, next: startIdleProcess(t, directory)}
	run.cleanup()
	if _, err := os.Stat(directory); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("work directory survived cleanup: %v", err)
	}
}

// TeX tokenizes the main file name, so the cold path must not pass an
// absolute path that may contain "~" (8.3 short TEMP paths) or "%".
func TestColdXeLatexRunsInDirectoryWithTeXSpecialCharacters(t *testing.T) {
	if testing.Short() {
		t.Skip("runs XeLaTeX")
	}
	if os.Getenv("VIETLATEX_SANDBOX") == "docker" {
		t.Skip("docker sandbox mounts the directory at /work")
	}
	if _, err := findXeLatex(); err != nil {
		t.Skip("XeLaTeX is not installed")
	}
	for _, name := range []string{"short~1", "per%cent"} {
		t.Run(name, func(t *testing.T) {
			directory := filepath.Join(t.TempDir(), name)
			if err := os.Mkdir(directory, 0o700); err != nil {
				t.Fatal(err)
			}
			source := filepath.Join(directory, "document.tex")
			if err := os.WriteFile(source, []byte(`\documentclass{article}\begin{document}Xin chào\end{document}`+"\n"), 0o600); err != nil {
				t.Fatal(err)
			}
			if err := runXeLatex(context.Background(), source, directory, true); err != nil {
				t.Fatalf("cold XeLaTeX failed: %v", err)
			}
			if _, err := os.Stat(filepath.Join(directory, "document.xdv")); err != nil {
				t.Fatalf("no XDV output: %v", err)
			}
		})
	}
}
