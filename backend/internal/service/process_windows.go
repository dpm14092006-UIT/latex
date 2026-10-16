//go:build windows

package service

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"sync"
	"syscall"
	"time"
	"unsafe"
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

var (
	kernel32                 = syscall.NewLazyDLL("kernel32.dll")
	createJobObject          = kernel32.NewProc("CreateJobObjectW")
	setInformationJobObject  = kernel32.NewProc("SetInformationJobObject")
	assignProcessToJobObject = kernel32.NewProc("AssignProcessToJobObject")
	terminateJobObject       = kernel32.NewProc("TerminateJobObject")
	// commandJobs maps a started *exec.Cmd to the job object holding its tree.
	commandJobs sync.Map
)

const (
	jobObjectExtendedLimitInformation = 9
	jobObjectLimitKillOnJobClose      = 0x2000
	processSetQuota                   = 0x0100
	processTerminate                  = 0x0001
)

type ioCounters struct{ ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes uint64 }

type jobBasicLimitInformation struct {
	PerProcessUserTimeLimit int64
	PerJobUserTimeLimit     int64
	LimitFlags              uint32
	MinimumWorkingSetSize   uintptr
	MaximumWorkingSetSize   uintptr
	ActiveProcessLimit      uint32
	Affinity                uintptr
	PriorityClass           uint32
	SchedulingClass         uint32
}

type jobExtendedLimitInformation struct {
	BasicLimitInformation jobBasicLimitInformation
	IoInfo                ioCounters
	ProcessMemoryLimit    uintptr
	JobMemoryLimit        uintptr
	PeakProcessMemoryUsed uintptr
	PeakJobMemoryUsed     uintptr
}

// trackCommand puts a started command in its own kill-on-close job object.
// Descendants join the job automatically, so cancellation reaches helpers
// whose parent already exited (taskkill /T walks parent PIDs and misses
// them), and a crashed backend closes the handle and takes the tree with it.
// A process that spawns a child within microseconds of starting could escape;
// killCommandGroup still falls back to taskkill for commands without a job.
func trackCommand(command *exec.Cmd) {
	if command.Process == nil {
		return
	}
	job, _, _ := createJobObject.Call(0, 0)
	if job == 0 {
		return
	}
	info := jobExtendedLimitInformation{}
	info.BasicLimitInformation.LimitFlags = jobObjectLimitKillOnJobClose
	if ok, _, _ := setInformationJobObject.Call(job, jobObjectExtendedLimitInformation, uintptr(unsafe.Pointer(&info)), unsafe.Sizeof(info)); ok == 0 {
		_ = syscall.CloseHandle(syscall.Handle(job))
		return
	}
	// The *os.Process keeps its own handle open, so the PID cannot be reused yet.
	process, err := syscall.OpenProcess(processSetQuota|processTerminate, false, uint32(command.Process.Pid))
	if err != nil {
		_ = syscall.CloseHandle(syscall.Handle(job))
		return
	}
	ok, _, _ := assignProcessToJobObject.Call(job, uintptr(process))
	_ = syscall.CloseHandle(process)
	if ok == 0 {
		_ = syscall.CloseHandle(syscall.Handle(job))
		return
	}
	commandJobs.Store(command, syscall.Handle(job))
}

// releaseCommand closes the command's job after Wait; kill-on-close stops any
// helper still running so it cannot keep the work directory locked.
func releaseCommand(command *exec.Cmd) {
	if job, ok := commandJobs.LoadAndDelete(command); ok {
		_ = syscall.CloseHandle(job.(syscall.Handle))
	}
}

func killCommandGroup(command *exec.Cmd) error {
	if command.Process == nil {
		return os.ErrProcessDone
	}
	if job, ok := commandJobs.Load(command); ok {
		_, _, _ = terminateJobObject.Call(uintptr(job.(syscall.Handle)), 1)
	} else if root := os.Getenv("SystemRoot"); root != "" {
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
