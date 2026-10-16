package service

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"unicode/utf8"
)

// Run longer with: go test -run=^$ -fuzz=FuzzSafeAssetPath -fuzztime=30s ./internal/service

func FuzzSafeAssetPath(f *testing.F) {
	for _, seed := range []string{"refs.bib", "images/a.png", "../x.png", "a/./b.png", "CON.png", "conin$.png", "a\\b.png", "a:b.png", "x.png.", "COM¹.png", "dir/ sub.png", "document.tex"} {
		f.Add(seed)
	}
	root := filepath.Join(string(filepath.Separator), "work", "doc")
	f.Fuzz(func(t *testing.T, name string) {
		if !safeAssetPath(name) {
			return
		}
		if strings.IndexByte(name, 0) >= 0 {
			t.Fatalf("accepted NUL byte: %q", name)
		}
		if filepath.ToSlash(filepath.Clean(filepath.FromSlash(name))) != name {
			t.Fatalf("accepted a path that is not already clean: %q", name)
		}
		joined := filepath.Join(root, filepath.FromSlash(name))
		if relative, err := filepath.Rel(root, joined); err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
			t.Fatalf("accepted a path leaving the work directory: %q", name)
		}
		for _, part := range strings.Split(name, "/") {
			if windowsReservedName(part) || strings.HasSuffix(part, " ") || strings.HasSuffix(part, ".") {
				t.Fatalf("accepted a name Windows cannot create: %q", name)
			}
		}
	})
}

func FuzzDecodeBase64(f *testing.F) {
	for _, seed := range []string{"", "QQ==", "QUJD", "QQ=", "Q Q==", "QQ==\n", "////"} {
		f.Add(seed)
	}
	f.Fuzz(func(t *testing.T, value string) {
		data, err := decodeBase64(value)
		if err != nil {
			return
		}
		// Strict decoding accepts exactly one spelling per payload.
		if base64.StdEncoding.EncodeToString(data) != value {
			t.Fatalf("accepted non-canonical base64 %q", value)
		}
	})
}

func FuzzUsePrintYear(f *testing.F) {
	f.Add("@article{Smith_2020, title={X}, year={2020}}", 2019)
	f.Add("@article{k, year = \"2021\"}", 2021)
	f.Add("@book{k, year=1999,}", 2000)
	f.Add("year={", 1)
	f.Fuzz(func(t *testing.T, bibtex string, year int) {
		if year < 1000 || year > 9999 {
			return
		}
		updated := usePrintYear(bibtex, year)
		if updated != bibtex && !strings.Contains(updated, strconv.Itoa(year)) {
			t.Fatalf("changed BibTeX without writing year %d: %q -> %q", year, bibtex, updated)
		}
		if again := usePrintYear(updated, year); again != updated {
			t.Fatalf("not idempotent: %q -> %q", updated, again)
		}
	})
}

func FuzzValidateWordZip(f *testing.F) {
	var archive bytes.Buffer
	writer := zip.NewWriter(&archive)
	part, _ := writer.Create("word/document.xml")
	_, _ = part.Write([]byte("<w:document/>"))
	_ = writer.Close()
	f.Add(archive.Bytes())
	f.Add([]byte("PK\x03\x04"))
	f.Add([]byte{})
	f.Fuzz(func(t *testing.T, data []byte) {
		if len(data) > 1<<20 {
			return
		}
		// Must reject or accept without panicking or reading past the declared sizes.
		_ = validateWordZip(data)
	})
}

func FuzzFirstCharacters(f *testing.F) {
	f.Add("Xin chào thế giới", 5)
	f.Add("😀😀", 3)
	f.Fuzz(func(t *testing.T, value string, max int) {
		if max < 0 || max > 1<<16 {
			return
		}
		result := firstCharacters(value, max)
		if len(result) > max || !strings.HasPrefix(value, result) {
			t.Fatalf("firstCharacters(%q, %d) = %q", value, max, result)
		}
		if utf8.ValidString(value) && !utf8.ValidString(result) {
			t.Fatalf("split a UTF-8 character: %q", result)
		}
	})
}

func TestWindowsReservedAssetNames(t *testing.T) {
	for _, name := range []string{"CON.png", "con.tar.png", "CONIN$.png", "conout$.bib", "COM1.png", "lpt9.png", "COM¹.png", "LPT³.png", "NUL .png", "img/AUX.png"} {
		if safeAssetPath(name) {
			t.Errorf("accepted reserved Windows name %q", name)
		}
	}
	for _, name := range []string{"console.png", "COM10.png", "COM0.png", "LPT.png", "com1x.png", "images/connect.png"} {
		if !safeAssetPath(name) {
			t.Errorf("rejected ordinary name %q", name)
		}
	}
}
