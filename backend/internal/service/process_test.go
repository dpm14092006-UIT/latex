package service

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

// startIdleProcess starts a long-running stand-in for a prestarted warm
// XeLaTeX whose working directory is directory.
func startIdleProcess(t *testing.T, directory string) *warmTeX {
	t.Helper()
	command := exec.Command("sleep", "30")
	command.Dir = directory
	configureCommand(command)
	stdin, err := command.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	warm := &warmTeX{cmd: command, stdin: stdin, stdout: &limitedBuffer{}, stderr: &limitedBuffer{}, directory: directory, started: time.Now(), exited: make(chan struct{})}
	warm.kill = func() { _ = killCommandGroup(command) }
	go func() {
		warm.waitErr = command.Wait()
		close(warm.exited)
	}()
	return warm
}

// A failed or cancelled multi-pass compile still holds the prestarted next
// pass. Cleanup must stop it before removing the directory it runs in.
func TestTexRunCleanupRemovesDirectoryOfPrestartedPass(t *testing.T) {
	directory, err := os.MkdirTemp(t.TempDir(), "viet-latex-")
	if err != nil {
		t.Fatal(err)
	}
	warm := startIdleProcess(t, directory)
	run := &texRun{directory: directory, next: warm}
	run.cleanup()
	select {
	case <-warm.exited:
	case <-time.After(3 * time.Second):
		t.Fatal("prestarted process survived cleanup")
	}
	if _, err := os.Stat(directory); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("work directory survived cleanup: %v", err)
	}
}

// TeX tokenizes the main file name, so the cold path must not pass an
// absolute path that may contain "~" or "%".
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
