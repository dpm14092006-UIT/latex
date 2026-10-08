package main

import (
	"os/exec"
	"runtime"
	"strconv"
	"testing"
	"time"
)

func TestParentExitedIgnoresMissingOrInvalidPID(t *testing.T) {
	for _, value := range []string{"", "  ", "abc", "0", "-4"} {
		if parentExited(value) != nil {
			t.Fatalf("%q should not start a parent watch", value)
		}
	}
}

func TestParentExitedFiresWhenParentExits(t *testing.T) {
	var command *exec.Cmd
	if runtime.GOOS == "windows" {
		command = exec.Command("ping", "-n", "30", "127.0.0.1")
	} else {
		command = exec.Command("sleep", "30")
	}
	if err := command.Start(); err != nil {
		t.Skipf("cannot start stand-in parent: %v", err)
	}
	exited := parentExited(strconv.Itoa(command.Process.Pid))
	select {
	case <-exited:
		t.Fatal("watch fired while the parent is alive")
	case <-time.After(100 * time.Millisecond):
	}
	_ = command.Process.Kill()
	_ = command.Wait()
	select {
	case <-exited:
	case <-time.After(3 * parentPollInterval):
		t.Fatal("watch did not notice the parent exiting")
	}
}
