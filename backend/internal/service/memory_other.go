//go:build !windows

package service

import (
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
)

func availableMemoryBytes() uint64 {
	switch runtime.GOOS {
	case "linux":
		return linuxAvailableMemoryBytes()
	case "darwin":
		return darwinAvailableMemoryBytes()
	default:
		return 0
	}
}

func linuxAvailableMemoryBytes() uint64 {
	data, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return 0
	}
	for _, line := range strings.Split(string(data), "\n") {
		if !strings.HasPrefix(line, "MemAvailable:") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 2 {
			return 0
		}
		kib, err := strconv.ParseUint(fields[1], 10, 64)
		if err != nil {
			return 0
		}
		return kib * 1024
	}
	return 0
}

func darwinAvailableMemoryBytes() uint64 {
	data, err := exec.Command("vm_stat").Output()
	if err != nil {
		return 0
	}
	var pageSize uint64
	var availablePages uint64
	for _, line := range strings.Split(string(data), "\n") {
		if strings.Contains(line, "page size of ") {
			fields := strings.Fields(line)
			for index := 0; index+1 < len(fields); index++ {
				if fields[index] == "of" {
					pageSize, _ = strconv.ParseUint(fields[index+1], 10, 64)
					break
				}
			}
			continue
		}
		if !(strings.HasPrefix(line, "Pages free:") || strings.HasPrefix(line, "Pages inactive:") || strings.HasPrefix(line, "Pages speculative:")) {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 3 {
			continue
		}
		pages, err := strconv.ParseUint(strings.TrimSuffix(fields[2], "."), 10, 64)
		if err == nil {
			availablePages += pages
		}
	}
	if pageSize == 0 {
		return 0
	}
	return availablePages * pageSize
}
