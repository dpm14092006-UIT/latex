package service

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAuthorizeRejectsStoppedServiceBeforeDispatch(t *testing.T) {
	s := New("tok")
	s.CancelActiveCompiles()
	called := false
	handler := s.authorize(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}))
	body := &countedReader{reader: strings.NewReader(`{"latex":"x"}`)}
	request := httptest.NewRequest(http.MethodPost, "/api/compile", body)
	request.Header.Set("X-Vietlatex-Token", "tok")
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	if called || body.read != 0 {
		t.Fatalf("stopped service dispatched request: called=%v bodyBytesRead=%d", called, body.read)
	}
	if recorder.Code != http.StatusServiceUnavailable || recorder.Header().Get("Retry-After") != "3" {
		t.Fatalf("stopped service returned status=%d headers=%v", recorder.Code, recorder.Header())
	}
}

func TestHealthDoesNotReportReadyAfterShutdown(t *testing.T) {
	s := New("tok")
	s.CancelActiveCompiles()
	request := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	request.Header.Set("X-Vietlatex-Token", "tok")
	recorder := httptest.NewRecorder()
	s.Handler().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("health returned %d after shutdown: %s", recorder.Code, recorder.Body.String())
	}
}

func TestAllowedOriginRejectsURLComponents(t *testing.T) {
	for _, origin := range []string{
		"http://localhost/",
		"http://127.0.0.1:5173/api/compile",
		"http://localhost?",
		"http://localhost?trusted=true",
		"http://localhost#",
		"https://localhost#trusted",
	} {
		if allowedOrigin(origin) {
			t.Errorf("accepted non-origin URL %q", origin)
		}
	}
}
