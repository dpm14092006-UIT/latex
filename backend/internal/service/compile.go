package service

import (
	"container/list"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

const (
	maxLatexBytes       = 800 << 10
	maxDocumentImages   = 8
	maxDocumentImage    = 450 << 10
	maxAllImageBytes    = 3500 << 10
	maxOneAssetBytes    = 10 << 20
	maxAllAssetBytes    = 24 << 20
	maxAssets           = 100
	maxCacheBytes       = 32 << 20
	maxCacheEntries     = 32
	maxPdfBytes         = 75 << 20
	maxTexCommandTime   = 30 * time.Second
	defaultTexImageName = "vietlatex-tex:local"
)

var (
	imageFilenamePattern       = regexp.MustCompile(`^image-\d+\.(?:png|jpg)$`)
	bibliographyPattern        = regexp.MustCompile(`\\(?:bibliography|addbibresource)(?:\[[^\]]*\])?\s*\{`)
	latexLinePattern           = regexp.MustCompile(`(?:document\.tex:|\bl\.)(\d+)`)
	latexDetailPattern         = regexp.MustCompile(`(?i)not found|cannot find|Fatal error|\.tex:\d+|^l\.\d+|found no \\citation commands|couldn't open (?:database|style) file`)
	unresolvedCitationsPattern = regexp.MustCompile(`(?is)(?:warning:\s*[^\r\n]*citation\s+[^\r\n]*(?:\r?\n[^\r\n]*)?undefined|there were undefined citations)`)
	allowedAssets              = map[string]bool{".tex": true, ".bib": true, ".bst": true, ".sty": true, ".cls": true, ".png": true, ".jpg": true, ".jpeg": true, ".pdf": true, ".eps": true, ".csv": true, ".txt": true}
)

// Commands that read .aux/.toc data back and need another pass: the \ref
// family (\autoref, \cref, \nameref, \hyperref[...], but not \href), the
// \cite family (\citep, \parencite, ...) and lists of contents/figures.
var rerunPattern = regexp.MustCompile(`\\(?:ref|[a-zA-Z]*[a-gi-zA-Z]ref|[a-zA-Z]*cite[a-zA-Z]*|tableofcontents|listof[a-zA-Z]+|bibliography)\b`)

type encodedAsset struct {
	Filename string `json:"filename"`
	Data     string `json:"data"`
}

type compileRequest struct {
	Latex  string         `json:"latex"`
	Images []encodedAsset `json:"images"`
	Assets []encodedAsset `json:"assets"`
	Fresh  bool           `json:"fresh"`
}

type fileAsset struct {
	filename string
	data     []byte
}

type cacheEntry struct {
	key  string
	data []byte
}

type pdfCache struct {
	mu    sync.Mutex
	items map[string]*list.Element
	order *list.List
	bytes int
	hits  int
}

func newPDFCache() *pdfCache {
	return &pdfCache{items: make(map[string]*list.Element), order: list.New()}
}

func (c *pdfCache) get(key string) []byte {
	c.mu.Lock()
	defer c.mu.Unlock()
	element := c.items[key]
	if element == nil {
		return nil
	}
	c.order.MoveToBack(element)
	return element.Value.(*cacheEntry).data
}

func (c *pdfCache) hit() {
	c.mu.Lock()
	c.hits++
	c.mu.Unlock()
}

func (c *pdfCache) put(key string, data []byte) {
	if len(data) > maxCacheBytes {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if previous := c.items[key]; previous != nil {
		c.bytes -= len(previous.Value.(*cacheEntry).data)
		c.order.Remove(previous)
		delete(c.items, key)
	}
	for c.bytes+len(data) > maxCacheBytes || c.order.Len() >= maxCacheEntries {
		oldest := c.order.Front()
		if oldest == nil {
			break
		}
		entry := oldest.Value.(*cacheEntry)
		c.bytes -= len(entry.data)
		delete(c.items, entry.key)
		c.order.Remove(oldest)
	}
	copyOfData := append([]byte(nil), data...)
	element := c.order.PushBack(&cacheEntry{key: key, data: copyOfData})
	c.items[key] = element
	c.bytes += len(copyOfData)
}

func (c *pdfCache) clear() map[string]any {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.items = make(map[string]*list.Element)
	c.order.Init()
	c.bytes = 0
	return map[string]any{"cleared": true}
}

func (c *pdfCache) stats() (int, int, int) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.bytes, c.order.Len(), c.hits
}

// compileFlight is one XeLaTeX run shared by every request for identical
// input. It is cancelled only when the last interested request goes away.
type compileFlight struct {
	done    chan struct{}
	pdf     []byte
	err     error
	waiters int
	cancel  context.CancelFunc
}

type latexService struct {
	queue          *compileQueue
	cache          *pdfCache
	controllers    map[uint64]context.CancelFunc
	nextController uint64
	flights        map[string]*compileFlight
	warm           *warmPool
	workers        *workerController
	compileTimes   *durationStats
	coalesced      int
	compileFailed  int
	stopMaintain   chan struct{}
	stopOnce       sync.Once
	startOnce      sync.Once
	flightWG       sync.WaitGroup
	stopping       bool
	mu             sync.Mutex
	// compileFn is replaced in tests; production uses compileDocument.
	compileFn func(ctx context.Context, latex string, files []fileAsset) ([]byte, error)
}

func newLatexService() *latexService {
	workers := newWorkerController()
	s := &latexService{queue: newCompileQueue(workers.initial, 8), cache: newPDFCache(), controllers: make(map[uint64]context.CancelFunc), flights: make(map[string]*compileFlight), workers: workers, compileTimes: newDurationStats(), stopMaintain: make(chan struct{})}
	s.warm = newWarmPool(currentWarmConfig())
	s.warm.setWorkerLimit(workers.initial)
	s.compileFn = s.compileDocument
	return s
}

func compileWorkerCount() int {
	if configured, ok := compileWorkerOverride(); ok {
		return configured
	}
	return defaultCompileWorkerCount(runtime.NumCPU(), availableMemoryBytes())
}

// compileWorkerOverride reports a fixed worker count from
// VIETLATEX_COMPILE_WORKERS (1..8). Values below 1 or invalid values mean
// automatic sizing.
func compileWorkerOverride() (int, bool) {
	configured, err := strconv.Atoi(strings.TrimSpace(os.Getenv("VIETLATEX_COMPILE_WORKERS")))
	if err != nil || configured < 1 {
		return 0, false
	}
	return min(configured, 8), true
}

// cpuWorkerLimit allows at most one XeLaTeX worker per two logical CPUs,
// with a hard ceiling to keep this local service responsive.
func cpuWorkerLimit(cpuCount int) int {
	return max(1, min(8, cpuCount/2))
}

func defaultCompileWorkerCount(cpuCount int, availableBytes uint64) int {
	cpuLimit := cpuWorkerLimit(cpuCount)

	// Each XeLaTeX process used about 250 MiB in the local load profile. Keep
	// worker tiers conservative so other desktop apps retain usable memory.
	const mib = uint64(1024 * 1024)
	var memoryLimit int
	switch {
	case availableBytes == 0: // Unknown memory: favor a safe desktop default.
		memoryLimit = 4
	case availableBytes < 1_000*mib:
		memoryLimit = 1
	case availableBytes < 1_500*mib:
		memoryLimit = 2
	case availableBytes < 2_500*mib:
		memoryLimit = 4
	case availableBytes < 4_000*mib:
		memoryLimit = 6
	default:
		memoryLimit = 8
	}
	if memoryLimit > cpuLimit {
		return cpuLimit
	}
	return memoryLimit
}

func (s *latexService) stats() map[string]any {
	stats := map[string]any{}
	for key, value := range s.queue.stats() {
		stats[key] = value
	}
	cacheBytes, cacheEntries, cacheHits := s.cache.stats()
	stats["cacheBytes"] = cacheBytes
	stats["cacheEntries"] = cacheEntries
	stats["cacheHits"] = cacheHits
	s.mu.Lock()
	stats["coalesced"] = s.coalesced
	stats["compileFailed"] = s.compileFailed
	s.mu.Unlock()
	warm := s.warm.stats()
	stats["warmIdle"] = warm.idle
	stats["warmHits"] = warm.hits
	stats["warmMisses"] = warm.misses
	stats["warm"] = map[string]any{"mode": warm.mode, "target": warm.target, "active": warm.active, "spawning": warm.spawning, "released": warm.released}
	stats["workers"] = s.workers.stats(s.queue.currentLimit())
	stats["waitMs"] = s.queue.waitTimes.snapshot()
	stats["compileMs"] = s.compileTimes.snapshot()
	return stats
}

func (s *latexService) clearCache() map[string]any { return s.cache.clear() }

func (s *latexService) cancelAll() {
	s.mu.Lock()
	s.stopping = true
	cancels := make([]context.CancelFunc, 0, len(s.controllers))
	for _, cancel := range s.controllers {
		cancels = append(cancels, cancel)
	}
	s.mu.Unlock()
	s.queue.close()
	for _, cancel := range cancels {
		cancel()
	}
	s.stopOnce.Do(func() { close(s.stopMaintain) })
	s.warm.close()
	s.flightWG.Wait()
}

// start prewarms XeLaTeX only in eager warm mode, then runs the maintenance
// loop that resizes workers and releases idle warm processes.
func (s *latexService) start() {
	s.startOnce.Do(func() {
		s.warm.startup()
		go sweepStaleWorkDirectories(24 * time.Hour)
		go s.maintain(maintenanceInterval)
	})
}

func (s *latexService) maintain(interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-s.stopMaintain:
			return
		case <-ticker.C:
			s.maintainOnce(time.Now())
		}
	}
}

func (s *latexService) maintainOnce(now time.Time) {
	available := availableMemoryBytes()
	active := s.queue.stats()["active"]
	if limit, changed := s.workers.observe(s.queue.currentLimit(), active, available); changed {
		s.queue.setLimit(limit)
		s.warm.setWorkerLimit(limit)
	}
	s.warm.maintain(now, available)
}

// sweepStaleWorkDirectories removes compile directories left behind by
// crashed or force-killed sessions.
func sweepStaleWorkDirectories(age time.Duration) {
	for _, pattern := range []string{"viet-latex-*", "vietlatex-word-*", "vietlatex-source-*"} {
		matches, _ := filepath.Glob(filepath.Join(os.TempDir(), pattern))
		for _, path := range matches {
			if info, err := os.Stat(path); err == nil && info.IsDir() && time.Since(info.ModTime()) > age {
				_ = os.RemoveAll(path)
			}
		}
	}
}

func (s *latexService) compile(parent context.Context, input compileRequest) ([]byte, error) {
	if parent.Err() != nil {
		return nil, errClientCancelled
	}
	s.mu.Lock()
	stopping := s.stopping
	s.mu.Unlock()
	if stopping {
		return nil, backendStoppingError()
	}
	if strings.TrimSpace(input.Latex) == "" {
		return nil, appError(http.StatusBadRequest, "Tài liệu LaTeX đang trống.")
	}
	if len(input.Latex) > maxLatexBytes {
		return nil, appError(http.StatusRequestEntityTooLarge, "Tài liệu vượt quá 800 KB.")
	}
	images, err := validateImages(input.Images)
	if err != nil {
		return nil, err
	}
	assets, err := validateAssets(input.Assets)
	if err != nil {
		return nil, err
	}
	names := make(map[string]struct{}, len(images)+len(assets))
	for _, image := range images {
		names[strings.ToLower(image.filename)] = struct{}{}
	}
	for _, asset := range assets {
		if _, exists := names[strings.ToLower(asset.filename)]; exists {
			return nil, appError(http.StatusBadRequest, fmt.Sprintf("Tài nguyên trùng tên ảnh: %s", asset.filename))
		}
	}

	cacheKey := compileHash(input.Latex, images, assets)
	if !input.Fresh {
		if cached := s.cache.get(cacheKey); cached != nil {
			s.cache.hit()
			return cached, nil
		}
	}

	if parent.Err() != nil {
		return nil, errClientCancelled
	}
	s.mu.Lock()
	if s.stopping {
		s.mu.Unlock()
		return nil, backendStoppingError()
	}
	flight := s.flights[cacheKey]
	if flight != nil {
		s.coalesced++
	} else {
		// A previous flight may have filled the cache since the first lookup.
		if !input.Fresh {
			if cached := s.cache.get(cacheKey); cached != nil {
				s.cache.hit()
				s.mu.Unlock()
				return cached, nil
			}
		}
		flight = s.startFlight(cacheKey, input.Latex, append(images, assets...))
	}
	flight.waiters++
	s.mu.Unlock()

	select {
	case <-flight.done:
		return flight.pdf, flight.err
	case <-parent.Done():
		s.mu.Lock()
		flight.waiters--
		if flight.waiters == 0 {
			flight.cancel()
			if s.flights[cacheKey] == flight {
				delete(s.flights, cacheKey)
			}
		}
		s.mu.Unlock()
		return nil, errClientCancelled
	}
}

// startFlight must be called with s.mu held.
func (s *latexService) startFlight(key, latex string, files []fileAsset) *compileFlight {
	ctx, cancel := context.WithCancel(context.Background())
	s.nextController++
	controllerID := s.nextController
	s.controllers[controllerID] = cancel
	flight := &compileFlight{done: make(chan struct{}), cancel: cancel}
	s.flights[key] = flight
	s.flightWG.Add(1)
	go func() {
		defer s.flightWG.Done()
		flight.pdf, flight.err = s.runFlight(ctx, key, latex, files)
		s.mu.Lock()
		if s.flights[key] == flight {
			delete(s.flights, key)
		}
		delete(s.controllers, controllerID)
		s.mu.Unlock()
		cancel()
		close(flight.done)
	}()
	return flight
}

func (s *latexService) runFlight(ctx context.Context, key, latex string, files []fileAsset) ([]byte, error) {
	if err := s.queue.acquire(ctx); err != nil {
		return nil, err
	}
	defer s.queue.release()
	if ctx.Err() != nil {
		return nil, errClientCancelled
	}
	started := time.Now()
	pdf, err := s.compileFn(ctx, latex, files)
	if !errors.Is(err, errClientCancelled) && ctx.Err() == nil {
		s.compileTimes.add(time.Since(started))
		if err != nil {
			s.mu.Lock()
			s.compileFailed++
			s.mu.Unlock()
		}
	}
	if err != nil {
		return nil, err
	}
	s.cache.put(key, pdf)
	return pdf, nil
}

func validateImages(images []encodedAsset) ([]fileAsset, error) {
	if len(images) > maxDocumentImages {
		return nil, appError(http.StatusBadRequest, fmt.Sprintf("Danh sách hình ảnh không hợp lệ hoặc vượt quá %d ảnh.", maxDocumentImages))
	}
	seen := make(map[string]struct{}, len(images))
	total := 0
	result := make([]fileAsset, 0, len(images))
	for _, image := range images {
		name := strings.ToLower(image.Filename)
		if !imageFilenamePattern.MatchString(image.Filename) || image.Data == "" {
			return nil, appError(http.StatusBadRequest, "Tệp hình ảnh đính kèm không hợp lệ.")
		}
		if _, ok := seen[name]; ok {
			return nil, appError(http.StatusBadRequest, "Tệp hình ảnh đính kèm không hợp lệ.")
		}
		seen[name] = struct{}{}
		if len(image.Data) > base64.StdEncoding.EncodedLen(min(maxDocumentImage, maxAllImageBytes-total)) {
			return nil, appError(http.StatusRequestEntityTooLarge, "Ảnh vượt giới hạn 450 KB/tệp hoặc 3,5 MB/tài liệu.")
		}
		data, err := decodeBase64(image.Data)
		if err != nil || len(data) == 0 || len(data) > maxDocumentImage {
			return nil, appError(http.StatusRequestEntityTooLarge, "Tệp hình ảnh rỗng hoặc vượt quá giới hạn 450 KB.")
		}
		total += len(data)
		if total > maxAllImageBytes {
			return nil, appError(http.StatusRequestEntityTooLarge, "Tổng dung lượng hình ảnh vượt quá 3,5 MB.")
		}
		if strings.HasSuffix(image.Filename, ".png") {
			if len(data) < 8 || string(data[:8]) != "\x89PNG\r\n\x1a\n" {
				return nil, appError(http.StatusBadRequest, fmt.Sprintf("Định dạng của %s không khớp với dữ liệu ảnh.", image.Filename))
			}
		} else if len(data) < 3 || data[0] != 0xff || data[1] != 0xd8 || data[2] != 0xff {
			return nil, appError(http.StatusBadRequest, fmt.Sprintf("Định dạng của %s không khớp với dữ liệu ảnh.", image.Filename))
		}
		result = append(result, fileAsset{filename: image.Filename, data: data})
	}
	return result, nil
}

func validateAssets(assets []encodedAsset) ([]fileAsset, error) {
	if len(assets) > maxAssets {
		return nil, appError(http.StatusBadRequest, "Tối đa 100 tệp tài nguyên trong mỗi tài liệu.")
	}
	seen := make(map[string]struct{}, len(assets))
	total := 0
	result := make([]fileAsset, 0, len(assets))
	for _, asset := range assets {
		if !safeAssetPath(asset.Filename) {
			return nil, appError(http.StatusBadRequest, fmt.Sprintf("Đường dẫn tài nguyên không hợp lệ hoặc trùng: %s", asset.Filename))
		}
		name := strings.ToLower(asset.Filename)
		if _, exists := seen[name]; exists {
			return nil, appError(http.StatusBadRequest, fmt.Sprintf("Đường dẫn tài nguyên không hợp lệ hoặc trùng: %s", asset.Filename))
		}
		seen[name] = struct{}{}
		if len(asset.Data) > base64.StdEncoding.EncodedLen(min(maxOneAssetBytes, maxAllAssetBytes-total)) {
			return nil, appError(http.StatusRequestEntityTooLarge, "Tài nguyên vượt giới hạn 10 MB/tệp hoặc 24 MB/tài liệu.")
		}
		data, err := decodeBase64(asset.Data)
		if err != nil {
			return nil, appError(http.StatusBadRequest, "Dữ liệu tài nguyên không hợp lệ.")
		}
		if len(data) > maxOneAssetBytes {
			return nil, appError(http.StatusRequestEntityTooLarge, "Tài nguyên vượt giới hạn 10 MB/tệp hoặc 24 MB/tài liệu.")
		}
		total += len(data)
		if total > maxAllAssetBytes {
			return nil, appError(http.StatusRequestEntityTooLarge, "Tài nguyên vượt giới hạn 10 MB/tệp hoặc 24 MB/tài liệu.")
		}
		result = append(result, fileAsset{filename: asset.Filename, data: data})
	}
	return result, nil
}

func decodeBase64(value string) ([]byte, error) {
	if len(value)%4 != 0 || strings.ContainsAny(value, "\r\n") {
		return nil, errors.New("invalid base64 length")
	}
	data, err := base64.StdEncoding.Strict().DecodeString(value)
	if err != nil {
		return nil, errors.New("invalid base64 data")
	}
	return data, nil
}

func safeAssetPath(value string) bool {
	if value == "" || len(value) > 200 || strings.ContainsAny(value, `\:<>"|?*`) || strings.IndexFunc(value, func(r rune) bool { return r < 0x20 }) >= 0 {
		return false
	}
	if strings.HasPrefix(value, "/") || strings.Contains(value, "//") {
		return false
	}
	parts := strings.Split(value, "/")
	for _, part := range parts {
		if part == "" || part == "." || part == ".." || strings.HasSuffix(part, ".") || strings.HasSuffix(part, " ") || windowsReservedName(part) {
			return false
		}
	}
	base := parts[len(parts)-1]
	extension := strings.ToLower(filepath.Ext(base))
	if !allowedAssets[extension] || strings.EqualFold(base, "document.tex") || strings.EqualFold(base, "document.pdf") {
		return false
	}
	return true
}

func windowsReservedName(part string) bool {
	name := strings.ToUpper(strings.SplitN(part, ".", 2)[0])
	if name == "CON" || name == "PRN" || name == "AUX" || name == "NUL" {
		return true
	}
	if len(name) == 4 && (strings.HasPrefix(name, "COM") || strings.HasPrefix(name, "LPT")) && name[3] >= '1' && name[3] <= '9' {
		return true
	}
	return false
}

func compileHash(latex string, images, assets []fileAsset) string {
	hash := sha256.New()
	writeHashField(hash, []byte("vietlatex-compile-cache-v2"))
	// \today uses the TeX process's local date, so cached PDFs must expire at
	// local midnight rather than UTC midnight (07:00 in Vietnam).
	writeHashField(hash, []byte(time.Now().Format("2006-01-02")))
	writeHashField(hash, []byte(latex))
	writeHashField(hash, []byte(fmt.Sprint(len(images))))
	for _, image := range images {
		writeHashField(hash, []byte(image.filename))
		writeHashField(hash, image.data)
	}
	writeHashField(hash, []byte(fmt.Sprint(len(assets))))
	for _, asset := range assets {
		writeHashField(hash, []byte(asset.filename))
		writeHashField(hash, asset.data)
	}
	return fmt.Sprintf("%x", hash.Sum(nil))
}

func writeHashField(writer interface{ Write([]byte) (int, error) }, value []byte) {
	var length [8]byte
	binary.BigEndian.PutUint64(length[:], uint64(len(value)))
	_, _ = writer.Write(length[:])
	_, _ = writer.Write(value)
}

func randomID() (string, error) {
	var bytes [16]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes[:]), nil
}

func (s *latexService) compileDocument(ctx context.Context, latex string, files []fileAsset) ([]byte, error) {
	run := &texRun{ctx: ctx, first: s.warm.take()}
	if run.first != nil {
		run.directory = run.first.directory
	} else {
		created, err := os.MkdirTemp("", "viet-latex-")
		if err != nil {
			return nil, appError(http.StatusInternalServerError, "Không tạo được thư mục biên dịch tạm.")
		}
		run.directory = created
	}
	defer run.cleanup()
	directory := run.directory
	source := filepath.Join(directory, "document.tex")
	pdf := filepath.Join(directory, "document.pdf")
	if err := os.WriteFile(source, []byte(latex), 0o600); err != nil {
		return nil, appError(http.StatusInternalServerError, "Không ghi được tài liệu LaTeX tạm.")
	}
	for _, file := range files {
		target := filepath.Join(directory, filepath.FromSlash(file.filename))
		if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
			return nil, appError(http.StatusInternalServerError, "Không tạo được thư mục tài nguyên tạm.")
		}
		if err := os.WriteFile(target, file.data, 0o600); err != nil {
			return nil, appError(http.StatusInternalServerError, "Không ghi được tài nguyên tạm.")
		}
	}

	run.source = source
	needsBibliography := bibliographyPattern.MatchString(latex)
	var compileErr error
	if !needsBibliography && !rerunPattern.MatchString(latex) {
		compileErr = run.singlePass()
	} else {
		compileErr = run.multiPass(needsBibliography)
	}
	if compileErr != nil {
		return nil, latexError(compileErr)
	}
	if log, err := os.ReadFile(filepath.Join(directory, "document.log")); err == nil && unresolvedCitationsPattern.Match(log) {
		return nil, &serviceError{status: http.StatusUnprocessableEntity, message: "Trích dẫn chưa được giải quyết trong PDF. Kiểm tra khóa REF và danh mục BibTeX; không thể xuất bản có trích dẫn [?].", log: logTail(string(log))}
	}
	return readCompiledPDF(pdf)
}

// texRun drives the XeLaTeX passes for one document directory, using warm
// processes when available and pre-starting the next pass while one runs.
type texRun struct {
	ctx       context.Context
	source    string
	directory string
	first     *warmTeX
	next      *warmTeX
}

func (r *texRun) close() {
	for _, warm := range []*warmTeX{r.first, r.next} {
		if warm != nil {
			warm.discard()
		}
	}
	r.first, r.next = nil, nil
}

// cleanup stops leftover warm processes before removing the work directory.
// Windows refuses to delete a directory that is a live process's working
// directory, so removing it first leaked the directory whenever a pass failed
// or was cancelled after the next pass had been prestarted.
func (r *texRun) cleanup() {
	r.close()
	if r.directory != "" {
		_ = os.RemoveAll(r.directory)
	}
}

// pass runs one -no-pdf XeLaTeX pass. prestart spawns the following pass's
// process in the same directory so its startup overlaps this pass.
func (r *texRun) pass(prestart bool) error {
	warm := r.first
	r.first = nil
	if warm == nil {
		warm, r.next = r.next, nil
	}
	if prestart && warmEnabled() {
		if next, err := spawnWarmXeLatex(r.directory); err == nil {
			r.next = next
		}
	}
	if warm != nil {
		if err := warm.run(r.ctx, maxTexCommandTime); !errors.Is(err, errWarmUnavailable) {
			return err
		}
	}
	return runXeLatex(r.ctx, r.source, r.directory, true)
}

func (r *texRun) singlePass() error {
	if !warmEnabled() {
		// Docker sandbox: one container run that also writes the PDF.
		return runXeLatex(r.ctx, r.source, r.directory, false)
	}
	if err := r.pass(false); err != nil {
		return err
	}
	return runXdvipdfmx(r.ctx, r.source, r.directory)
}

// Upper bound on XeLaTeX passes for one document; guards against packages
// whose auxiliary output never settles.
const maxXeLatexPasses = 4

// multiPass runs intermediate passes with -no-pdf (skipping font
// embedding), reruns only while cross-reference files still change, then
// converts the final XDV to PDF once.
func (r *texRun) multiPass(needsBibliography bool) error {
	previous := auxiliaryState(r.directory)
	if err := r.pass(true); err != nil {
		return err
	}
	passes := 1
	if needsBibliography {
		if err := runBibtex(r.ctx, r.directory); err != nil {
			return err
		}
		if err := r.pass(true); err != nil {
			return err
		}
		passes++
	}
	for current := auxiliaryState(r.directory); current != previous && passes < maxXeLatexPasses; current = auxiliaryState(r.directory) {
		previous = current
		if err := r.pass(passes+1 < maxXeLatexPasses); err != nil {
			return err
		}
		passes++
	}
	if r.next != nil {
		r.next.discard()
		r.next = nil
	}
	return runXdvipdfmx(r.ctx, r.source, r.directory)
}

// auxiliaryState fingerprints the files that feed back into the next pass.
func auxiliaryState(directory string) string {
	hash := sha256.New()
	for _, extension := range []string{".aux", ".toc", ".lof", ".lot", ".out"} {
		data, err := os.ReadFile(filepath.Join(directory, "document"+extension))
		if err != nil {
			writeHashField(hash, []byte("-"))
			continue
		}
		writeHashField(hash, []byte("+"))
		writeHashField(hash, data)
	}
	return string(hash.Sum(nil))
}

func runBibtex(ctx context.Context, directory string) error {
	program := "bibtex"
	if _, err := os.Stat(filepath.Join(directory, "document.bcf")); err == nil {
		program = "biber"
	}
	if os.Getenv("VIETLATEX_SANDBOX") == "docker" {
		return runSandboxProgram(ctx, program, []string{"document"}, directory)
	}
	bibtex, err := texCompanion(program)
	if err != nil {
		return err
	}
	_, err = runCommand(ctx, bibtex, []string{"document"}, directory, maxTexCommandTime)
	var command *commandError
	if errors.As(err, &command) && command.missing {
		return appError(http.StatusServiceUnavailable, fmt.Sprintf("Không tìm thấy %s để xử lý tài liệu tham khảo. APA 7th cần Biber, biblatex-apa và csquotes trong MacTeX hoặc TeX Live.", program))
	}
	return err
}

func runXdvipdfmx(ctx context.Context, source, directory string) error {
	args := []string{"-q", "-E", "-o", "document.pdf", "document.xdv"}
	if os.Getenv("VIETLATEX_SANDBOX") == "docker" {
		return runSandboxProgram(ctx, "xdvipdfmx", args, directory)
	}
	executable, err := texCompanion("xdvipdfmx")
	if err == nil {
		_, err = runCommand(ctx, executable, args, directory, maxTexCommandTime)
	}

	return err
}

// texCompanion locates a TeX program installed next to XeLaTeX.
func texCompanion(name string) (string, error) {
	xelatex, err := findXeLatex()
	if err != nil {
		return "", err
	}
	if !filepath.IsAbs(xelatex) {
		return name, nil
	}
	companion := filepath.Join(filepath.Dir(xelatex), name)
	return companion, nil
}

func readCompiledPDF(pdf string) ([]byte, error) {
	info, err := os.Stat(pdf)
	if err != nil {
		return nil, latexError(err)
	}
	if info.Size() < int64(len("%PDF-")) {
		return nil, appError(http.StatusInternalServerError, "XeLaTeX không tạo được tệp PDF hợp lệ.")
	}
	if info.Size() > maxPdfBytes {
		return nil, appError(http.StatusRequestEntityTooLarge, "PDF vượt quá giới hạn 75 MB.")
	}
	data, err := os.ReadFile(pdf)
	if err != nil {
		return nil, appError(http.StatusInternalServerError, "Không đọc được PDF đã biên dịch.")
	}
	if len(data) < len("%PDF-") || string(data[:len("%PDF-")]) != "%PDF-" {
		return nil, appError(http.StatusInternalServerError, "XeLaTeX không tạo được tệp PDF hợp lệ.")
	}
	return data, nil
}

func runXeLatex(ctx context.Context, source, directory string, noPDF bool) error {
	args := []string{"-interaction=nonstopmode", "-halt-on-error", "-file-line-error", "-no-shell-escape"}
	if os.Getenv("VIETLATEX_SANDBOX") == "docker" {
		if noPDF {
			args = append(args, "-no-pdf")
		}
		return runSandboxProgram(ctx, "xelatex", append(args, "document.tex"), directory)
	}
	executable, err := findXeLatex()
	if err != nil {
		return err
	}
	// Keep the TeX file name relative: absolute paths may contain ~ or %.
	// Invoke the PDF driver directly. XeTeX's shell-based output driver
	// strips quotes from app bundle paths containing spaces on macOS.
	args = append(args, "-no-pdf", "-output-directory", directory, filepath.Base(source))
	if _, err = runCommand(ctx, executable, args, directory, maxTexCommandTime); err != nil || noPDF {
		return err
	}
	driver, err := texCompanion("xdvipdfmx")
	if err != nil {
		return err
	}
	_, err = runCommand(ctx, driver, []string{"-q", "-E", "-o", "document.pdf", "document.xdv"}, directory, maxTexCommandTime)
	return err
}

func runSandboxProgram(ctx context.Context, program string, args []string, directory string) error {
	name, err := randomID()
	if err != nil {
		return appError(http.StatusInternalServerError, "Không tạo được phiên biên dịch an toàn.")
	}
	container := "vietlatex-" + name
	image := os.Getenv("VIETLATEX_TEX_IMAGE")
	if image == "" {
		image = defaultTexImageName
	}
	allArgs := []string{"run", "--name", container, "--rm", "--pull=never", "--network=none", "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges", "--pids-limit=64", "--memory=768m", "--cpus=2", "--tmpfs", "/tmp:rw,size=128m", "--mount", fmt.Sprintf("type=bind,source=%s,target=/work", directory), "--workdir", "/work", image, program}
	allArgs = append(allArgs, args...)
	_, runErr := runCommand(ctx, "docker", allArgs, "", maxTexCommandTime)
	cleanupCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, _ = runCommand(cleanupCtx, "docker", []string{"rm", "--force", container}, "", 5*time.Second)
	return runErr
}

func latexError(err error) error {
	if errors.Is(err, errClientCancelled) {
		return errClientCancelled
	}
	var known *serviceError
	if errors.As(err, &known) {
		return known
	}
	var command *commandError
	if errors.As(err, &command) {
		if command.missing {
			return appError(http.StatusServiceUnavailable, "Không tìm thấy XeLaTeX. Cài MacTeX hoặc TeX Live, rồi mở lại ứng dụng.")
		}
		if command.timeout {
			return appError(http.StatusGatewayTimeout, "Biên dịch vượt quá thời gian 30 giây.")
		}
		detail := command.output
		if detail == "" {
			detail = command.Error()
		}
		return formatLatexError(detail)
	}
	return formatLatexError(err.Error())
}

func formatLatexError(detail string) error {
	line := 0
	if match := latexLinePattern.FindStringSubmatch(detail); len(match) == 2 {
		_, _ = fmt.Sscan(match[1], &line)
	}
	selected := make([]string, 0, 8)
	for _, part := range strings.Split(detail, "\n") {
		trimmed := strings.TrimRight(part, "\r")
		if strings.HasPrefix(trimmed, "!") || latexDetailPattern.MatchString(trimmed) {
			selected = append(selected, trimmed)
			if len(selected) == 8 {
				break
			}
		}
	}
	joined := strings.Join(selected, " ")
	if joined == "" {
		joined = "Hãy xem nhật ký biên dịch."
	}
	prefix := ""
	if line > 0 {
		prefix = fmt.Sprintf("Dòng %d: ", line)
	}
	message := fmt.Sprintf("%sXeLaTeX chưa biên dịch được tài liệu. %s", prefix, joined)
	return &serviceError{status: http.StatusUnprocessableEntity, message: message, log: logTail(detail), line: line}
}

// logTail keeps the end of a compiler log, where TeX reports the failure,
// without starting in the middle of a UTF-8 sequence.
func logTail(log string) string {
	const maxLogBytes = 32_000
	if len(log) <= maxLogBytes {
		return log
	}
	start := len(log) - maxLogBytes
	for start < len(log) && !utf8.RuneStart(log[start]) {
		start++
	}
	return log[start:]
}

func findXeLatex() (string, error) {
	candidates := []string{os.Getenv("XELATEX_PATH")}
	for _, root := range []string{os.Getenv("VIETLATEX_RESOURCES_PATH"), filepath.Join(os.Getenv("VIETLATEX_APP_PATH"), "tools")} {
		if root != "" && filepath.IsAbs(root) {
			candidates = append(candidates, filepath.Join(root, "tex", "bin", "universal-darwin", "xelatex"))
		}
	}
	switch runtime.GOOS {
	case "darwin":
		candidates = append(candidates, "/Library/TeX/texbin/xelatex", "/opt/homebrew/bin/xelatex", "/usr/local/bin/xelatex", "/opt/local/bin/xelatex")
		if home, err := os.UserHomeDir(); err == nil {
			candidates = append(candidates, filepath.Join(home, "bin", "xelatex"))
		}
	default:
		candidates = append(candidates, "/usr/bin/xelatex", "/usr/local/bin/xelatex")
	}
	for _, candidate := range candidates {
		if candidate == "" || !filepath.IsAbs(candidate) {
			continue
		}
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() && info.Mode()&0111 != 0 {
			return candidate, nil
		}
	}
	if executable, err := exec.LookPath("xelatex"); err == nil {
		return executable, nil
	}
	return "", &commandError{missing: true}
}

func (s *latexService) environment(ctx context.Context) map[string]any {
	if os.Getenv("VIETLATEX_SANDBOX") == "docker" {
		image := os.Getenv("VIETLATEX_TEX_IMAGE")
		if image == "" {
			image = defaultTexImageName
		}
		if _, err := runCommand(ctx, "docker", []string{"image", "inspect", image}, "", 5*time.Second); err != nil {
			return map[string]any{"available": false, "sandbox": "docker", "error": fmt.Sprintf("Docker hoặc image %s chưa sẵn sàng. %s", image, err.Error())}
		}
		return map[string]any{"available": true, "executable": "docker", "version": "XeLaTeX — " + image, "sandbox": "docker"}
	}
	executable, err := findXeLatex()
	if err != nil {
		return map[string]any{"available": false, "error": "Không tìm thấy XeLaTeX. Cài MacTeX hoặc TeX Live rồi khởi động lại ứng dụng.", "help": "Cài MacTeX hoặc TeX Live rồi khởi động lại ứng dụng."}
	}
	version, err := runCommand(ctx, executable, []string{"--version"}, "", 5*time.Second)
	if err != nil {
		return map[string]any{"available": false, "executable": executable, "error": err.Error(), "help": "Cài MacTeX hoặc TeX Live rồi khởi động lại ứng dụng."}
	}
	firstLine := strings.SplitN(strings.TrimSpace(string(version)), "\n", 2)[0]
	return map[string]any{"available": true, "executable": executable, "version": strings.TrimSuffix(firstLine, "\r"), "sandbox": "local"}
}
