package service

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

// The test binary stands in for compilers and their helpers on every
// platform, so these tests need no sleep, sh or ping from the system.
const helperProcessVariable = "VIETLATEX_TEST_PROCESS"

func helperCommand(t *testing.T, mode string, args ...string) *exec.Cmd {
	t.Helper()
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	command := exec.Command(executable, append([]string{"-test.run=^$"}, args...)...)
	command.Env = append(os.Environ(), helperProcessVariable+"="+mode)
	return command
}

// runHelperProcess: "idle" waits like a prestarted XeLaTeX; "spawn-exit" and
// "spawn-wait" start an idle child (a helper such as MiKTeX's real biber),
// write its PID to child.pid in the working directory, then exit or wait.
func runHelperProcess(mode string) {
	if mode == "idle" {
		time.Sleep(time.Minute)
		return
	}
	executable, _ := os.Executable()
	child := exec.Command(executable, "-test.run=^$")
	child.Env = append(os.Environ(), helperProcessVariable+"=idle")
	if err := child.Start(); err != nil {
		os.Exit(3)
	}
	_ = os.WriteFile("child.pid", []byte(strconv.Itoa(child.Process.Pid)), 0o600)
	if mode == "spawn-wait" {
		time.Sleep(time.Minute)
	}
}

func readChildPID(t *testing.T, directory string) int {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		data, _ := os.ReadFile(filepath.Join(directory, "child.pid"))
		if pid, _ := strconv.Atoi(strings.TrimSpace(string(data))); pid > 0 {
			return pid
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("helper child did not start")
	return 0
}

// runHelper goes through runCommand like XeLaTeX does; the child inherits
// the mode from the environment set with t.Setenv by the caller.
func runHelper(ctx context.Context, t *testing.T, directory string) error {
	t.Helper()
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	_, err = runCommand(ctx, executable, []string{"-test.run=^$"}, directory, time.Minute)
	return err
}

// A helper whose parent already exited is the case taskkill /T missed on
// Windows; on macOS the leftover stays in the compiler's process group.
func TestFinishedCommandLeavesNoHelperRunning(t *testing.T) {
	directory := t.TempDir()
	t.Setenv(helperProcessVariable, "spawn-exit")
	if err := runHelper(context.Background(), t, directory); err != nil {
		t.Fatalf("helper failed: %v", err)
	}
	waitForExit(t, watchProcess(t, readChildPID(t, directory)), "helper outlived its finished command")
}

func TestCancelCommandStopsHelpers(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	directory := t.TempDir()
	t.Setenv(helperProcessVariable, "spawn-wait")
	done := make(chan error, 1)
	go func() { done <- runHelper(ctx, t, directory) }()
	child := watchProcess(t, readChildPID(t, directory))
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, errClientCancelled) {
			t.Fatalf("got %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("cancellation hung")
	}
	waitForExit(t, child, "helper survived cancellation")
}

func TestRemoveWorkDirectoryAfterHelperStops(t *testing.T) {
	directory := filepath.Join(t.TempDir(), "viet-latex-work")
	if err := os.Mkdir(directory, 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv(helperProcessVariable, "spawn-exit")
	if err := runHelper(context.Background(), t, directory); err != nil {
		t.Fatalf("helper failed: %v", err)
	}
	if err := removeWorkDirectory(directory); err != nil {
		t.Fatalf("work directory not removed: %v", err)
	}
	if _, err := os.Stat(directory); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("work directory survived: %v", err)
	}
}

func waitForExit(t *testing.T, exited func() bool, message string) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if exited() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal(message)
}
