package service

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestMacFontCompatibleLoadsLatinModernByFile(t *testing.T) {
	source := "\\usepackage{fontspec}\n\\setmainfont{Latin Modern Roman}\n\\setsansfont{Latin Modern Sans}\n"
	got := macFontCompatible(source)
	if strings.Contains(got, `\setmainfont{Latin Modern Roman}`) || !strings.Contains(got, latinModernByFile) {
		t.Fatalf("Latin Modern was not rewritten to a file lookup:\n%s", got)
	}
	if !strings.Contains(got, `\setsansfont{Latin Modern Sans}`) {
		t.Fatal("other font declarations must stay untouched")
	}
	if macFontCompatible(got) != got {
		t.Fatal("rewrite must be idempotent")
	}
}

func fakeExecutable(t *testing.T, name string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(path, []byte("#!/bin/sh\necho fake\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestTectonicEngineSelection(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("uses a shell-script stand-in for the engines")
	}
	tectonic := fakeExecutable(t, "tectonic")
	t.Setenv("TECTONIC_PATH", tectonic)
	t.Setenv("VIETLATEX_SANDBOX", "")

	t.Setenv("XELATEX_PATH", fakeExecutable(t, "xelatex"))
	t.Setenv("VIETLATEX_TEX_ENGINE", "")
	if _, ok := tectonicEngine(); ok {
		t.Fatal("an installed XeLaTeX must stay the default engine")
	}
	t.Setenv("VIETLATEX_TEX_ENGINE", "tectonic")
	if got, ok := tectonicEngine(); !ok || got != tectonic {
		t.Fatalf("VIETLATEX_TEX_ENGINE=tectonic should select %s, got %q %v", tectonic, got, ok)
	}
	t.Setenv("VIETLATEX_TEX_ENGINE", "xelatex")
	if _, ok := tectonicEngine(); ok {
		t.Fatal("VIETLATEX_TEX_ENGINE=xelatex must never fall back")
	}
	t.Setenv("VIETLATEX_TEX_ENGINE", "tectonic")
	t.Setenv("VIETLATEX_SANDBOX", "docker")
	if _, ok := tectonicEngine(); ok {
		t.Fatal("the Docker sandbox keeps its own XeLaTeX image")
	}
}

func TestTectonicRejectsBiberStylesWithoutBiber(t *testing.T) {
	t.Setenv("PATH", t.TempDir())
	err := runTectonic(context.Background(), "tectonic", `\usepackage[backend=biber,style=apa]{biblatex}`, t.TempDir())
	var service *serviceError
	if !errors.As(err, &service) || service.status != http.StatusServiceUnavailable || !strings.Contains(service.message, "Biber") {
		t.Fatalf("expected a Biber guidance error, got %v", err)
	}
}

// TestTectonicCompilesVietnameseDocument runs the real engine. It is skipped
// unless Tectonic is installed; CI sets VIETLATEX_REQUIRE_TECTONIC=1 on macOS
// so the Mac compile path is exercised end to end.
func TestTectonicCompilesVietnameseDocument(t *testing.T) {
	t.Setenv("VIETLATEX_TEX_ENGINE", "tectonic")
	t.Setenv("VIETLATEX_SANDBOX", "")
	if _, err := findTectonic(); err != nil {
		if os.Getenv("VIETLATEX_REQUIRE_TECTONIC") == "1" {
			t.Fatal("VIETLATEX_REQUIRE_TECTONIC=1 but Tectonic was not found")
		}
		t.Skip("Tectonic is not installed")
	}
	// Same font line as the built-in templates in DocumentSerializer.js.
	latex := strings.Join([]string{
		`\documentclass[11pt,a4paper]{article}`,
		`\usepackage{fontspec}`,
		`\setmainfont{Latin Modern Roman}`,
		`\usepackage{amsmath,amssymb}`,
		`\begin{document}`,
		`\section{Giới thiệu}`,
		`Tiếng Việt có dấu: Định lý Bayes $P(A\mid B)$ theo \cite{knuth1984}.`,
		`\bibliographystyle{unsrt}`,
		`\bibliography{references}`,
		`\end{document}`,
	}, "\n")
	if runtime.GOOS != "darwin" {
		latex = macFontCompatible(latex)
	}
	bib := []byte(`@book{knuth1984, author = {Donald E. Knuth}, title = {The TeXbook}, publisher = {Addison-Wesley}, year = {1984}}`)
	s := newLatexService()
	ctx, cancel := context.WithTimeout(context.Background(), maxTectonicCommandTime+time.Minute)
	defer cancel()
	pdf, err := s.compileDocument(ctx, latex, []fileAsset{{filename: "references.bib", data: bib}})
	if err != nil {
		t.Fatalf("Tectonic compile failed: %v", err)
	}
	if !bytes.HasPrefix(pdf, []byte("%PDF-")) {
		t.Fatal("output is not a PDF")
	}
}
