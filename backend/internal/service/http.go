package service

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

const maxJSONRequestBytes = 40 << 20

type Service struct {
	token            string
	latex            *latexService
	word             *wordService
	started          time.Time
	doiQueue         *compileQueue
	diagnosticsQueue *compileQueue
	lifecycle        context.Context
	cancel           context.CancelFunc

	shutdownOnce sync.Once
	shutdownCh   chan struct{}
}

func New(token string) *Service {
	latex := newLatexService()
	word := newWordService()
	lifecycle, cancel := context.WithCancel(context.Background())
	return &Service{
		token:            token,
		latex:            latex,
		word:             word,
		started:          time.Now(),
		doiQueue:         newCompileQueue(4, 8),
		diagnosticsQueue: newCompileQueue(1, 2),
		lifecycle:        lifecycle,
		cancel:           cancel,
		shutdownCh:       make(chan struct{}),
	}
}

func (s *Service) ShutdownRequested() <-chan struct{} { return s.shutdownCh }

// Start launches background maintenance: adaptive worker sizing, warm
// XeLaTeX pool upkeep and stale temp-directory cleanup.
func (s *Service) Start() { s.latex.start() }

func (s *Service) CancelActiveCompiles() {
	s.cancel()
	s.doiQueue.close()
	s.diagnosticsQueue.close()
	s.latex.cancelAll()
	s.word.cancelAll()
}

func (s *Service) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", s.health)
	mux.HandleFunc("GET /api/environment", s.environment)
	mux.HandleFunc("POST /api/cache/clear", s.clearCache)
	mux.HandleFunc("POST /api/compile", s.compile)
	mux.HandleFunc("POST /api/word/import", s.importWord)
	mux.HandleFunc("POST /api/word/export", s.exportWord)
	mux.HandleFunc("POST /api/latex/parse", s.parseLatex)
	mux.HandleFunc("POST /api/doi", s.doiLookup)
	mux.HandleFunc("POST /api/shutdown", s.shutdown)
	return s.authorize(mux)
}

func (s *Service) authorize(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !allowedOrigin(r.Header.Get("Origin")) {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "Nguồn yêu cầu không được phép."})
			return
		}
		provided := r.Header.Get("X-Vietlatex-Token")
		if len(provided) != len(s.token) || subtle.ConstantTimeCompare([]byte(provided), []byte(s.token)) != 1 {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Phiên backend không hợp lệ."})
			return
		}
		// Shutdown propagates cancellation to diagnostics and DOI network
		// calls, in addition to tracked compiler processes.
		ctx, cancel := context.WithCancel(r.Context())
		stop := context.AfterFunc(s.lifecycle, cancel)
		defer stop()
		defer cancel()
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func allowedOrigin(raw string) bool {
	if raw == "" {
		return true
	}
	origin, err := url.Parse(raw)
	if err != nil || origin.User != nil || (origin.Scheme != "http" && origin.Scheme != "https") {
		return false
	}
	host := strings.ToLower(origin.Hostname())
	return host == "127.0.0.1" || host == "localhost" || host == "::1"
}

func (s *Service) health(w http.ResponseWriter, _ *http.Request) {
	var memory runtime.MemStats
	runtime.ReadMemStats(&memory)
	system := map[string]any{
		"availableMemoryBytes": availableMemoryBytes(),
		"cpus":                 runtime.NumCPU(),
		"uptimeSec":            int(time.Since(s.started).Seconds()),
		"backendHeapBytes":     memory.HeapAlloc,
		"goroutines":           runtime.NumGoroutine(),
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "backend": "go", "compiler": s.latex.stats(), "word": s.word.stats(), "doi": s.doiQueue.stats(), "diagnostics": s.diagnosticsQueue.stats(), "system": system})
}

func (s *Service) environment(w http.ResponseWriter, r *http.Request) {
	if !admitHeavyRequest(w, s.diagnosticsQueue) {
		return
	}
	defer s.diagnosticsQueue.leave()
	if err := s.diagnosticsQueue.acquire(r.Context()); err != nil {
		s.writeFailure(w, r, err)
		return
	}
	defer s.diagnosticsQueue.release()
	compiler := s.latex.environment(r.Context())
	word := s.word.environment(r.Context())
	writeJSON(w, http.StatusOK, map[string]any{"compiler": compiler, "word": word})
}

func (s *Service) clearCache(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.latex.clearCache())
}

func (s *Service) compile(w http.ResponseWriter, r *http.Request) {
	if !admitHeavyRequest(w, s.latex.queue) {
		return
	}
	defer s.latex.queue.leave()
	r.Body = http.MaxBytesReader(w, r.Body, maxJSONRequestBytes)
	var input compileRequest
	if err := decodeSingleJSON(r.Body, &input); err != nil {
		writeDecodeError(w, err)
		return
	}
	pdf, err := s.latex.compile(r.Context(), input)
	if err != nil {
		s.writeFailure(w, r, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Length", strconv.Itoa(len(pdf)))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(pdf)
}

func (s *Service) importWord(w http.ResponseWriter, r *http.Request) {
	if !admitHeavyRequest(w, s.word.queue) {
		return
	}
	defer s.word.queue.leave()
	r.Body = http.MaxBytesReader(w, r.Body, maxWordDocumentBytes)
	bytes, err := io.ReadAll(r.Body)
	if err != nil {
		writeDecodeError(w, err)
		return
	}
	ast, err := s.word.importDocument(r.Context(), bytes)
	if err != nil {
		s.writeFailure(w, r, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(ast)
}

func (s *Service) exportWord(w http.ResponseWriter, r *http.Request) {
	if !admitHeavyRequest(w, s.word.queue) {
		return
	}
	defer s.word.queue.leave()
	r.Body = http.MaxBytesReader(w, r.Body, maxJSONRequestBytes)
	var input json.RawMessage
	if err := decodeSingleJSON(r.Body, &input); err != nil {
		writeDecodeError(w, err)
		return
	}
	bytes, err := s.word.exportDocument(r.Context(), input)
	if err != nil {
		s.writeFailure(w, r, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
	w.Header().Set("Content-Length", strconv.Itoa(len(bytes)))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(bytes)
}

func (s *Service) parseLatex(w http.ResponseWriter, r *http.Request) {
	if !admitHeavyRequest(w, s.word.queue) {
		return
	}
	defer s.word.queue.leave()
	r.Body = http.MaxBytesReader(w, r.Body, 800<<10)
	input, err := io.ReadAll(r.Body)
	if err != nil {
		writeDecodeError(w, err)
		return
	}
	ast, err := s.word.parseLatex(r.Context(), input)
	if err != nil {
		s.writeFailure(w, r, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(ast)
}

func admitHeavyRequest(w http.ResponseWriter, queue *compileQueue) bool {
	if queue.admit() {
		return true
	}
	writeServiceError(w, appError(http.StatusServiceUnavailable, "Máy chủ đang xử lý đủ số yêu cầu nặng. Vui lòng thử lại sau vài giây."))
	return false
}

func (s *Service) shutdown(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]bool{"stopping": true})
	s.shutdownOnce.Do(func() { close(s.shutdownCh) })
}

func writeDecodeError(w http.ResponseWriter, err error) {
	var maxBytesError *http.MaxBytesError
	if errors.As(err, &maxBytesError) {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "Dữ liệu gửi lên vượt quá giới hạn cho phép."})
		return
	}
	writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Dữ liệu yêu cầu không hợp lệ."})
}

// decodeSingleJSON requires exactly one JSON value. Reading through EOF also
// ensures MaxBytesReader accounts for the entire request body instead of
// leaving an unbounded suffix unread after the first value.
func decodeSingleJSON(reader io.Reader, target any) error {
	decoder := json.NewDecoder(reader)
	if err := decoder.Decode(target); err != nil {
		return err
	}
	// Scan only whitespace after the first value. Decoding a second value
	// would allocate its entire object/string just to reject it.
	tail := io.MultiReader(decoder.Buffered(), reader)
	var buffer [4096]byte
	for {
		n, err := tail.Read(buffer[:])
		for _, value := range buffer[:n] {
			if value != ' ' && value != '\t' && value != '\r' && value != '\n' {
				return errors.New("multiple JSON values or trailing data")
			}
		}
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
	}
}

// writeFailure reports err unless the client has already gone away. Work
// cut short by backend shutdown also cancels the request context; answer it
// with 503 instead of letting the handler return an empty 200 response.
func (s *Service) writeFailure(w http.ResponseWriter, r *http.Request, err error) {
	if errors.Is(err, errClientCancelled) || r.Context().Err() != nil {
		if s.lifecycle.Err() != nil {
			writeServiceError(w, backendStoppingError())
		}
		return
	}
	writeServiceError(w, err)
}

func writeServiceError(w http.ResponseWriter, err error) {
	appErr := asServiceError(err)
	body := map[string]any{"error": appErr.message}
	if appErr.log != "" {
		body["log"] = appErr.log
	}
	if appErr.line > 0 {
		body["line"] = appErr.line
	}
	if appErr.status == http.StatusServiceUnavailable {
		w.Header().Set("Retry-After", "3")
	}
	writeJSON(w, appErr.status, body)
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
