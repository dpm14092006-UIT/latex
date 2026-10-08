package service

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

const (
	maxWordDocumentBytes = 25 << 20
	maxWordImageBytes    = 24 << 20
	maxWordASTBytes      = 32 << 20
	maxWordArchiveBytes  = 64 << 20
	maxWordArchiveFiles  = 300
	wordPageBreak        = `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`
)

var (
	wordImageSourcePattern = regexp.MustCompile(`^data:image/(png|jpeg);base64,`)
	unsafeSchemePattern    = regexp.MustCompile(`(?i)^[a-z]+:`)
)

type wordService struct {
	queue       *compileQueue
	runTimes    *durationStats
	mu          sync.Mutex
	controllers map[uint64]context.CancelFunc
	nextID      uint64
	stopping    bool
	requestWG   sync.WaitGroup
}

func newWordService() *wordService {
	return &wordService{queue: newCompileQueue(1, 2), runTimes: newDurationStats(), controllers: make(map[uint64]context.CancelFunc)}
}

func (s *wordService) stats() map[string]any {
	stats := map[string]any{}
	for key, value := range s.queue.stats() {
		stats[key] = value
	}
	stats["waitMs"] = s.queue.waitTimes.snapshot()
	stats["runMs"] = s.runTimes.snapshot()
	return stats
}

func (s *wordService) cancelAll() {
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
	s.requestWG.Wait()
}

func (s *wordService) track(parent context.Context) (context.Context, func()) {
	ctx, cancel := context.WithCancel(parent)
	s.mu.Lock()
	if s.stopping {
		cancel()
		s.mu.Unlock()
		return ctx, func() {}
	}
	s.requestWG.Add(1)
	s.nextID++
	id := s.nextID
	s.controllers[id] = cancel
	s.mu.Unlock()
	return ctx, func() {
		cancel()
		s.mu.Lock()
		delete(s.controllers, id)
		s.mu.Unlock()
		s.requestWG.Done()
	}
}

func (s *wordService) environment(ctx context.Context) map[string]any {
	executable, err := findPandoc()
	if err != nil {
		return map[string]any{"available": false, "error": pandocUnavailableMessage()}
	}
	version, err := runCommand(ctx, executable, []string{"--version"}, "", maxTexCommandTime)
	if err != nil {
		return map[string]any{"available": false, "error": fmt.Sprintf("Pandoc: %s", firstCharacters(err.Error(), 2000))}
	}
	firstLine := strings.SplitN(strings.TrimSpace(string(version)), "\n", 2)[0]
	return map[string]any{"available": true, "version": strings.TrimSuffix(firstLine, "\r")}
}

func (s *wordService) importDocument(ctx context.Context, input []byte) ([]byte, error) {
	if len(input) == 0 || len(input) > maxWordDocumentBytes {
		return nil, appError(http.StatusBadRequest, "Tệp Word vượt 25 MB hoặc không hợp lệ.")
	}
	if err := validateWordZip(input); err != nil {
		return nil, appError(http.StatusBadRequest, err.Error())
	}
	ctx, untrack := s.track(ctx)
	defer untrack()
	if err := s.queue.acquire(ctx); err != nil {
		return nil, err
	}
	defer s.queue.release()
	defer s.runTimes.since(time.Now())

	executable, err := findPandoc()
	if err != nil {
		return nil, appError(http.StatusServiceUnavailable, pandocUnavailableMessage())
	}
	directory, err := os.MkdirTemp("", "vietlatex-word-")
	if err != nil {
		return nil, appError(http.StatusInternalServerError, "Không tạo được thư mục chuyển Word tạm.")
	}
	defer os.RemoveAll(directory)
	inputPath := filepath.Join(directory, "input.docx")
	if err := os.WriteFile(inputPath, input, 0o600); err != nil {
		return nil, appError(http.StatusInternalServerError, "Không ghi được tài liệu Word tạm.")
	}
	output, err := runCommandWithLimit(ctx, executable, []string{"--sandbox", "-f", "docx", "-t", "json", "--extract-media=media", "input.docx"}, directory, maxTexCommandTime, maxWordASTBytes)
	if err != nil {
		return nil, pandocError(err)
	}
	if astTruncated(output) {
		return nil, appError(http.StatusRequestEntityTooLarge, "Nội dung Word sau khi chuyển đổi vượt giới hạn 32 MB.")
	}
	var ast any
	if err := json.Unmarshal(output, &ast); err != nil {
		return nil, appError(http.StatusUnprocessableEntity, "Pandoc trả về cấu trúc Word không hợp lệ.")
	}
	imageBytes := 0
	if err := attachWordImages(ast, directory, &imageBytes); err != nil {
		return nil, appError(http.StatusBadRequest, err.Error())
	}
	result, err := json.Marshal(ast)
	if err != nil {
		return nil, appError(http.StatusInternalServerError, "Không đóng gói được dữ liệu Word.")
	}
	return result, nil
}

func (s *wordService) parseLatex(ctx context.Context, input []byte) ([]byte, error) {
	if len(input) == 0 || len(input) > 800<<10 || !utf8.Valid(input) {
		return nil, appError(http.StatusBadRequest, "Source LaTeX vượt 800 KB hoặc không hợp lệ.")
	}
	ctx, untrack := s.track(ctx)
	defer untrack()
	if err := s.queue.acquire(ctx); err != nil {
		return nil, err
	}
	defer s.queue.release()
	defer s.runTimes.since(time.Now())

	executable, err := findPandoc()
	if err != nil {
		return nil, appError(http.StatusServiceUnavailable, pandocUnavailableMessage())
	}
	directory, err := os.MkdirTemp("", "vietlatex-source-")
	if err != nil {
		return nil, appError(http.StatusInternalServerError, "Không tạo được thư mục chuyển LaTeX tạm.")
	}
	defer os.RemoveAll(directory)
	if err := os.WriteFile(filepath.Join(directory, "input.tex"), input, 0o600); err != nil {
		return nil, appError(http.StatusInternalServerError, "Không ghi được source LaTeX tạm.")
	}
	output, err := runCommandWithLimit(ctx, executable, []string{"--sandbox", "-f", "latex", "-t", "json", "input.tex"}, directory, maxTexCommandTime, maxWordASTBytes)
	if err != nil {
		return nil, pandocError(err)
	}
	if astTruncated(output) {
		return nil, appError(http.StatusRequestEntityTooLarge, "Cấu trúc LaTeX sau khi chuyển đổi vượt giới hạn 32 MB.")
	}
	var ast map[string]any
	if err := json.Unmarshal(output, &ast); err != nil {
		return nil, appError(http.StatusUnprocessableEntity, "Pandoc trả về cấu trúc LaTeX không hợp lệ.")
	}
	if _, ok := ast["blocks"].([]any); !ok {
		return nil, appError(http.StatusUnprocessableEntity, "Không đọc được nội dung trong source LaTeX.")
	}
	return output, nil
}

func (s *wordService) exportDocument(ctx context.Context, input []byte) ([]byte, error) {
	if len(input) == 0 || len(input) > maxJSONRequestBytes {
		return nil, appError(http.StatusBadRequest, "Dữ liệu xuất Word không hợp lệ.")
	}
	var ast map[string]any
	if err := json.Unmarshal(input, &ast); err != nil {
		return nil, appError(http.StatusBadRequest, "Dữ liệu xuất Word không hợp lệ.")
	}
	_, ok := ast["blocks"].([]any)
	if !ok {
		return nil, appError(http.StatusBadRequest, "Dữ liệu xuất Word không hợp lệ.")
	}
	bibliography, _ := ast["_bibliography"].(string)
	if len(bibliography) > 500_000 {
		return nil, appError(http.StatusBadRequest, "Danh mục BibTeX vượt quá 500 KB.")
	}
	delete(ast, "_bibliography")
	citationStyle, _ := ast["_citationStyle"].(string)
	delete(ast, "_citationStyle")
	imageTotal := 0
	imageCount := 0
	if err := validateWordAST(ast, &imageTotal, &imageCount); err != nil {
		return nil, appError(http.StatusBadRequest, err.Error())
	}
	if imageCount > maxDocumentImages || imageTotal > maxAllImageBytes {
		return nil, appError(http.StatusBadRequest, "Ảnh Word vượt giới hạn 8 ảnh, 450 KB/tệp hoặc 3,5 MB/tài liệu.")
	}
	serialized, err := json.Marshal(ast)
	if err != nil || len(serialized) > maxWordASTBytes {
		return nil, appError(http.StatusBadRequest, "Tài liệu Word vượt giới hạn.")
	}
	ctx, untrack := s.track(ctx)
	defer untrack()
	if err := s.queue.acquire(ctx); err != nil {
		return nil, err
	}
	defer s.queue.release()
	defer s.runTimes.since(time.Now())

	executable, err := findPandoc()
	if err != nil {
		return nil, appError(http.StatusServiceUnavailable, pandocUnavailableMessage())
	}
	directory, err := os.MkdirTemp("", "vietlatex-word-")
	if err != nil {
		return nil, appError(http.StatusInternalServerError, "Không tạo được thư mục chuyển Word tạm.")
	}
	defer os.RemoveAll(directory)
	if err := os.WriteFile(filepath.Join(directory, "input.json"), serialized, 0o600); err != nil {
		return nil, appError(http.StatusInternalServerError, "Không ghi được cấu trúc Word tạm.")
	}
	args := []string{"--sandbox", "-f", "json", "-t", "docx", "input.json", "-o", "output.docx"}
	if bibliography != "" {
		if err := os.WriteFile(filepath.Join(directory, "references.bib"), []byte(bibliography), 0o600); err != nil {
			return nil, appError(http.StatusInternalServerError, "Không ghi được tệp trích dẫn tạm.")
		}
		args = append(args, "--citeproc", "--bibliography=references.bib", "--metadata=link-citations:true", "--metadata=link-bibliography:true")
		if csl := wordCitationCSL(citationStyle); csl != "" {
			if err := os.WriteFile(filepath.Join(directory, "style.csl"), []byte(csl), 0o600); err != nil {
				return nil, appError(http.StatusInternalServerError, "Không ghi được kiểu trích dẫn tạm.")
			}
			args = append(args, "--csl=style.csl")
		}
	}
	if _, err := runCommand(ctx, executable, args, directory, maxTexCommandTime); err != nil {
		return nil, pandocError(err)
	}
	path := filepath.Join(directory, "output.docx")
	info, err := os.Stat(path)
	if err != nil {
		return nil, appError(http.StatusUnprocessableEntity, "Pandoc không tạo được tài liệu Word.")
	}
	if info.Size() > maxPdfBytes {
		return nil, appError(http.StatusRequestEntityTooLarge, "Tài liệu Word vượt quá giới hạn 75 MB.")
	}
	output, err := os.ReadFile(path)
	if err != nil {
		return nil, appError(http.StatusInternalServerError, "Không đọc được tài liệu Word đã tạo.")
	}
	return output, nil
}

// astTruncated reports whether Pandoc's JSON filled the output buffer, which
// silently drops the rest. Reporting the size limit beats a misleading
// "invalid structure" error from parsing the cut-off JSON.
func astTruncated(output []byte) bool { return len(output) >= maxWordASTBytes }

func validateWordZip(data []byte) error {
	archive, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return fmt.Errorf("Gói Word không hợp lệ.")
	}
	if len(archive.File) == 0 || len(archive.File) > maxWordArchiveFiles {
		return fmt.Errorf("Gói Word có quá nhiều tệp hoặc không hợp lệ.")
	}
	seen := make(map[string]struct{}, len(archive.File))
	var total uint64
	for _, file := range archive.File {
		name := file.Name
		if file.Flags&1 != 0 || file.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("Gói Word chứa tệp mã hóa hoặc liên kết không được hỗ trợ.")
		}
		if unsafeArchivePath(name) {
			return fmt.Errorf("Gói Word có đường dẫn tệp không an toàn.")
		}
		key := strings.ToLower(name)
		if _, ok := seen[key]; ok {
			return fmt.Errorf("Gói Word có tên tệp trùng.")
		}
		seen[key] = struct{}{}
		if file.UncompressedSize64 > maxWordArchiveBytes || total+file.UncompressedSize64 > maxWordArchiveBytes {
			return fmt.Errorf("Gói Word vượt quá dung lượng giải nén 64 MB.")
		}
		total += file.UncompressedSize64
	}
	for _, file := range archive.File {
		if file.FileInfo().IsDir() {
			continue
		}
		reader, err := file.Open()
		if err != nil {
			return fmt.Errorf("Không đọc được gói Word.")
		}
		written, copyErr := io.Copy(io.Discard, io.LimitReader(reader, int64(file.UncompressedSize64)+1))
		closeErr := reader.Close()
		if copyErr != nil || closeErr != nil || uint64(written) != file.UncompressedSize64 {
			return fmt.Errorf("Kích thước hoặc dữ liệu gói Word không hợp lệ.")
		}
	}
	return nil
}

func unsafeArchivePath(name string) bool {
	if name == "" || strings.ContainsAny(name, "\\:\x00\r\n\t") || strings.HasPrefix(name, "/") || filepath.IsAbs(name) {
		return true
	}
	parts := strings.Split(strings.TrimSuffix(name, "/"), "/")
	for _, part := range parts {
		if part == "" || part == "." || part == ".." {
			return true
		}
	}
	return false
}

func attachWordImages(value any, directory string, total *int) error {
	switch item := value.(type) {
	case []any:
		for _, child := range item {
			if err := attachWordImages(child, directory, total); err != nil {
				return err
			}
		}
	case map[string]any:
		if item["t"] == "Image" {
			content, ok := item["c"].([]any)
			if ok && len(content) >= 3 {
				link, ok := content[2].([]any)
				if ok && len(link) >= 1 {
					target, _ := link[0].(string)
					if target != "" {
						if filepath.IsAbs(target) || strings.Contains(target, "..") || unsafeSchemePattern.MatchString(target) {
							link[0] = ""
						} else {
							path := filepath.Join(directory, filepath.FromSlash(target))
							relative, err := filepath.Rel(directory, path)
							if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) || filepath.IsAbs(relative) {
								return fmt.Errorf("Ảnh Word có đường dẫn ngoài tài liệu.")
							}
							mime := ""
							switch strings.ToLower(filepath.Ext(path)) {
							case ".png":
								mime = "png"
							case ".jpg", ".jpeg":
								mime = "jpeg"
							}
							link[0] = ""
							// Unsupported formats (EMF/WMF are common in Word) are dropped
							// without being read or counted against the image budget.
							// Targets that are missing or not regular files (external
							// links, devices) are dropped instead of failing the import.
							if info, err := os.Lstat(path); mime != "" && err == nil && info.Mode().IsRegular() {
								if int64(*total)+info.Size() > maxWordImageBytes {
									return fmt.Errorf("Tổng ảnh Word vượt 24 MB.")
								}
								data, err := os.ReadFile(path)
								if err != nil {
									return fmt.Errorf("Không đọc được ảnh trong tài liệu Word.")
								}
								*total += len(data)
								if *total > maxWordImageBytes {
									return fmt.Errorf("Tổng ảnh Word vượt 24 MB.")
								}
								link[0] = "data:image/" + mime + ";base64," + base64.StdEncoding.EncodeToString(data)
							}
						}
					}
				}
			}
		}
		for _, child := range item {
			if err := attachWordImages(child, directory, total); err != nil {
				return err
			}
		}
	}
	return nil
}

func validateWordAST(value any, imageTotal, imageCount *int) error {
	switch item := value.(type) {
	case []any:
		for _, child := range item {
			if err := validateWordAST(child, imageTotal, imageCount); err != nil {
				return err
			}
		}
	case map[string]any:
		switch item["t"] {
		case "RawBlock":
			// The only raw content allowed is a literal page break.
			if content, ok := item["c"].([]any); ok && len(content) == 2 && content[0] == "openxml" && content[1] == wordPageBreak {
				return nil
			}
			return fmt.Errorf("Không hỗ trợ mã thực thi trong tài liệu Word.")
		case "RawInline":
			return fmt.Errorf("Không hỗ trợ mã thực thi trong tài liệu Word.")
		case "Image":
			content, ok := item["c"].([]any)
			if !ok || len(content) < 3 {
				return fmt.Errorf("Ảnh Word phải được nhúng trong tài liệu.")
			}
			link, ok := content[2].([]any)
			if !ok || len(link) < 1 {
				return fmt.Errorf("Ảnh Word phải được nhúng trong tài liệu.")
			}
			source, ok := link[0].(string)
			match := wordImageSourcePattern.FindStringSubmatch(source)
			if !ok || len(match) != 2 {
				return fmt.Errorf("Ảnh Word phải được nhúng trong tài liệu.")
			}
			encoded := strings.TrimPrefix(source, match[0])
			if *imageCount >= maxDocumentImages || len(encoded) > base64.StdEncoding.EncodedLen(min(maxDocumentImage, maxAllImageBytes-*imageTotal)) {
				return fmt.Errorf("Ảnh Word vượt giới hạn 8 ảnh, 450 KB/tệp hoặc 3,5 MB/tài liệu.")
			}
			data, err := decodeBase64(encoded)
			if err != nil || len(data) == 0 || len(data) > maxDocumentImage {
				return fmt.Errorf("Ảnh Word vượt giới hạn 450 KB hoặc không hợp lệ.")
			}
			if match[1] == "png" {
				if len(data) < 8 || string(data[:8]) != "\x89PNG\r\n\x1a\n" {
					return fmt.Errorf("Định dạng ảnh Word không khớp với dữ liệu.")
				}
			} else if len(data) < 3 || data[0] != 0xff || data[1] != 0xd8 || data[2] != 0xff {
				return fmt.Errorf("Định dạng ảnh Word không khớp với dữ liệu.")
			}
			*imageCount++
			*imageTotal += len(data)
		}
		for _, child := range item {
			if err := validateWordAST(child, imageTotal, imageCount); err != nil {
				return err
			}
		}
	}
	return nil
}

func findPandoc() (string, error) {
	candidates := []string{os.Getenv("PANDOC_PATH")}
	if resources := os.Getenv("VIETLATEX_RESOURCES_PATH"); resources != "" {
		name := "pandoc"
		if runtime.GOOS == "windows" {
			name += ".exe"
		}
		candidates = append(candidates, filepath.Join(resources, "pandoc", name))
	}
	if appPath := os.Getenv("VIETLATEX_APP_PATH"); appPath != "" {
		name := "pandoc"
		if runtime.GOOS == "windows" {
			name += ".exe"
		}
		candidates = append(candidates, filepath.Join(appPath, "tools", "pandoc", name))
	}
	if runtime.GOOS == "windows" {
		candidates = append(candidates, filepath.Join("tools", "pandoc", "pandoc.exe"))
	} else {
		candidates = append(candidates, filepath.Join("tools", "pandoc", "pandoc"))
	}
	for _, candidate := range candidates {
		if candidate == "" {
			continue
		}
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			// Pandoc runs with Dir set to a temp directory, and exec resolves a
			// relative executable against Dir, not against where it was found.
			return filepath.Abs(candidate)
		}
	}
	if executable, err := exec.LookPath("pandoc"); err == nil {
		return executable, nil
	}
	if runtime.GOOS == "darwin" {
		for _, candidate := range []string{"/opt/homebrew/bin/pandoc", "/usr/local/bin/pandoc", "/opt/local/bin/pandoc"} {
			if info, err := os.Stat(candidate); err == nil && !info.IsDir() && info.Mode()&0111 != 0 {
				return candidate, nil
			}
		}
	}
	return "", fmt.Errorf("Pandoc is not installed")
}

func pandocUnavailableMessage() string {
	return "Chưa có Pandoc. Chạy npm run setup:pandoc trên máy phát triển, hoặc cài Pandoc rồi mở lại app."
}

func pandocError(err error) error {
	if errors.Is(err, errClientCancelled) {
		return errClientCancelled
	}
	var command *commandError
	if errors.As(err, &command) && command.missing {
		return appError(http.StatusServiceUnavailable, pandocUnavailableMessage())
	}
	message := firstCharacters(err.Error(), 2000)
	return appError(http.StatusUnprocessableEntity, "Pandoc: "+message)
}

func firstCharacters(value string, max int) string {
	if len(value) <= max {
		return value
	}
	end := max
	for end > 0 && !utf8.RuneStart(value[end]) {
		end--
	}
	return value[:end]
}
