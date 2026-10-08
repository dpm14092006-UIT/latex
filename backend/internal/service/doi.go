package service

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const (
	maxDOIBytes      = 256 << 10
	doiLookupTimeout = 15 * time.Second
)

var doiPattern = regexp.MustCompile(`^10\.\d{4,9}/[^\s"<>{}\\]{1,300}$`)
var bibtexYearField = regexp.MustCompile(`(?is)(\byear\s*=\s*)(\{[^}]*\}|"[^"]*"|[^,\r\n]+)`)
var bibtexArticleKey = regexp.MustCompile(`(?is)(@\s*article\s*[{(]\s*)([^,\s]+)(\s*,)`)
var bibtexYearKey = regexp.MustCompile(`(?i)^(.+[_-])((?:19|20)\d{2})$`)

// doiResolverHosts are the only hosts a DOI lookup may reach, including redirects.
var doiResolverHosts = map[string]bool{"doi.org": true, "dx.doi.org": true, "api.crossref.org": true, "data.crossref.org": true, "data.datacite.org": true, "api.datacite.org": true, "data.jalc.org": true, "api.japanlinkcenter.org": true, "doi.crossref.org": true}

var doiClient = &http.Client{
	Timeout: doiLookupTimeout,
	CheckRedirect: func(request *http.Request, via []*http.Request) error {
		if len(via) >= 5 {
			return errors.New("too many redirects")
		}
		if request.URL.Scheme != "https" || !doiResolverHosts[strings.ToLower(request.URL.Hostname())] {
			return errors.New("redirect to a host outside the DOI resolvers")
		}
		return nil
	},
}

func normalizeDOI(value string) string {
	value = strings.TrimSpace(value)
	lower := strings.ToLower(value)
	for _, prefix := range []string{"https://doi.org/", "http://doi.org/", "https://dx.doi.org/", "http://dx.doi.org/", "doi:"} {
		if strings.HasPrefix(lower, prefix) {
			value = strings.TrimSpace(value[len(prefix):])
			break
		}
	}
	return value
}

// lookupDOI fetches BibTeX for one DOI via content negotiation on doi.org.
func lookupDOI(ctx context.Context, raw string) (string, error) {
	doi := normalizeDOI(raw)
	if !doiPattern.MatchString(doi) {
		return "", appError(http.StatusBadRequest, "DOI không hợp lệ.")
	}
	ctx, cancel := context.WithTimeout(ctx, doiLookupTimeout)
	defer cancel()
	target := "https://doi.org/" + (&url.URL{Path: doi}).EscapedPath()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return "", appError(http.StatusBadRequest, "DOI không hợp lệ.")
	}
	request.Header.Set("Accept", "application/x-bibtex; charset=utf-8")
	request.Header.Set("User-Agent", "VietLaTeXStudio/0.4 (citation lookup)")
	response, err := doiClient.Do(request)
	if err != nil {
		return "", appError(http.StatusBadGateway, "Không kết nối được doi.org. Kiểm tra mạng rồi thử lại.")
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNotFound {
		return "", appError(http.StatusNotFound, "Không tìm thấy DOI "+doi+".")
	}
	if response.StatusCode != http.StatusOK {
		return "", appError(http.StatusBadGateway, "doi.org trả về lỗi khi tra "+doi+".")
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, maxDOIBytes+1))
	if err != nil || len(body) > maxDOIBytes {
		return "", appError(http.StatusBadGateway, "Dữ liệu DOI không hợp lệ.")
	}
	text := strings.TrimSpace(string(body))
	if !strings.HasPrefix(text, "@") {
		return "", appError(http.StatusBadGateway, "DOI "+doi+" không có dữ liệu BibTeX.")
	}
	if year := crossrefPrintYear(ctx, doi); year > 0 {
		text = usePrintYear(text, year)
	}
	return text, nil
}

// crossrefPrintYear returns the year of a journal article's print issue when
// Crossref has one. DOI content negotiation often returns the first-online year
// instead, even after the article has been assigned to a later journal issue.
// Crossref is an optional correction source: lookup should still succeed when
// its API is unavailable or the DOI is registered elsewhere.
func crossrefPrintYear(ctx context.Context, doi string) int {
	target := (&url.URL{Scheme: "https", Host: "api.crossref.org", Path: "/works/" + doi}).String()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return 0
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("User-Agent", "VietLaTeXStudio/0.4 (citation lookup)")
	response, err := doiClient.Do(request)
	if err != nil {
		return 0
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return 0
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, maxDOIBytes+1))
	if err != nil || len(body) > maxDOIBytes {
		return 0
	}
	var result struct {
		Message struct {
			Type           string `json:"type"`
			PublishedPrint struct {
				DateParts [][]int `json:"date-parts"`
			} `json:"published-print"`
			JournalIssue struct {
				PublishedPrint struct {
					DateParts [][]int `json:"date-parts"`
				} `json:"published-print"`
			} `json:"journal-issue"`
		} `json:"message"`
	}
	if json.Unmarshal(body, &result) != nil || result.Message.Type != "journal-article" {
		return 0
	}
	dateParts := result.Message.PublishedPrint.DateParts
	if len(dateParts) == 0 {
		dateParts = result.Message.JournalIssue.PublishedPrint.DateParts
	}
	if len(dateParts) == 0 || len(dateParts[0]) == 0 {
		return 0
	}
	year := dateParts[0][0]
	if year < 1000 || year > 9999 {
		return 0
	}
	return year
}

// usePrintYear updates the BibTeX year and the common resolver-generated
// Author_YYYY key. Other user-meaningful citation keys are left intact.
func usePrintYear(bibtex string, year int) string {
	field := bibtexYearField.FindStringSubmatchIndex(bibtex)
	if len(field) < 6 {
		return bibtex
	}
	rawValue := strings.TrimSpace(bibtex[field[4]:field[5]])
	value := rawValue
	wrapped := byte(0)
	if len(value) >= 2 && (value[0] == '{' && value[len(value)-1] == '}' || value[0] == '"' && value[len(value)-1] == '"') {
		wrapped = value[0]
		value = strings.TrimSpace(value[1 : len(value)-1])
	}
	if len(value) != 4 {
		return bibtex
	}
	oldYear, err := strconv.Atoi(value)
	if err != nil || oldYear == year {
		return bibtex
	}
	newValue := strconv.Itoa(year)
	if wrapped == '{' {
		newValue = "{" + newValue + "}"
	} else if wrapped == '"' {
		newValue = "\"" + newValue + "\""
	}
	updated := bibtex[:field[4]] + newValue + bibtex[field[5]:]

	key := bibtexArticleKey.FindStringSubmatchIndex(updated)
	if len(key) < 6 {
		return updated
	}
	keyMatch := bibtexYearKey.FindStringSubmatch(updated[key[4]:key[5]])
	if len(keyMatch) == 3 && keyMatch[2] == strconv.Itoa(oldYear) {
		newKey := keyMatch[1] + strconv.Itoa(year)
		updated = updated[:key[4]] + newKey + updated[key[5]:]
	}
	return updated
}

func (s *Service) doiLookup(w http.ResponseWriter, r *http.Request) {
	if !admitHeavyRequest(w, s.doiQueue) {
		return
	}
	defer s.doiQueue.leave()
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	var input struct {
		DOI string `json:"doi"`
	}
	if err := decodeSingleJSON(r.Body, &input); err != nil {
		writeDecodeError(w, err)
		return
	}
	if !doiPattern.MatchString(normalizeDOI(input.DOI)) {
		writeServiceError(w, appError(http.StatusBadRequest, "DOI không hợp lệ."))
		return
	}
	if err := s.doiQueue.acquire(r.Context()); err != nil {
		s.writeFailure(w, r, err)
		return
	}
	defer s.doiQueue.release()
	bibtex, err := lookupDOI(r.Context(), input.DOI)
	if err != nil {
		s.writeFailure(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"bibtex": bibtex})
}
