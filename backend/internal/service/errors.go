package service

import (
	"context"
	"errors"
	"io"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"time"
)

var errClientCancelled = errors.New("request cancelled")

type serviceError struct {
	status  int
	message string
	log     string
	line    int
}

func (e *serviceError) Error() string { return e.message }

func appError(status int, message string) *serviceError {
	return &serviceError{status: status, message: message}
}

func asServiceError(err error) *serviceError {
	var known *serviceError
	if errors.As(err, &known) {
		return known
	}
	return appError(http.StatusInternalServerError, "Không thể xử lý yêu cầu.")
}

type limitedBuffer struct {
	data []byte
	max  int
}

func (b *limitedBuffer) Write(p []byte) (int, error) {
	original := len(p)
	remaining := b.max - len(b.data)
	if remaining > 0 {
		if len(p) > remaining {
			p = p[:remaining]
		}
		b.data = append(b.data, p...)
	}
	return original, nil
}

func runCommand(ctx context.Context, executable string, args []string, directory string, timeout time.Duration) ([]byte, error) {
	return runCommandWithLimit(ctx, executable, args, directory, timeout, 4<<20)
}

func runCommandWithLimit(ctx context.Context, executable string, args []string, directory string, timeout time.Duration, maxOutput int) ([]byte, error) {
	commandContext, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	command := exec.CommandContext(commandContext, executable, args...)
	command.Dir = directory
	configureCommand(command)
	command.WaitDelay = 2 * time.Second
	stdout := &limitedBuffer{max: maxOutput}
	stderr := &limitedBuffer{max: maxOutput}
	command.Stdout = stdout
	command.Stderr = stderr
	err := command.Run()
	if err == nil {
		return append([]byte(nil), stdout.data...), nil
	}
	if errors.Is(commandContext.Err(), context.Canceled) || errors.Is(ctx.Err(), context.Canceled) {
		return nil, errClientCancelled
	}
	if errors.Is(commandContext.Err(), context.DeadlineExceeded) {
		return nil, &commandError{timeout: true, output: joinOutput(stdout.data, stderr.data)}
	}
	var pathError *os.PathError
	if errors.As(err, &pathError) && errors.Is(pathError.Err, os.ErrNotExist) {
		return nil, &commandError{missing: true, output: joinOutput(stdout.data, stderr.data)}
	}
	var exitError *exec.ExitError
	if errors.As(err, &exitError) {
		return nil, &commandError{output: joinOutput(stdout.data, stderr.data), cause: err}
	}
	if errors.Is(err, exec.ErrNotFound) {
		return nil, &commandError{missing: true, output: joinOutput(stdout.data, stderr.data)}
	}
	return nil, &commandError{output: joinOutput(stdout.data, stderr.data), cause: err}
}

type commandError struct {
	output  string
	timeout bool
	missing bool
	cause   error
}

func (e *commandError) Error() string {
	if output := strings.TrimSpace(e.output); output != "" {
		return output
	}
	if e.cause != nil {
		return e.cause.Error()
	}
	return "external command failed"
}

func joinOutput(stdout, stderr []byte) string {
	if len(stdout) == 0 {
		return string(stderr)
	}
	if len(stderr) == 0 {
		return string(stdout)
	}
	return string(stdout) + "\n" + string(stderr)
}

func copyLimited(destination io.Writer, source io.Reader, limit int64) (int64, error) {
	return io.Copy(destination, io.LimitReader(source, limit+1))
}
