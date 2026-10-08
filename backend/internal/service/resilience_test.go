package service

import (
	"context"
	"encoding/base64"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
	"unicode/utf8"
)

func TestAlreadyCancelledQueueRequestDoesNotAcquireSlot(t *testing.T) {
	q := newCompileQueue(1, 1)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := q.acquire(ctx); !errors.Is(err, errClientCancelled) {
		t.Fatalf("cancelled acquire returned %v", err)
	}
	if stats := q.stats(); stats["active"] != 0 || stats["queued"] != 0 {
		t.Fatalf("cancelled request consumed capacity: %v", stats)
	}
}

func TestCompileAfterShutdownDoesNotStartWorkOrServeCache(t *testing.T) {
	s := newLatexService()
	s.compileFn = func(context.Context, string, []fileAsset) ([]byte, error) {
		t.Error("compiler started after shutdown")
		return []byte("%PDF-test"), nil
	}
	s.cache.put(compileHash("cached", nil, nil), []byte("%PDF-cached"))
	s.cancelAll()
	for _, source := range []string{"new", "cached"} {
		if _, err := s.compile(context.Background(), compileRequest{Latex: source}); err == nil || statusOf(t, err) != http.StatusServiceUnavailable {
			t.Fatalf("compile %q after shutdown returned %v", source, err)
		}
	}
}

func TestWarmCloseWaitsForSpawnCleanup(t *testing.T) {
	p, alive := fakeWarmPool(warmConfig{mode: "eager", size: 1})
	originalSpawn := p.spawn
	started, proceed := make(chan struct{}), make(chan struct{})
	p.spawn = func() (*warmTeX, string) {
		close(started)
		<-proceed
		return originalSpawn()
	}
	p.startup()
	<-started
	done := make(chan struct{})
	go func() { p.close(); close(done) }()
	returnedEarly := false
	select {
	case <-done:
		returnedEarly = true
	case <-time.After(20 * time.Millisecond):
	}
	close(proceed)
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("shutdown did not complete after spawn was released")
	}
	settledIdle(t, p, 0)
	if returnedEarly {
		t.Error("close returned while a warm spawn still owned temporary resources")
	}
	if alive() != 0 {
		t.Fatalf("shutdown left %d warm processes alive", alive())
	}
}

type countedReader struct {
	reader io.Reader
	read   int
}

func (r *countedReader) Read(p []byte) (int, error) {
	n, err := r.reader.Read(p)
	r.read += n
	return n, err
}

func TestJSONRejectsSecondValueWithoutMaterializingIt(t *testing.T) {
	r := &countedReader{reader: strings.NewReader(`{"latex":"valid"} "` + strings.Repeat("x", 1<<20) + `"`)}
	var input compileRequest
	if err := decodeSingleJSON(r, &input); err == nil {
		t.Fatal("second JSON value was accepted")
	}
	if r.read > 16<<10 {
		t.Fatalf("read %d bytes to reject a second JSON value", r.read)
	}
}

func TestQueueCloseWakesWaitersAndRefusesNewAdmission(t *testing.T) {
	q := newCompileQueue(1, 2)
	if err := q.acquire(context.Background()); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 2)
	for range 2 {
		go func() { done <- q.acquire(context.Background()) }()
	}
	waitFor(t, "both requests to queue", func() bool { return q.stats()["queued"] == 2 })
	q.close()
	q.close()
	for range 2 {
		select {
		case err := <-done:
			if statusOf(t, err) != http.StatusServiceUnavailable {
				t.Fatalf("queued request returned %v", err)
			}
		case <-time.After(2 * time.Second):
			t.Fatal("queued request did not wake on close")
		}
	}
	if q.admit() {
		t.Fatal("closed queue admitted a new HTTP request")
	}
	if err := q.acquire(context.Background()); statusOf(t, err) != http.StatusServiceUnavailable {
		t.Fatalf("closed queue allowed new work: %v", err)
	}
	q.setLimit(8)
	if stats := q.stats(); stats["active"] != 1 || stats["queued"] != 0 {
		t.Fatalf("close changed the active owner or left waiters: %v", stats)
	}
	q.release()
	if q.stats()["active"] != 0 {
		t.Fatal("active owner could not release after shutdown")
	}
}

func TestConcurrentCancellationAndResizingDrainQueue(t *testing.T) {
	q := newCompileQueue(3, 128)
	var running, peak atomic.Int32
	var wg sync.WaitGroup
	for i := range 128 {
		wg.Go(func() {
			ctx, cancel := context.WithTimeout(context.Background(), time.Duration(1+i%5)*time.Millisecond)
			defer cancel()
			if q.acquire(ctx) != nil {
				return
			}
			active := running.Add(1)
			for previous := peak.Load(); active > previous && !peak.CompareAndSwap(previous, active); previous = peak.Load() {
			}
			<-ctx.Done()
			running.Add(-1)
			q.release()
		})
	}
	for _, limit := range []int{1, 4, 2, 3} {
		q.setLimit(limit)
		time.Sleep(time.Millisecond)
	}
	wg.Wait()
	if peak.Load() > 4 {
		t.Fatalf("queue exceeded maximum configured workers: %d", peak.Load())
	}
	if stats := q.stats(); stats["active"] != 0 || stats["queued"] != 0 {
		t.Fatalf("cancellation leaked queue capacity: %v", stats)
	}
	if err := q.acquire(context.Background()); err != nil {
		t.Fatalf("queue did not recover: %v", err)
	}
	q.release()
}

func TestShutdownCancelsActiveAndQueuedCompiles(t *testing.T) {
	s := newLatexService()
	s.queue.setLimit(1)
	started := make(chan struct{})
	s.compileFn = func(ctx context.Context, _ string, _ []fileAsset) ([]byte, error) {
		close(started)
		<-ctx.Done()
		return nil, errClientCancelled
	}
	done := make(chan error, 2)
	go func() { _, err := s.compile(context.Background(), compileRequest{Latex: "active"}); done <- err }()
	<-started
	go func() { _, err := s.compile(context.Background(), compileRequest{Latex: "queued"}); done <- err }()
	waitFor(t, "second compile to queue", func() bool { return s.queue.stats()["queued"] == 1 })
	s.cancelAll()
	for range 2 {
		select {
		case err := <-done:
			if err == nil {
				t.Fatal("shutdown compile unexpectedly succeeded")
			}
		case <-time.After(2 * time.Second):
			t.Fatal("shutdown compile did not finish")
		}
	}
	waitFor(t, "all compile resources to drain", func() bool {
		s.mu.Lock()
		defer s.mu.Unlock()
		return len(s.controllers) == 0 && len(s.flights) == 0 && s.queue.stats()["active"] == 0
	})
}

func TestWordTrackingAfterShutdownIsCancelled(t *testing.T) {
	s := newWordService()
	active, untrack := s.track(context.Background())
	done := make(chan struct{})
	go func() { s.cancelAll(); close(done) }()
	select {
	case <-active.Done():
	case <-time.After(2 * time.Second):
		untrack()
		t.Fatal("active Word context survived shutdown")
	}
	untrack()
	<-done
	late, untrackLate := s.track(context.Background())
	defer untrackLate()
	if late.Err() == nil || s.queue.admit() {
		t.Fatal("new Word request survived shutdown")
	}
}

func TestShutdownWaitsForActiveCompileCleanup(t *testing.T) {
	s := newLatexService()
	started, cleaning, proceed := make(chan struct{}), make(chan struct{}), make(chan struct{})
	s.compileFn = func(ctx context.Context, _ string, _ []fileAsset) ([]byte, error) {
		close(started)
		<-ctx.Done()
		close(cleaning)
		<-proceed
		return nil, errClientCancelled
	}
	requestDone := make(chan struct{})
	go func() { _, _ = s.compile(context.Background(), compileRequest{Latex: "cleanup"}); close(requestDone) }()
	<-started
	shutdownDone := make(chan struct{})
	go func() { s.cancelAll(); close(shutdownDone) }()
	<-cleaning
	returnedEarly := false
	select {
	case <-shutdownDone:
		returnedEarly = true
	case <-time.After(20 * time.Millisecond):
	}
	close(proceed)
	<-requestDone
	<-shutdownDone
	if returnedEarly {
		t.Fatal("shutdown returned before the active compile released its resources")
	}
}

func TestWordShutdownWaitsForTrackedCleanup(t *testing.T) {
	s := newWordService()
	ctx, untrack := s.track(context.Background())
	shutdownDone := make(chan struct{})
	go func() { s.cancelAll(); close(shutdownDone) }()
	<-ctx.Done()
	returnedEarly := false
	select {
	case <-shutdownDone:
		returnedEarly = true
	case <-time.After(20 * time.Millisecond):
	}
	untrack()
	<-shutdownDone
	if returnedEarly {
		t.Fatal("Word shutdown returned before conversion cleanup completed")
	}
}

func TestAuxiliaryEndpointsRejectOverloadBeforeReading(t *testing.T) {
	for _, path := range []string{"/api/doi", "/api/environment"} {
		t.Run(path, func(t *testing.T) {
			s := New("tok")
			t.Cleanup(s.CancelActiveCompiles)
			q := s.doiQueue
			method := http.MethodPost
			if path == "/api/environment" {
				q, method = s.diagnosticsQueue, http.MethodGet
			}
			stats := q.stats()
			for range stats["concurrency"] + stats["maxQueue"] {
				if !q.admit() {
					t.Fatal("could not fill admission slots")
				}
			}
			body := &countedReader{reader: strings.NewReader(`{"doi":"10.1234/valid"}`)}
			request := httptest.NewRequest(method, path, body)
			request.Header.Set("X-Vietlatex-Token", "tok")
			recorder := httptest.NewRecorder()
			s.Handler().ServeHTTP(recorder, request)
			if recorder.Code != http.StatusServiceUnavailable || recorder.Header().Get("Retry-After") != "3" || body.read != 0 {
				t.Fatalf("overload was not shed before reading: status=%d read=%d headers=%v", recorder.Code, body.read, recorder.Header())
			}
		})
	}
}

func TestShutdownPropagatesToAuxiliaryRequestContexts(t *testing.T) {
	s := New("tok")
	started, done := make(chan struct{}), make(chan struct{})
	handler := s.authorize(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		close(started)
		<-r.Context().Done()
		close(done)
	}))
	request := httptest.NewRequest(http.MethodGet, "/", nil)
	request.Header.Set("X-Vietlatex-Token", "tok")
	go handler.ServeHTTP(httptest.NewRecorder(), request)
	<-started
	s.CancelActiveCompiles()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("auxiliary request did not receive shutdown cancellation")
	}
}

func TestSingleJSONWhitespaceAndBodyLimits(t *testing.T) {
	for _, suffix := range []string{"", " \t\r\n", "garbage", " null", " []"} {
		var input compileRequest
		err := decodeSingleJSON(strings.NewReader(`{"latex":"x"}`+suffix), &input)
		valid := suffix == "" || suffix == " \t\r\n"
		if (err == nil) != valid {
			t.Errorf("suffix %q returned %v", suffix, err)
		}
	}
	var input compileRequest
	reader := http.MaxBytesReader(httptest.NewRecorder(), io.NopCloser(strings.NewReader(`{"latex":"x"}`+strings.Repeat(" ", 8192))), 4096)
	var tooLarge *http.MaxBytesError
	if err := decodeSingleJSON(reader, &input); !errors.As(err, &tooLarge) {
		t.Fatalf("oversized whitespace suffix escaped the body limit: %v", err)
	}
}

func TestOversizedEncodedAssetsAreRejectedBeforeDecode(t *testing.T) {
	// Invalid base64 larger than the decoded size budget must get 413,
	// without allocating its decoded representation first.
	for _, size := range []int{maxOneAssetBytes, maxAllAssetBytes} {
		_, err := validateAssets([]encodedAsset{{Filename: "large.txt", Data: strings.Repeat("!", base64.StdEncoding.EncodedLen(size)+4)}})
		if statusOf(t, err) != http.StatusRequestEntityTooLarge {
			t.Fatalf("large encoded asset returned %v", err)
		}
	}
	_, err := validateImages([]encodedAsset{{Filename: "image-1.png", Data: strings.Repeat("!", base64.StdEncoding.EncodedLen(maxDocumentImage)+4)}})
	if statusOf(t, err) != http.StatusRequestEntityTooLarge {
		t.Fatalf("large encoded image returned %v", err)
	}
	for _, size := range []int{0, 1, 2, 3, maxOneAssetBytes} {
		data := make([]byte, size)
		if _, err := validateAssets([]encodedAsset{encoded("valid.txt", data)}); err != nil {
			t.Fatalf("valid %d-byte asset rejected: %v", size, err)
		}
	}
}

func TestStaleSourceDirectoriesAreSwept(t *testing.T) {
	root := t.TempDir()
	for _, variable := range []string{"TMPDIR", "TMP", "TEMP"} {
		t.Setenv(variable, root)
	}
	stale := filepath.Join(root, "vietlatex-source-stale")
	recent := filepath.Join(root, "vietlatex-source-recent")
	unrelated := filepath.Join(root, "keep-stale")
	for _, directory := range []string{stale, recent, unrelated} {
		if err := os.Mkdir(directory, 0o700); err != nil {
			t.Fatal(err)
		}
	}
	old := time.Now().Add(-48 * time.Hour)
	for _, directory := range []string{stale, unrelated} {
		if err := os.Chtimes(directory, old, old); err != nil {
			t.Fatal(err)
		}
	}
	sweepStaleWorkDirectories(24 * time.Hour)
	if _, err := os.Stat(stale); !os.IsNotExist(err) {
		t.Fatalf("stale source directory remained: %v", err)
	}
	for _, directory := range []string{recent, unrelated} {
		if _, err := os.Stat(directory); err != nil {
			t.Fatalf("protected directory was removed: %v", err)
		}
	}
}

func TestCriticalMemoryPressureOverridesActiveWorkerEstimate(t *testing.T) {
	c := &workerController{cpus: 16, adaptive: true}
	for range shrinkAfterSamples - 1 {
		if next, changed := c.observe(8, 8, 128<<20); changed || next != 8 {
			t.Fatalf("memory shrink did not preserve hysteresis: next=%d changed=%v", next, changed)
		}
	}
	if next, changed := c.observe(8, 8, 128<<20); !changed || next != 1 {
		t.Fatalf("active worker estimate hid critical pressure: next=%d changed=%v", next, changed)
	}
}

func TestAssetPathsRejectAllASCIIControlCharacters(t *testing.T) {
	for control := range 32 {
		if safeAssetPath("bad" + string(rune(control)) + ".txt") {
			t.Errorf("accepted path with control character %d", control)
		}
	}
}

func BenchmarkDecodeLargeAsset(b *testing.B) {
	input := base64.StdEncoding.EncodeToString(make([]byte, maxOneAssetBytes))
	for _, legacy := range []bool{true, false} {
		name := "strict"
		if legacy {
			name = "previous-roundtrip"
		}
		b.Run(name, func(b *testing.B) {
			b.ReportAllocs()
			b.SetBytes(maxOneAssetBytes)
			for b.Loop() {
				data, err := decodeBase64(input)
				if err != nil {
					b.Fatal(err)
				}
				if legacy && base64.StdEncoding.EncodeToString(data) != input {
					b.Fatal("roundtrip mismatch")
				}
			}
		})
	}
}

// A compile cut short by shutdown must not look like an empty successful PDF.
func TestCompileInterruptedByShutdownReturns503(t *testing.T) {
	s := New("tok")
	started := make(chan struct{})
	s.latex.compileFn = func(ctx context.Context, _ string, _ []fileAsset) ([]byte, error) {
		close(started)
		<-ctx.Done()
		return nil, errClientCancelled
	}
	request := httptest.NewRequest(http.MethodPost, "/api/compile", strings.NewReader(`{"latex":"x"}`))
	request.Header.Set("X-Vietlatex-Token", "tok")
	recorder := httptest.NewRecorder()
	done := make(chan struct{})
	go func() {
		s.Handler().ServeHTTP(recorder, request)
		close(done)
	}()
	<-started
	s.CancelActiveCompiles()
	<-done
	if recorder.Code != http.StatusServiceUnavailable || recorder.Body.Len() == 0 {
		t.Fatalf("status %d body %q, want 503 with an error", recorder.Code, recorder.Body.String())
	}
}

func TestLogTailKeepsEndOnRuneBoundary(t *testing.T) {
	log := strings.Repeat("ơ", 20_000) + "! Undefined control sequence."
	tail := logTail(log)
	if len(tail) > 32_000 || !utf8.ValidString(tail) || !strings.HasSuffix(tail, "! Undefined control sequence.") {
		t.Fatalf("bad tail: len=%d valid=%v", len(tail), utf8.ValidString(tail))
	}
	if logTail("short") != "short" {
		t.Fatal("short logs must be kept whole")
	}
}

// Documents whose cross-references or citations are read back from .aux
// must get a second XeLaTeX pass, otherwise the PDF shows "??" or "[?]".
func TestRerunPatternDetectsCommonReferenceCommands(t *testing.T) {
	for _, source := range []string{`\ref{a}`, `\pageref{LastPage}`, `\eqref{e}`, `\autoref{a}`, `\cref{a}`, `\Cref{a}`, `\nameref{a}`, `\hyperref[a]{x}`, `\cite{k}`, `\citep{k}`, `\citet*{k}`, `\parencite{k}`, `\textcite{k}`, `\tableofcontents`, `\listoffigures`, `\listoftables`, `\bibliography{refs}`} {
		if !rerunPattern.MatchString(source) {
			t.Errorf("%s should trigger a rerun", source)
		}
	}
	for _, source := range []string{`\href{https://x}{y}`, `\section{Ref}`, `\label{a}`, `\bibliographystyle{plain}`, `\referencing`} {
		if rerunPattern.MatchString(source) {
			t.Errorf("%s should not trigger a rerun", source)
		}
	}
}
