package service

import (
	"os"
	"time"
)

// removeWorkDirectory retries briefly. On Windows antivirus scanners and the
// search indexer open freshly written PDFs and logs, and a file held open
// cannot be deleted; on macOS a helper that was just stopped may still have
// been writing, so RemoveAll can meet a directory that is not empty yet.
func removeWorkDirectory(path string) error {
	err := os.RemoveAll(path)
	// Waits 25, 50, 100, 200 and 400 ms: about 0.8 s in the worst case.
	for attempt := 0; err != nil && attempt < 5; attempt++ {
		time.Sleep(time.Duration(25<<attempt) * time.Millisecond)
		err = os.RemoveAll(path)
	}
	return err
}
