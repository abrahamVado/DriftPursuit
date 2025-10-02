package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"driftpursuit/broker/internal/logging"
)

type stubReadiness struct {
	clients int
	pending int
	uptime  time.Duration
	err     error
}

func (s *stubReadiness) SnapshotClientCounts() (int, int) { return s.clients, s.pending }
func (s *stubReadiness) StartupError() error              { return s.err }
func (s *stubReadiness) Uptime() time.Duration            { return s.uptime }

type stubLimiter struct {
	remaining int
}

func (s *stubLimiter) Allow() bool {
	if s.remaining <= 0 {
		return false
	}
	s.remaining--
	return true
}

type stubDumper struct {
	location string
	err      error
	calls    int
}

func (s *stubDumper) DumpReplay(ctx context.Context) (string, error) {
	s.calls++
	return s.location, s.err
}

func TestLivenessHandlerReturnsJSON(t *testing.T) {
	fixed := time.Date(2024, time.January, 2, 15, 4, 5, 0, time.UTC)
	handlers := NewHandlerSet(Options{Logger: logging.NewTestLogger(), TimeSource: func() time.Time { return fixed }})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/livez", nil)

	handlers.LivenessHandler().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rr.Code)
	}
	var payload struct {
		Status    string `json:"status"`
		Timestamp string `json:"timestamp"`
	}
	if err := json.NewDecoder(rr.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.Status != "alive" {
		t.Fatalf("unexpected status %q", payload.Status)
	}
	if payload.Timestamp != fixed.Format(time.RFC3339Nano) {
		t.Fatalf("unexpected timestamp %q", payload.Timestamp)
	}
}

func TestReadinessHandlerUnavailable(t *testing.T) {
	readiness := &stubReadiness{clients: 3, pending: 1, uptime: 45 * time.Second, err: errors.New("boom")}
	handlers := NewHandlerSet(Options{Logger: logging.NewTestLogger(), Readiness: readiness})

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/readyz", nil)
	handlers.ReadinessHandler().ServeHTTP(rr, req)

	if rr.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d", rr.Code)
	}
	var payload struct {
		Status         string  `json:"status"`
		Message        string  `json:"message"`
		UptimeSeconds  float64 `json:"uptime_seconds"`
		Clients        int     `json:"clients"`
		PendingClients int     `json:"pending_clients"`
	}
	if err := json.NewDecoder(rr.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.Status != "error" || payload.Message != "boom" {
		t.Fatalf("unexpected payload: %+v", payload)
	}
	if payload.Clients != 3 || payload.PendingClients != 1 {
		t.Fatalf("unexpected client counts: %+v", payload)
	}
	if payload.UptimeSeconds != readiness.uptime.Seconds() {
		t.Fatalf("unexpected uptime: got %f want %f", payload.UptimeSeconds, readiness.uptime.Seconds())
	}
}

func TestMetricsHandlerOutputsPrometheusFormat(t *testing.T) {
	readiness := &stubReadiness{clients: 2, pending: 1, uptime: 90 * time.Second}
	handlers := NewHandlerSet(Options{
		Logger:    logging.NewTestLogger(),
		Readiness: readiness,
		Stats: func() (int, int) {
			return 4, 2
		},
	})

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	handlers.MetricsHandler().ServeHTTP(rr, req)

	if got := rr.Header().Get("Content-Type"); got != "text/plain; version=0.0.4" {
		t.Fatalf("unexpected content type %q", got)
	}
	body := rr.Body.String()
	for _, substr := range []string{
		"broker_broadcasts_total 4",
		"broker_clients 2",
		"broker_pending_clients 1",
		"broker_uptime_seconds 90",
	} {
		if !strings.Contains(body, substr) {
			t.Fatalf("metrics missing %q:\n%s", substr, body)
		}
	}
}

func TestReplayDumpHandlerAuthAndRateLimits(t *testing.T) {
	dumper := &stubDumper{location: "/tmp/latest"}
	limiter := &stubLimiter{remaining: 1}
	handlers := NewHandlerSet(Options{
		Logger:      logging.NewTestLogger(),
		Replay:      dumper,
		AdminToken:  "topsecret",
		RateLimiter: limiter,
	})

	makeRequest := func(token string) *httptest.ResponseRecorder {
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/replay/dump", nil)
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		handlers.ReplayDumpHandler().ServeHTTP(rr, req)
		return rr
	}

	if resp := makeRequest(""); resp.Code != http.StatusUnauthorized {
		t.Fatalf("expected unauthorized for missing token, got %d", resp.Code)
	}

	if resp := makeRequest("topsecret"); resp.Code != http.StatusAccepted {
		t.Fatalf("expected 202 for authorised request, got %d", resp.Code)
	}
	if dumper.calls != 1 {
		t.Fatalf("expected dumper invoked once, got %d", dumper.calls)
	}

	if resp := makeRequest("topsecret"); resp.Code != http.StatusTooManyRequests {
		t.Fatalf("expected rate limit, got %d", resp.Code)
	}
}
