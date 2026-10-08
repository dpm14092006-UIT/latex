package service

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
	"unicode/utf8"
)

func TestSafeAssetPath(t *testing.T) {
	cases := map[string]bool{
		"refs.bib":                        true,
		"figures/plot.png":                true,
		"styles/my.sty":                   true,
		"../secret.tex":                   false,
		"a/../b.tex":                      false,
		"./a.tex":                         false,
		"/abs.tex":                        false,
		"a//b.tex":                        false,
		`dir\file.tex`:                    false,
		"C:file.tex":                      false,
		"CON.tex":                         false,
		"dir/nul.png":                     false,
		"com1.txt":                        false,
		"LPT9.bib":                        false,
		"com0.txt":                        true,
		"script.exe":                      false,
		"noext":                           false,
		"document.tex":                    false,
		"sub/Document.TEX":                false,
		"document.pdf":                    false,
		"trailing.":                       false,
		"space .tex":                      true,
		"bad\x00.tex":                     false,
		"":                                false,
		strings.Repeat("a", 197) + ".tex": false,
	}
	for input, want := range cases {
		if got := safeAssetPath(input); got != want {
			t.Errorf("safeAssetPath(%q) = %v, want %v", input, got, want)
		}
	}
}

func TestDefaultCompileWorkerCountUsesCPUAndAvailableMemory(t *testing.T) {
	const mib = uint64(1024 * 1024)
	cases := []struct {
		name      string
		cpus      int
		available uint64
		want      int
	}{
		{name: "unknown memory uses safe fallback", cpus: 16, want: 4},
		{name: "low memory", cpus: 16, available: 900 * mib, want: 1},
		{name: "moderate memory", cpus: 16, available: 1_200 * mib, want: 2},
		{name: "measured desktop profile", cpus: 16, available: 1_840 * mib, want: 4},
		{name: "room for six workers", cpus: 16, available: 3_000 * mib, want: 6},
		{name: "high memory", cpus: 16, available: 8_000 * mib, want: 8},
		{name: "CPU bound", cpus: 4, available: 8_000 * mib, want: 2},
		{name: "single CPU", cpus: 1, available: 8_000 * mib, want: 1},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			if got := defaultCompileWorkerCount(test.cpus, test.available); got != test.want {
				t.Fatalf("defaultCompileWorkerCount(%d, %d) = %d, want %d", test.cpus, test.available, got, test.want)
			}
		})
	}
}

func TestDecodeBase64(t *testing.T) {
	if data, err := decodeBase64("aGVsbG8="); err != nil || string(data) != "hello" {
		t.Fatalf("canonical decode failed: %q %v", data, err)
	}
	for _, input := range []string{"aGVsbG9=", "aGVsbG8", "aGVs\nbG8=", "!!!!"} {
		if _, err := decodeBase64(input); err == nil {
			t.Errorf("decodeBase64(%q) accepted non-canonical input", input)
		}
	}
}

var (
	pngHeader  = []byte("\x89PNG\r\n\x1a\n0000")
	jpegHeader = []byte{0xff, 0xd8, 0xff, 0xe0, 0}
)

func encoded(name string, data []byte) encodedAsset {
	return encodedAsset{Filename: name, Data: base64.StdEncoding.EncodeToString(data)}
}

func statusOf(t *testing.T, err error) int {
	t.Helper()
	var known *serviceError
	if !errors.As(err, &known) {
		t.Fatalf("expected serviceError, got %v", err)
	}
	return known.status
}

func TestValidateImages(t *testing.T) {
	result, err := validateImages([]encodedAsset{encoded("image-1.png", pngHeader), encoded("image-2.jpg", jpegHeader)})
	if err != nil || len(result) != 2 {
		t.Fatalf("valid images rejected: %v", err)
	}
	if _, err := validateImages([]encodedAsset{encoded("image-1.png", jpegHeader)}); statusOf(t, err) != http.StatusBadRequest {
		t.Error("png name with jpeg data should be rejected")
	}
	if _, err := validateImages([]encodedAsset{encoded("image-1.jpg", pngHeader)}); statusOf(t, err) != http.StatusBadRequest {
		t.Error("jpg name with png data should be rejected")
	}
	if _, err := validateImages([]encodedAsset{encoded("photo.png", pngHeader)}); statusOf(t, err) != http.StatusBadRequest {
		t.Error("bad filename should be rejected")
	}
	if _, err := validateImages([]encodedAsset{encoded("image-1.png", pngHeader), encoded("image-1.png", pngHeader)}); statusOf(t, err) != http.StatusBadRequest {
		t.Error("duplicate names should be rejected")
	}
	big := append(append([]byte(nil), pngHeader...), make([]byte, maxDocumentImage)...)
	if _, err := validateImages([]encodedAsset{encoded("image-1.png", big)}); statusOf(t, err) != http.StatusRequestEntityTooLarge {
		t.Error("oversized image should be rejected with 413")
	}
	many := make([]encodedAsset, maxDocumentImages+1)
	for i := range many {
		many[i] = encoded("image-1.png", pngHeader)
	}
	if _, err := validateImages(many); statusOf(t, err) != http.StatusBadRequest {
		t.Error("too many images should be rejected")
	}
	nearMax := append(append([]byte(nil), pngHeader...), make([]byte, maxDocumentImage-len(pngHeader))...)
	total := make([]encodedAsset, 0, 8)
	for i := 1; i <= 8; i++ {
		total = append(total, encoded("image-"+string(rune('0'+i))+".png", nearMax))
	}
	if _, err := validateImages(total); statusOf(t, err) != http.StatusRequestEntityTooLarge {
		t.Error("total image bytes over limit should be rejected")
	}
}

func TestPDFCacheEvictsByCount(t *testing.T) {
	cache := newPDFCache()
	for i := 0; i < maxCacheEntries+5; i++ {
		cache.put(string(rune('A'+i)), []byte{byte(i)})
	}
	_, entries, _ := cache.stats()
	if entries != maxCacheEntries {
		t.Fatalf("entries = %d, want %d", entries, maxCacheEntries)
	}
	if cache.get("A") != nil {
		t.Error("oldest entry should have been evicted")
	}
	if cache.get(string(rune('A'+maxCacheEntries+4))) == nil {
		t.Error("newest entry missing")
	}
}

func TestPDFCacheEvictsByBytesAndLRU(t *testing.T) {
	cache := newPDFCache()
	chunk := make([]byte, maxCacheBytes/3)
	cache.put("a", chunk)
	cache.put("b", chunk)
	cache.put("c", chunk)
	cache.get("a") // a becomes most recently used
	cache.put("d", chunk)
	if cache.get("b") != nil {
		t.Error("least recently used entry b should be evicted")
	}
	if cache.get("a") == nil || cache.get("d") == nil {
		t.Error("a and d should remain")
	}
	bytes, _, _ := cache.stats()
	if bytes > maxCacheBytes {
		t.Errorf("cache bytes %d exceed limit", bytes)
	}
	cache.put("huge", make([]byte, maxCacheBytes+1))
	if cache.get("huge") != nil {
		t.Error("oversized entry must not be cached")
	}
}

func TestCompileQueueRejectsWhenFull(t *testing.T) {
	queue := newCompileQueue(1, 1)
	ctx := context.Background()
	if err := queue.acquire(ctx); err != nil {
		t.Fatal(err)
	}
	waiterDone := make(chan error, 1)
	go func() { waiterDone <- queue.acquire(ctx) }()
	deadline := time.Now().Add(2 * time.Second)
	for queue.stats()["queued"] != 1 {
		if time.Now().After(deadline) {
			t.Fatal("waiter never queued")
		}
		time.Sleep(time.Millisecond)
	}
	if err := queue.acquire(ctx); statusOf(t, err) != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 when queue full, got %v", err)
	}
	queue.release()
	if err := <-waiterDone; err != nil {
		t.Fatalf("waiter failed: %v", err)
	}
	queue.release()
	stats := queue.stats()
	if stats["rejected"] != 1 || stats["completed"] != 2 || stats["active"] != 0 || stats["queued"] != 0 {
		t.Fatalf("unexpected stats %v", stats)
	}
}

func TestCompileQueueCancelWhileWaiting(t *testing.T) {
	queue := newCompileQueue(1, 4)
	if err := queue.acquire(context.Background()); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- queue.acquire(ctx) }()
	for queue.stats()["queued"] != 1 {
		time.Sleep(time.Millisecond)
	}
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, errClientCancelled) {
			t.Fatalf("expected errClientCancelled, got %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("cancelled waiter did not return")
	}
	if stats := queue.stats(); stats["queued"] != 0 || stats["active"] != 1 {
		t.Fatalf("unexpected stats %v", stats)
	}
	queue.release()
}

func TestCompileQueueConcurrency(t *testing.T) {
	queue := newCompileQueue(2, 8)
	var active, maxActive, completed, rejected int64
	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := queue.acquire(context.Background()); err != nil {
				atomic.AddInt64(&rejected, 1)
				return
			}
			current := atomic.AddInt64(&active, 1)
			for {
				seen := atomic.LoadInt64(&maxActive)
				if current <= seen || atomic.CompareAndSwapInt64(&maxActive, seen, current) {
					break
				}
			}
			time.Sleep(2 * time.Millisecond)
			atomic.AddInt64(&active, -1)
			atomic.AddInt64(&completed, 1)
			queue.release()
		}()
	}
	wg.Wait()
	if maxActive > 2 {
		t.Fatalf("active reached %d, want <= 2", maxActive)
	}
	if rejected+completed != 50 {
		t.Fatalf("rejected %d + completed %d != 50", rejected, completed)
	}
	stats := queue.stats()
	if int64(stats["rejected"]) != rejected || int64(stats["completed"]) != completed || stats["active"] != 0 || stats["queued"] != 0 {
		t.Fatalf("stats mismatch %v", stats)
	}
}

func TestCompileWorkerCountOverrideIsBounded(t *testing.T) {
	tests := []struct {
		value string
		want  int
	}{
		{value: "1", want: 1},
		{value: "4", want: 4},
		{value: "8", want: 8},
		{value: "12", want: 8},
	}
	for _, test := range tests {
		t.Setenv("VIETLATEX_COMPILE_WORKERS", test.value)
		if got := compileWorkerCount(); got != test.want {
			t.Errorf("compileWorkerCount() with override %q = %d, want %d", test.value, got, test.want)
		}
	}
	// The default depends on free memory, which changes while tests run, so
	// check the CPU-derived bounds rather than an exact value.
	maxDefault := max(1, min(8, runtime.NumCPU()/2))
	for _, value := range []string{"0", "invalid", ""} {
		t.Setenv("VIETLATEX_COMPILE_WORKERS", value)
		if got := compileWorkerCount(); got < 1 || got > maxDefault {
			t.Errorf("compileWorkerCount() with override %q = %d, want 1..%d", value, got, maxDefault)
		}
	}
}

func TestAllowedOrigin(t *testing.T) {
	cases := map[string]bool{
		"":                          true,
		"http://127.0.0.1:5173":     true,
		"http://localhost:3000":     true,
		"https://LOCALHOST":         true,
		"http://[::1]:8080":         true,
		"file://localhost":          false,
		"http://evil.com":           false,
		"http://localhost.evil.com": false,
		"http://user@localhost":     false,
		"null":                      false,
	}
	for input, want := range cases {
		if got := allowedOrigin(input); got != want {
			t.Errorf("allowedOrigin(%q) = %v, want %v", input, got, want)
		}
	}
}

func TestWarmPoolRefillHonorsDisabledSettings(t *testing.T) {
	tests := []struct {
		name    string
		warmTex string
		sandbox string
	}{
		{name: "warm disabled", warmTex: "0"},
		{name: "docker sandbox", sandbox: "docker"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("VIETLATEX_WARM_TEX", tc.warmTex)
			t.Setenv("VIETLATEX_SANDBOX", tc.sandbox)

			pool := newWarmPool(currentWarmConfig())
			release := make(chan struct{})
			started := make(chan struct{})
			finished := make(chan struct{})
			pool.spawn = func() (*warmTeX, string) {
				close(started)
				defer close(finished)
				<-release
				return nil, ""
			}

			pool.startup()
			pool.take()
			pool.refill()
			pool.mu.Lock()
			spawning, idle := pool.spawning, len(pool.idle)
			pool.mu.Unlock()
			close(release)
			if spawning != 0 || idle != 0 {
				select {
				case <-finished:
				case <-time.After(time.Second):
					t.Fatal("unexpected warm spawn did not finish")
				}
				t.Fatalf("disabled warm pool has spawning=%d idle=%d, want both zero", spawning, idle)
			}
			select {
			case <-started:
				t.Fatal("disabled warm pool invoked its spawn function")
			default:
			}
		})
	}
}

func TestAuthorize(t *testing.T) {
	service := New("secret-token")
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusTeapot) })
	handler := service.authorize(next)
	cases := []struct {
		name   string
		token  string
		origin string
		want   int
	}{
		{"missing token", "", "", http.StatusUnauthorized},
		{"wrong token", "secret-tokex", "", http.StatusUnauthorized},
		{"short token", "secret", "", http.StatusUnauthorized},
		{"bad origin", "secret-token", "http://evil.com", http.StatusForbidden},
		{"good token", "secret-token", "http://127.0.0.1:5173", http.StatusTeapot},
	}
	for _, tc := range cases {
		request := httptest.NewRequest(http.MethodGet, "/api/health", nil)
		if tc.token != "" {
			request.Header.Set("X-Vietlatex-Token", tc.token)
		}
		if tc.origin != "" {
			request.Header.Set("Origin", tc.origin)
		}
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, request)
		if recorder.Code != tc.want {
			t.Errorf("%s: status %d, want %d", tc.name, recorder.Code, tc.want)
		}
	}
}

func TestFormatLatexError(t *testing.T) {
	detail := "This is XeTeX\r\n./document.tex:42: Undefined control sequence.\r\nl.42 \\foo\r\nsome noise\n! Emergency stop."
	err := formatLatexError(detail)
	var known *serviceError
	if !errors.As(err, &known) {
		t.Fatal("expected serviceError")
	}
	if known.line != 42 || known.status != http.StatusUnprocessableEntity {
		t.Fatalf("line=%d status=%d", known.line, known.status)
	}
	if !strings.HasPrefix(known.message, "Dòng 42: ") || !strings.Contains(known.message, "Emergency stop") || strings.Contains(known.message, "noise") {
		t.Fatalf("unexpected message %q", known.message)
	}
	if other := formatLatexError("no location here").(*serviceError); other.line != 0 || strings.HasPrefix(other.message, "Dòng") {
		t.Fatalf("unexpected line extraction %+v", other)
	}
	if lOnly := formatLatexError("! Missing $ inserted.\nl.7 x^2").(*serviceError); lOnly.line != 7 {
		t.Fatalf("l.N line = %d, want 7", lOnly.line)
	}
	bibtex := formatLatexError("I found no \\citation commands---while reading file document.aux\n(There was 1 error message)").(*serviceError)
	if !strings.Contains(bibtex.message, "I found no \\citation commands") {
		t.Fatalf("BibTeX diagnostic hidden from message: %q", bibtex.message)
	}
}

func TestUnsafeArchivePath(t *testing.T) {
	cases := map[string]bool{
		"word/document.xml":   false,
		"word/media/":         false,
		"[Content_Types].xml": false,
		"":                    true,
		"../evil":             true,
		"word/../../evil":     true,
		"/abs":                true,
		`word\document.xml`:   true,
		"C:evil":              true,
		"a//b":                true,
		"./a":                 true,
	}
	for input, want := range cases {
		if got := unsafeArchivePath(input); got != want {
			t.Errorf("unsafeArchivePath(%q) = %v, want %v", input, got, want)
		}
	}
}

func buildZip(t *testing.T, names ...string) []byte {
	t.Helper()
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	for _, name := range names {
		file, err := writer.CreateHeader(&zip.FileHeader{Name: name, Method: zip.Deflate})
		if err != nil {
			t.Fatal(err)
		}
		_, _ = file.Write([]byte("content of " + name))
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func TestValidateWordZip(t *testing.T) {
	if err := validateWordZip(buildZip(t, "[Content_Types].xml", "word/document.xml")); err != nil {
		t.Fatalf("valid zip rejected: %v", err)
	}
	if err := validateWordZip(buildZip(t, "word/document.xml", "WORD/Document.xml")); err == nil {
		t.Error("duplicate (case-insensitive) names should be rejected")
	}
	if err := validateWordZip(buildZip(t, "../evil.xml")); err == nil {
		t.Error("unsafe path should be rejected")
	}
	if err := validateWordZip([]byte("not a zip")); err == nil {
		t.Error("garbage should be rejected")
	}
}

func TestFirstCharactersKeepsRuneBoundary(t *testing.T) {
	value := strings.Repeat("ệ", 10) // 3 bytes each
	for max := 0; max <= len(value)+1; max++ {
		got := firstCharacters(value, max)
		if !utf8.ValidString(got) || len(got) > max {
			t.Fatalf("firstCharacters(max=%d) = %q", max, got)
		}
	}
}

func TestPandocErrorCancelled(t *testing.T) {
	wrapped := errors.Join(errClientCancelled)
	if !errors.Is(pandocError(wrapped), errClientCancelled) {
		t.Error("wrapped cancellation should map to errClientCancelled")
	}
}

func TestExportRejectsLargeBibliography(t *testing.T) {
	body, _ := json.Marshal(map[string]any{"blocks": []any{}, "_bibliography": strings.Repeat("x", 500_001)})
	_, err := newWordService().exportDocument(context.Background(), body)
	var known *serviceError
	if !errors.As(err, &known) || known.status != http.StatusBadRequest || known.message != "Danh mục BibTeX vượt quá 500 KB." {
		t.Fatalf("unexpected error %v", err)
	}
}

func TestCompileEmptyLatexReturns400JSON(t *testing.T) {
	handler := New("tok").Handler()
	request := httptest.NewRequest(http.MethodPost, "/api/compile", strings.NewReader(`{"latex":"   "}`))
	request.Header.Set("X-Vietlatex-Token", "tok")
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status %d, want 400", recorder.Code)
	}
	if !strings.HasPrefix(recorder.Header().Get("Content-Type"), "application/json") {
		t.Fatalf("content-type %q", recorder.Header().Get("Content-Type"))
	}
	var body map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil || body["error"] != "Tài liệu LaTeX đang trống." {
		t.Fatalf("body %s err %v", recorder.Body.String(), err)
	}
}

func TestCompileRejectsTrailingJSONValues(t *testing.T) {
	handler := New("tok").Handler()
	request := httptest.NewRequest(http.MethodPost, "/api/compile", strings.NewReader(`{"latex":"valid"}{"latex":"ignored"}`))
	request.Header.Set("X-Vietlatex-Token", "tok")
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status %d, want 400", recorder.Code)
	}
}

func TestHeavyRequestAdmissionRejectsBeforeReadingBody(t *testing.T) {
	tests := []struct {
		name  string
		path  string
		body  string
		queue func(*Service) *compileQueue
	}{
		{
			name:  "compile",
			path:  "/api/compile",
			body:  `{"latex":"invalid"}`,
			queue: func(s *Service) *compileQueue { return s.latex.queue },
		},
		{
			name:  "word import",
			path:  "/api/word/import",
			body:  "invalid",
			queue: func(s *Service) *compileQueue { return s.word.queue },
		},
		{
			name:  "word export",
			path:  "/api/word/export",
			body:  "invalid",
			queue: func(s *Service) *compileQueue { return s.word.queue },
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			s := New("tok")
			queue := tc.queue(s)
			stats := queue.stats()
			for range stats["concurrency"] + stats["maxQueue"] {
				queue.admit()
			}

			request := httptest.NewRequest(http.MethodPost, tc.path, strings.NewReader(tc.body))
			request.Header.Set("X-Vietlatex-Token", "tok")
			recorder := httptest.NewRecorder()
			s.Handler().ServeHTTP(recorder, request)

			if recorder.Code != http.StatusServiceUnavailable {
				t.Fatalf("status %d, want 503; body %s", recorder.Code, recorder.Body.String())
			}
			if recorder.Header().Get("Retry-After") != "3" {
				t.Fatalf("Retry-After = %q, want 3", recorder.Header().Get("Retry-After"))
			}
			remaining, err := io.ReadAll(request.Body)
			if err != nil {
				t.Fatal(err)
			}
			if string(remaining) != tc.body {
				t.Fatalf("rejected request body was consumed: remaining %q, want %q", remaining, tc.body)
			}
			if got := tc.queue(s).stats()["rejected"]; got != 1 {
				t.Fatalf("rejected metric = %d, want 1", got)
			}
		})
	}
}

func TestReadCompiledPDFRejectsNonPDFOutput(t *testing.T) {
	path := filepath.Join(t.TempDir(), "output.pdf")
	if err := os.WriteFile(path, []byte("not a PDF"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := readCompiledPDF(path); statusOf(t, err) != http.StatusInternalServerError {
		t.Fatal("non-PDF compiler output should be rejected")
	}
}

func blockingLatexService(t *testing.T) (*latexService, *atomic.Int32, chan struct{}, chan struct{}) {
	t.Helper()
	s := newLatexService()
	s.queue = newCompileQueue(2, 2)
	var runs atomic.Int32
	started := make(chan struct{}, 8)
	release := make(chan struct{})
	s.compileFn = func(ctx context.Context, latex string, _ []fileAsset) ([]byte, error) {
		runs.Add(1)
		started <- struct{}{}
		select {
		case <-release:
			return []byte("%PDF-" + latex), nil
		case <-ctx.Done():
			return nil, errClientCancelled
		}
	}
	return s, &runs, started, release
}

func TestCompileCoalescesIdenticalRequests(t *testing.T) {
	s, runs, started, release := blockingLatexService(t)
	input := compileRequest{Latex: "same"}
	results := make(chan []byte, 4)
	for range 4 {
		go func() {
			pdf, err := s.compile(context.Background(), input)
			if err != nil {
				t.Error(err)
			}
			results <- pdf
		}()
	}
	<-started
	deadline := time.Now().Add(2 * time.Second)
	for s.stats()["coalesced"].(int) < 3 && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	close(release)
	for range 4 {
		if got := string(<-results); got != "%PDF-same" {
			t.Fatalf("unexpected pdf %q", got)
		}
	}
	if runs.Load() != 1 {
		t.Fatalf("expected one compile, got %d", runs.Load())
	}
	if s.queue.stats()["completed"] != 1 {
		t.Fatalf("duplicates must not consume queue slots: %v", s.queue.stats())
	}
}

func TestCoalescedCompileSurvivesOneCancellation(t *testing.T) {
	s, runs, started, release := blockingLatexService(t)
	input := compileRequest{Latex: "shared"}
	cancelledCtx, cancel := context.WithCancel(context.Background())
	cancelled := make(chan error, 1)
	go func() {
		_, err := s.compile(cancelledCtx, input)
		cancelled <- err
	}()
	<-started
	survivor := make(chan error, 1)
	go func() {
		_, err := s.compile(context.Background(), input)
		survivor <- err
	}()
	for s.stats()["coalesced"].(int) < 1 {
		time.Sleep(5 * time.Millisecond)
	}
	cancel()
	if err := <-cancelled; !errors.Is(err, errClientCancelled) {
		t.Fatalf("expected cancellation, got %v", err)
	}
	close(release)
	if err := <-survivor; err != nil {
		t.Fatalf("remaining waiter must get the result: %v", err)
	}
	if runs.Load() != 1 {
		t.Fatalf("expected one compile, got %d", runs.Load())
	}
}

func TestCompileCancelsWhenLastWaiterLeaves(t *testing.T) {
	s, _, started, _ := blockingLatexService(t)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		_, err := s.compile(ctx, compileRequest{Latex: "alone"})
		done <- err
	}()
	<-started
	cancel()
	if err := <-done; !errors.Is(err, errClientCancelled) {
		t.Fatalf("expected cancellation, got %v", err)
	}
	deadline := time.Now().Add(2 * time.Second)
	for s.queue.stats()["active"] != 0 && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	if s.queue.stats()["active"] != 0 {
		t.Fatal("cancelled compile must release its worker slot")
	}
	if s.cache.get(compileHash("alone", nil, nil)) != nil {
		t.Fatal("cancelled compile must not be cached")
	}
}

func TestValidateWordASTAllowsOnlyExactPageBreak(t *testing.T) {
	check := func(format, text string) error {
		var total, count int
		return validateWordAST(map[string]any{"blocks": []any{map[string]any{"t": "RawBlock", "c": []any{format, text}}}}, &total, &count)
	}
	if err := check("openxml", wordPageBreak); err != nil {
		t.Fatalf("page break must be accepted: %v", err)
	}
	for _, raw := range [][2]string{
		{"openxml", wordPageBreak + "<w:p/>"},
		{"openxml", `<w:p><w:r><w:instrText>INCLUDETEXT "x"</w:instrText></w:r></w:p>`},
		{"html", wordPageBreak},
		{"latex", `\input{/etc/passwd}`},
	} {
		if err := check(raw[0], raw[1]); err == nil {
			t.Fatalf("raw block %q must be rejected", raw)
		}
	}
}
