package service

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRequestBodyBudgetAccountsAndReleasesReservations(t *testing.T) {
	budget := newRequestBodyBudget(10)
	release, ok := budget.reserve(7)
	if !ok {
		t.Fatal("first reservation was rejected")
	}
	if _, ok := budget.reserve(4); ok {
		t.Fatal("reservation beyond budget was accepted")
	}
	if used, limit := budget.stats(); used != 7 || limit != 10 {
		t.Fatalf("budget stats = (%d, %d), want (7, 10)", used, limit)
	}
	release()
	release()
	if used, _ := budget.stats(); used != 0 {
		t.Fatalf("released reservation left %d bytes in use", used)
	}
	if _, ok := budget.reserve(-1); ok {
		t.Fatal("negative reservation was accepted")
	}
}

func TestHeavyRequestBodyBudgetRejectsBeforeReadAndReleases(t *testing.T) {
	service := New("tok")
	held, ok := service.requestBodies.reserve(maxInFlightRequestBodyBytes)
	if !ok {
		t.Fatal("could not reserve the test budget")
	}
	body := &countedReader{reader: strings.NewReader(`{"latex":"x"}`)}
	request := httptest.NewRequest(http.MethodPost, "/api/compile", io.NopCloser(body))
	request.ContentLength = int64(len(`{"latex":"x"}`))
	request.Header.Set("X-Vietlatex-Token", "tok")
	recorder := httptest.NewRecorder()
	service.Handler().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("budget-full request status = %d, want 503", recorder.Code)
	}
	if recorder.Header().Get("Retry-After") != "3" {
		t.Fatalf("Retry-After = %q, want 3", recorder.Header().Get("Retry-After"))
	}
	if body.read != 0 {
		t.Fatalf("budget-rejected request consumed %d body bytes", body.read)
	}
	used, limit := service.requestBodies.stats()
	if used != limit {
		t.Fatalf("held budget stats = (%d, %d), want fully reserved", used, limit)
	}
	held()
	if used, _ := service.requestBodies.stats(); used != 0 {
		t.Fatalf("released budget still has %d bytes in use", used)
	}

	// Unknown-length bodies reserve the endpoint maximum and release that
	// reservation after decoding, including when decoding fails.
	chunked := httptest.NewRequest(http.MethodPost, "/api/compile", strings.NewReader("invalid"))
	chunked.ContentLength = -1
	chunked.Header.Set("X-Vietlatex-Token", "tok")
	chunkedRecorder := httptest.NewRecorder()
	service.Handler().ServeHTTP(chunkedRecorder, chunked)
	if chunkedRecorder.Code != http.StatusBadRequest {
		t.Fatalf("malformed unknown-length request status = %d, want 400", chunkedRecorder.Code)
	}
	if used, _ := service.requestBodies.stats(); used != 0 {
		t.Fatalf("unknown-length request leaked %d budget bytes", used)
	}
}

func TestHeavyRequestBodyRejectsDeclaredOversizeBeforeBudget(t *testing.T) {
	service := New("tok")
	request := httptest.NewRequest(http.MethodPost, "/api/compile", strings.NewReader("{}"))
	request.ContentLength = maxJSONRequestBytes + 1
	request.Header.Set("X-Vietlatex-Token", "tok")
	recorder := httptest.NewRecorder()
	service.Handler().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversized request status = %d, want 413", recorder.Code)
	}
	if used, _ := service.requestBodies.stats(); used != 0 {
		t.Fatalf("oversized request reserved %d budget bytes", used)
	}
}
