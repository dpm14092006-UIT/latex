package main

import (
	"log"
	"strconv"
	"strings"
	"time"
)

// parentPollInterval is how often platforms without a blocking wait check
// whether the parent process is still alive.
const parentPollInterval = 2 * time.Second

// parentExited returns a channel closed once the process named by
// VIETLATEX_PARENT_PID (the Electron main process) has exited, so a crashed
// app does not leave an orphaned backend. It returns nil, which blocks
// forever in a select, when the variable is unset or invalid: the web dev
// runner and `go run` start the backend without a parent watch.
func parentExited(value string) <-chan struct{} {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	pid, err := strconv.Atoi(value)
	if err != nil || pid <= 0 {
		log.Printf("ignoring invalid VIETLATEX_PARENT_PID %q", value)
		return nil
	}
	return watchParent(pid)
}
