package service

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"
)

func TestNormalizeDOI(t *testing.T) {
	for input, want := range map[string]string{
		" https://doi.org/10.1109/5.771073 ": "10.1109/5.771073",
		"doi:10.1000/xyz":                    "10.1000/xyz",
		"http://dx.doi.org/10.1000/abc":      "10.1000/abc",
	} {
		if got := normalizeDOI(input); got != want {
			t.Fatalf("normalizeDOI(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestLookupDOIRejectsInvalidInputWithoutNetwork(t *testing.T) {
	for _, input := range []string{"", "not-a-doi", "10.1/short", "10.1000/a b", "https://evil.example/10.1000/x"} {
		_, err := lookupDOI(context.Background(), input)
		var serviceErr *serviceError
		if !errors.As(err, &serviceErr) || serviceErr.status != http.StatusBadRequest {
			t.Fatalf("lookupDOI(%q) = %v, want 400", input, err)
		}
	}
}

func TestWordCitationCSL(t *testing.T) {
	if wordCitationCSL("authoryear") != "" {
		t.Fatal("author–year keeps Pandoc's default style")
	}
	for _, style := range []string{"unsrt", "ieee", "plain", "apa"} {
		csl := wordCitationCSL(style)
		if !strings.Contains(csl, "<style") || strings.Contains(csl, "__SORT__") {
			t.Fatalf("style %s produced an invalid CSL", style)
		}
	}
	if !strings.Contains(wordCitationCSL("plain"), `<key macro="author"/>`) {
		t.Fatal("plain numbering must sort the bibliography by author")
	}
}
