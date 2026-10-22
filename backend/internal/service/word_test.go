package service

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// TestMain lets the test binary stand in for Pandoc when
// VIETLATEX_FAKE_PANDOC is set, so Word paths run without Pandoc installed.
func TestMain(m *testing.M) {
	if mode := os.Getenv("VIETLATEX_FAKE_PANDOC"); mode != "" {
		runFakePandoc(mode)
		os.Exit(0)
	}
	if mode := os.Getenv(helperProcessVariable); mode != "" {
		runHelperProcess(mode)
		os.Exit(0)
	}
	os.Exit(m.Run())
}

func runFakePandoc(mode string) {
	switch mode {
	case "huge-json":
		// Valid-looking JSON that never ends within the AST limit.
		out := bufio.NewWriter(os.Stdout)
		_, _ = out.WriteString(`{"blocks":[`)
		_, _ = out.Write(bytes.Repeat([]byte(`{"t":"Space"},`), maxWordASTBytes/14+1))
		_ = out.Flush()
	}
}

func useFakePandoc(t *testing.T, mode string) {
	t.Helper()
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("PANDOC_PATH", executable)
	t.Setenv("VIETLATEX_FAKE_PANDOC", mode)
}

func TestWordImportReportsOversizedASTAsTooLarge(t *testing.T) {
	useFakePandoc(t, "huge-json")
	_, err := newWordService().importDocument(context.Background(), buildZip(t, "word/document.xml"))
	if status := statusOf(t, err); status != http.StatusRequestEntityTooLarge {
		t.Fatalf("status %d (%v), want 413", status, err)
	}
}

func TestWordArchiveValidationWaitsForWorkerAndCancelsWhileQueued(t *testing.T) {
	s := newWordService()
	if err := s.queue.acquire(context.Background()); err != nil {
		t.Fatal(err)
	}
	defer s.queue.release()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() {
		// An invalid archive must wait its turn too, instead of bypassing the
		// worker and performing decompression before shutdown can track it.
		_, err := s.importDocument(ctx, []byte("invalid archive"))
		done <- err
	}()
	waitFor(t, "archive validation to queue", func() bool { return s.queue.stats()["queued"] == 1 })
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, errClientCancelled) {
			t.Fatalf("queued archive returned %v, want cancellation", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("queued archive ignored cancellation")
	}
}

type cancelWordArchiveReader struct {
	cancel context.CancelFunc
}

func (r cancelWordArchiveReader) Read(p []byte) (int, error) {
	r.cancel()
	p[0] = 'x'
	return 1, nil
}

func TestWordArchiveDecompressionStopsBetweenReads(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	reader := wordArchiveReader{ctx: ctx, reader: cancelWordArchiveReader{cancel: cancel}}
	written, err := io.Copy(io.Discard, reader)
	if written != 1 || !errors.Is(err, errClientCancelled) {
		t.Fatalf("read %d bytes with %v; want immediate cancellation after first read", written, err)
	}
	if err := validateWordZipContext(ctx, buildZip(t, "word/document.xml")); !errors.Is(err, errClientCancelled) {
		t.Fatalf("cancelled archive returned %v", err)
	}
}

func TestFindPandocReturnsAbsolutePath(t *testing.T) {
	root := t.TempDir()
	name := executableName("pandoc")
	if err := os.MkdirAll(filepath.Join(root, "tools", "pandoc"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "tools", "pandoc", name), []byte("stub"), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Chdir(root)
	t.Setenv("PANDOC_PATH", "")
	t.Setenv("VIETLATEX_RESOURCES_PATH", "")
	t.Setenv("VIETLATEX_APP_PATH", "")
	executable, err := findPandoc()
	if err != nil {
		t.Fatal(err)
	}
	// Commands run with Dir set to a temp directory; a relative path would be
	// resolved there instead of the directory it was found in.
	if !filepath.IsAbs(executable) {
		t.Fatalf("findPandoc returned relative path %q", executable)
	}
}

func TestAttachWordImagesSkipsUnsupportedAndMissingTargets(t *testing.T) {
	directory := t.TempDir()
	media := filepath.Join(directory, "media")
	if err := os.MkdirAll(filepath.Join(media, "folder.png"), 0o700); err != nil {
		t.Fatal(err)
	}
	png := []byte("\x89PNG\r\n\x1a\nimage")
	if err := os.WriteFile(filepath.Join(media, "ok.png"), png, 0o600); err != nil {
		t.Fatal(err)
	}
	// An unsupported vector image larger than the whole image budget must be
	// dropped without failing the import.
	large, err := os.Create(filepath.Join(media, "chart.emf"))
	if err != nil {
		t.Fatal(err)
	}
	if err := large.Truncate(maxWordImageBytes + 1); err != nil {
		t.Fatal(err)
	}
	_ = large.Close()
	image := func(target string) map[string]any {
		return map[string]any{"t": "Image", "c": []any{[]any{"", []any{}, []any{}}, []any{}, []any{target, ""}}}
	}
	targets := []string{"media/ok.png", "media/chart.emf", "media/missing.png", "media/folder.png"}
	blocks := make([]any, 0, len(targets))
	for _, target := range targets {
		blocks = append(blocks, image(target))
	}
	total := 0
	if err := attachWordImages(map[string]any{"blocks": blocks}, directory, &total); err != nil {
		t.Fatalf("import failed: %v", err)
	}
	source := func(index int) string {
		return blocks[index].(map[string]any)["c"].([]any)[2].([]any)[0].(string)
	}
	if !strings.HasPrefix(source(0), "data:image/png;base64,") {
		t.Fatalf("supported image was not embedded: %q", source(0))
	}
	for index := 1; index < len(targets); index++ {
		if source(index) != "" {
			t.Fatalf("%s should be dropped, got %q", targets[index], source(index))
		}
	}
	if total != len(png) {
		t.Fatalf("image budget counted %d bytes, want %d", total, len(png))
	}
}

func TestWordExportValidationWaitsForWorkerAndCancelsWhileQueued(t *testing.T) {
	s := newWordService()
	if err := s.queue.acquire(context.Background()); err != nil {
		t.Fatal(err)
	}
	defer s.queue.release()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() {
		// JSON/AST parsing and validation must run inside the worker just like
		// archive decompression, even for input that will eventually be rejected.
		_, err := s.exportDocument(ctx, []byte("invalid JSON"))
		done <- err
	}()
	waitFor(t, "export validation to queue", func() bool { return s.queue.stats()["queued"] == 1 })
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, errClientCancelled) {
			t.Fatalf("queued export returned %v, want cancellation", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("queued export ignored cancellation")
	}
}

func TestWordExportAfterShutdownSkipsASTValidation(t *testing.T) {
	s := newWordService()
	s.cancelAll()
	if _, err := s.exportDocument(context.Background(), []byte("invalid JSON")); !errors.Is(err, errClientCancelled) {
		t.Fatalf("stopped export returned %v", err)
	}
}
