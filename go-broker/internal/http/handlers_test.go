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
	"driftpursuit/broker/internal/match"
	"driftpursuit/broker/internal/networking"
	pb "driftpursuit/broker/internal/proto/pb"
	"driftpursuit/broker/internal/replay"
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

type stubMatchSession struct {
	snapshot match.Snapshot
	err      error
	min      int
	max      int
}

func (s *stubMatchSession) Snapshot() match.Snapshot { return s.snapshot }

func (s *stubMatchSession) AdjustCapacity(minPlayers, maxPlayers int) (match.Snapshot, error) {
	s.min = minPlayers
	s.max = maxPlayers
	if s.err != nil {
		return match.Snapshot{}, s.err
	}
	s.snapshot.Capacity.MinPlayers = minPlayers
	s.snapshot.Capacity.MaxPlayers = maxPlayers
	return s.snapshot, nil
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
	metrics := networking.NewSnapshotMetrics()
	metrics.Observe("client-1", 256, map[pb.InterestTier]int{pb.InterestTier_INTEREST_TIER_RADAR: 3})
	current := time.Unix(0, 0)
	clock := func() time.Time { return current }
	bandwidth := networking.NewBandwidthRegulator(100, clock)
	if !bandwidth.Allow("client-1", 100) {
		t.Fatalf("initial bandwidth allowance failed")
	}
	if bandwidth.Allow("client-1", 10) {
		t.Fatalf("expected bandwidth request to be throttled")
	}
	current = current.Add(time.Second)
	replayStats := func() replay.Stats {
		return replay.Stats{BufferedFrames: 3, BufferedBytes: 2048, Dumps: 2}
	}
	replayStorage := func() replay.StorageStats {
		return replay.StorageStats{Matches: 5, Headers: 5, Bytes: 12345, LastSweep: time.Unix(1700000000, 0)}
	}

	handlers := NewHandlerSet(Options{
		Logger:    logging.NewTestLogger(),
		Readiness: readiness,
		Stats: func() (int, int) {
			return 4, 2
		},
		Snapshots:     metrics,
		Bandwidth:     bandwidth,
		ReplayStats:   replayStats,
		ReplayStorage: replayStorage,
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
		"broker_snapshot_bytes_per_client{client=\"client-1\"} 256",
		"broker_snapshot_dropped_entities_total{tier=\"INTEREST_TIER_RADAR\"} 3",
		"broker_bandwidth_bytes_per_second{client=\"client-1\"} 100.00",
		"broker_bandwidth_denied_total{client=\"client-1\"} 1",
		"broker_replay_buffer_frames 3",
		"broker_replay_dumps_total 2",
		"broker_replay_storage_matches 5",
		"broker_replay_storage_bytes 12345",
		"broker_replay_storage_headers 5",
		"broker_replay_storage_last_sweep_timestamp_seconds 1700000000",
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

func TestMatchCapacityHandlerAdjustsLimits(t *testing.T) {
	session := &stubMatchSession{snapshot: match.Snapshot{MatchID: "persistent", Capacity: match.Capacity{MinPlayers: 1, MaxPlayers: 4}, ActivePlayers: []string{"pilot-1"}}}
	handlers := NewHandlerSet(Options{
		Logger:     logging.NewTestLogger(),
		AdminToken: "secret",
		Match:      session,
	})

	body := strings.NewReader(`{"max_players":6}`)
	req := httptest.NewRequest(http.MethodPost, "/admin/match/capacity", body)
	req.Header.Set("Authorization", "Bearer secret")
	rr := httptest.NewRecorder()

	handlers.MatchCapacityHandler().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d", rr.Code)
	}
	if session.max != 6 {
		t.Fatalf("expected max override to be recorded, got %d", session.max)
	}
	var payload struct {
		Status   string         `json:"status"`
		MatchID  string         `json:"match_id"`
		Capacity match.Capacity `json:"capacity"`
	}
	if err := json.NewDecoder(rr.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.Status != "ok" || payload.MatchID != "persistent" {
		t.Fatalf("unexpected response: %+v", payload)
	}
	if payload.Capacity.MaxPlayers != 6 || payload.Capacity.MinPlayers != 1 {
		t.Fatalf("unexpected capacity payload: %+v", payload.Capacity)
	}
}

func TestMatchCapacityHandlerValidatesAuthAndPayload(t *testing.T) {
	session := &stubMatchSession{snapshot: match.Snapshot{MatchID: "session", Capacity: match.Capacity{MinPlayers: 0, MaxPlayers: 2}}}
	handlers := NewHandlerSet(Options{
		Logger:     logging.NewTestLogger(),
		AdminToken: "secret",
		Match:      session,
	})

	unauthorized := httptest.NewRequest(http.MethodPost, "/admin/match/capacity", strings.NewReader(`{"max_players":4}`))
	rr := httptest.NewRecorder()
	handlers.MatchCapacityHandler().ServeHTTP(rr, unauthorized)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for missing auth, got %d", rr.Code)
	}

	badPayload := httptest.NewRequest(http.MethodPost, "/admin/match/capacity", strings.NewReader("not-json"))
	badPayload.Header.Set("Authorization", "Bearer secret")
	rr = httptest.NewRecorder()
	handlers.MatchCapacityHandler().ServeHTTP(rr, badPayload)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid payload, got %d", rr.Code)
	}

	session.err = errors.New("invalid capacity")
	failing := httptest.NewRequest(http.MethodPost, "/admin/match/capacity", strings.NewReader(`{"max_players":1}`))
	failing.Header.Set("Authorization", "Bearer secret")
	rr = httptest.NewRecorder()
	handlers.MatchCapacityHandler().ServeHTTP(rr, failing)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for rejected adjustment, got %d", rr.Code)
	}
}
