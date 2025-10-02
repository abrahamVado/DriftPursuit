package main

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	configpkg "driftpursuit/broker/internal/config"
	"driftpursuit/broker/internal/logging"
	"github.com/gorilla/websocket"
)

// generateSelfSignedCert returns temp file paths for a short-lived self-signed cert/key.
func generateSelfSignedCert(t *testing.T) (certFile, keyFile string) {
	t.Helper()

	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("rsa.GenerateKey: %v", err)
	}

	serialNumberLimit := new(big.Int).Lsh(big.NewInt(1), 128)
	serial, err := rand.Int(rand.Reader, serialNumberLimit)
	if err != nil {
		t.Fatalf("rand.Int: %v", err)
	}

	now := time.Now()
	tmpl := x509.Certificate{
		SerialNumber: serial,
		Subject:      pkix.Name{CommonName: "localhost"},
		NotBefore:    now.Add(-time.Hour),
		NotAfter:     now.Add(2 * time.Hour),
		DNSNames:     []string{"localhost"},
		IPAddresses:  []net.IP{net.ParseIP("127.0.0.1")},
		KeyUsage:     x509.KeyUsageKeyEncipherment | x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}

	derBytes, err := x509.CreateCertificate(rand.Reader, &tmpl, &tmpl, &priv.PublicKey, priv)
	if err != nil {
		t.Fatalf("CreateCertificate: %v", err)
	}

	certOut, err := os.CreateTemp("", "broker-cert-*.pem")
	if err != nil {
		t.Fatalf("CreateTemp cert: %v", err)
	}
	if err := pem.Encode(certOut, &pem.Block{Type: "CERTIFICATE", Bytes: derBytes}); err != nil {
		t.Fatalf("encode cert: %v", err)
	}
	_ = certOut.Close()

	keyOut, err := os.CreateTemp("", "broker-key-*.pem")
	if err != nil {
		t.Fatalf("CreateTemp key: %v", err)
	}
	if err := pem.Encode(keyOut, &pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(priv)}); err != nil {
		t.Fatalf("encode key: %v", err)
	}
	_ = keyOut.Close()

	t.Cleanup(func() {
		_ = os.Remove(certOut.Name())
		_ = os.Remove(keyOut.Name())
	})

	return certOut.Name(), keyOut.Name()
}

/******************************
 * Tests: TLS + handler wiring
 ******************************/

func TestBrokerAPIsAccessibleOverTLS(t *testing.T) {
	certFile, keyFile := generateSelfSignedCert(t)

	broker := NewBroker(configpkg.DefaultMaxPayloadBytes, configpkg.DefaultMaxClients, time.Now(), logging.NewTestLogger())

	cfg := &configpkg.Config{
		AdminToken:       "test-token",
		ReplayDumpWindow: configpkg.DefaultReplayDumpWindow,
		ReplayDumpBurst:  configpkg.DefaultReplayDumpBurst,
	}

	handler := buildHandler(broker, cfg)

	srv := &http.Server{Addr: "127.0.0.1:0", Handler: handler}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}

	serverErr := make(chan error, 1)
	go func() {
		serverErr <- srv.ServeTLS(ln, certFile, keyFile)
	}()

	client := &http.Client{
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: true}, //nolint:gosec
		},
		Timeout: 5 * time.Second,
	}

	resp, err := client.Get(fmt.Sprintf("https://%s/healthz", ln.Addr().String()))
	if err != nil {
		t.Fatalf("GET healthz: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("unexpected status: %d", resp.StatusCode)
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		t.Fatalf("shutdown: %v", err)
	}

	if err := <-serverErr; err != nil && err != http.ErrServerClosed {
		t.Fatalf("ServeTLS: %v", err)
	}
}

func TestBuildHandlerRegistersRoutes(t *testing.T) {
	broker := NewBroker(configpkg.DefaultMaxPayloadBytes, configpkg.DefaultMaxClients, time.Now(), logging.NewTestLogger())
	cfg := &configpkg.Config{
		AdminToken:       "test-token",
		ReplayDumpWindow: configpkg.DefaultReplayDumpWindow,
		ReplayDumpBurst:  configpkg.DefaultReplayDumpBurst,
	}

	srv := httptest.NewServer(buildHandler(broker, cfg))
	t.Cleanup(srv.Close)

	client := srv.Client()
	client.Timeout = 5 * time.Second

	respHealth, err := client.Get(srv.URL + "/healthz")
	if err != nil {
		t.Fatalf("GET healthz: %v", err)
	}
	respHealth.Body.Close()
	if respHealth.StatusCode != http.StatusOK {
		t.Fatalf("expected healthz 200, got %d", respHealth.StatusCode)
	}

	respStats, err := client.Get(srv.URL + "/api/stats")
	if err != nil {
		t.Fatalf("GET stats: %v", err)
	}
	respStats.Body.Close()
	if respStats.StatusCode != http.StatusOK {
		t.Fatalf("expected stats 200, got %d", respStats.StatusCode)
	}

	respLive, err := client.Get(srv.URL + "/livez")
	if err != nil {
		t.Fatalf("GET livez: %v", err)
	}
	respLive.Body.Close()
	if respLive.StatusCode != http.StatusOK {
		t.Fatalf("expected livez 200, got %d", respLive.StatusCode)
	}

	respReady, err := client.Get(srv.URL + "/readyz")
	if err != nil {
		t.Fatalf("GET readyz: %v", err)
	}
	respReady.Body.Close()
	if respReady.StatusCode != http.StatusOK {
		t.Fatalf("expected readyz 200, got %d", respReady.StatusCode)
	}

	respMetrics, err := client.Get(srv.URL + "/metrics")
	if err != nil {
		t.Fatalf("GET metrics: %v", err)
	}
	respMetrics.Body.Close()
	if respMetrics.StatusCode != http.StatusOK {
		t.Fatalf("expected metrics 200, got %d", respMetrics.StatusCode)
	}

	reqReplay, err := http.NewRequest(http.MethodPost, srv.URL+"/replay/dump", nil)
	if err != nil {
		t.Fatalf("POST replay/dump request: %v", err)
	}
	respReplay, err := client.Do(reqReplay)
	if err != nil {
		t.Fatalf("POST replay/dump: %v", err)
	}
	respReplay.Body.Close()
	if respReplay.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected replay/dump 401 without token, got %d", respReplay.StatusCode)
	}

	respNotFound, err := client.Get(srv.URL + "/does-not-exist")
	if err != nil {
		t.Fatalf("GET not-found: %v", err)
	}
	respNotFound.Body.Close()
	if respNotFound.StatusCode != http.StatusNotFound {
		t.Fatalf("expected not-found 404, got %d", respNotFound.StatusCode)
	}
}

/*********************************
 * Tests: /api/stats JSON handler
 *********************************/

type fakeBroker struct {
	stats BrokerStats
	mu    sync.Mutex
	calls int
}

func (f *fakeBroker) Stats() BrokerStats {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls++
	return f.stats
}

func TestStatsHandlerReturnsJSON(t *testing.T) {
	fake := &fakeBroker{stats: BrokerStats{Broadcasts: 5, Clients: 2}}
	req := httptest.NewRequest(http.MethodGet, "/api/stats", nil)
	rr := httptest.NewRecorder()

	statsHandler(fake).ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("unexpected status: got %d", rr.Code)
	}
	if ct := rr.Header().Get("Content-Type"); ct != "application/json" {
		t.Fatalf("unexpected content type: got %q", ct)
	}

	var resp BrokerStats
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if resp != fake.stats {
		t.Fatalf("unexpected stats: got %+v want %+v", resp, fake.stats)
	}
	fake.mu.Lock()
	defer fake.mu.Unlock()
	if fake.calls != 1 {
		t.Fatalf("expected Stats to be called once, got %d", fake.calls)
	}
}

type blockingBroker struct {
	stats   BrokerStats
	wait    chan struct{}
	started chan struct{}
	calls   int
	mu      sync.Mutex
}

func (b *blockingBroker) Stats() BrokerStats {
	b.mu.Lock()
	b.calls++
	if b.started != nil {
		close(b.started)
		b.started = nil
	}
	b.mu.Unlock()
	<-b.wait
	return b.stats
}

func TestStatsHandlerHonorsLocking(t *testing.T) {
	blocker := &blockingBroker{
		stats:   BrokerStats{Broadcasts: 1, Clients: 1},
		wait:    make(chan struct{}),
		started: make(chan struct{}),
	}
	req := httptest.NewRequest(http.MethodGet, "/api/stats", nil)
	rr := httptest.NewRecorder()

	done := make(chan struct{})
	go func() {
		statsHandler(blocker).ServeHTTP(rr, req)
		close(done)
	}()

	// Wait until Stats() is entered to ensure we're blocking in handler.
	<-blocker.started

	select {
	case <-done:
		t.Fatal("handler returned before broker released lock")
	default:
		// still blocked as expected
	}

	// Unblock Stats() and let handler finish.
	close(blocker.wait)
	<-done

	blocker.mu.Lock()
	calls := blocker.calls
	blocker.mu.Unlock()
	if calls != 1 {
		t.Fatalf("expected Stats to be called once, got %d", calls)
	}
}

func TestHealthzHandlerHealthy(t *testing.T) {
	started := time.Now().Add(-2 * time.Second)
	broker := NewBroker(configpkg.DefaultMaxPayloadBytes, 5, started, logging.NewTestLogger())
	broker.lock.Lock()
	broker.stats.Clients = 3
	broker.pendingClients = 1
	broker.lock.Unlock()

	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	rr := httptest.NewRecorder()

	healthzHandler(broker).ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("unexpected status: got %d", rr.Code)
	}
	if ct := rr.Header().Get("Content-Type"); ct != "application/json" {
		t.Fatalf("unexpected content type: got %q", ct)
	}

	var resp struct {
		Status         string  `json:"status"`
		UptimeSeconds  float64 `json:"uptime_seconds"`
		Clients        int     `json:"clients"`
		PendingClients int     `json:"pending_clients"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal healthz response: %v", err)
	}
	if resp.Status != "ok" {
		t.Fatalf("unexpected status payload: %+v", resp)
	}
	if resp.UptimeSeconds < 1 {
		t.Fatalf("expected uptime >= 1s, got %f", resp.UptimeSeconds)
	}
	if resp.Clients != 3 {
		t.Fatalf("expected client count 3, got %d", resp.Clients)
	}
	if resp.PendingClients != 1 {
		t.Fatalf("expected pending clients 1, got %d", resp.PendingClients)
	}
}

func TestHealthzHandlerStartupError(t *testing.T) {
	broker := NewBroker(configpkg.DefaultMaxPayloadBytes, 0, time.Now(), logging.NewTestLogger())
	broker.setStartupError(errors.New("boom"))

	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	rr := httptest.NewRecorder()

	healthzHandler(broker).ServeHTTP(rr, req)

	if rr.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected status %d, got %d", http.StatusServiceUnavailable, rr.Code)
	}

	var resp struct {
		Status string `json:"status"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal healthz response: %v", err)
	}
	if resp.Status != "error" {
		t.Fatalf("expected status error in payload, got %+v", resp)
	}
}

/***********************
 * Tests: WS behavior
 ***********************/

func dialTestWebSocket(t *testing.T, serverURL string) *websocket.Conn {
	t.Helper()
	u := "ws" + strings.TrimPrefix(serverURL, "http")
	conn, _, err := websocket.DefaultDialer.Dial(u, nil)
	if err != nil {
		t.Fatalf("dial websocket: %v", err)
	}
	return conn
}

type wsReadResult struct {
	msg []byte
	err error
}

func listenOnce(conn *websocket.Conn) <-chan wsReadResult {
	ch := make(chan wsReadResult, 1)
	go func() {
		_, msg, err := conn.ReadMessage()
		ch <- wsReadResult{msg: msg, err: err}
	}()
	return ch
}

func waitForBrokerRecovery(t *testing.T, broker *Broker) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if !broker.isRecovering() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("broker did not finish recovery in time")
}

func TestServeWSDropsInvalidMessages(t *testing.T) {
	upgrader.CheckOrigin = func(*http.Request) bool { return true }
	broker := NewBroker(configpkg.DefaultMaxPayloadBytes, 0, time.Now(), logging.NewTestLogger())

	server := httptest.NewServer(http.HandlerFunc(broker.serveWS))
	defer server.Close()

	receiver := dialTestWebSocket(t, server.URL)
	defer receiver.Close()

	sender := dialTestWebSocket(t, server.URL)
	defer sender.Close()

	pending := listenOnce(receiver)

	// Send invalid (non-JSON) message; should be dropped and not broadcast.
	if err := sender.WriteMessage(websocket.TextMessage, []byte("not json")); err != nil {
		t.Fatalf("write invalid message: %v", err)
	}
	select {
	case res := <-pending:
		if res.err != nil {
			t.Fatalf("receiver connection error after invalid message: %v", res.err)
		}
		t.Fatalf("unexpected broadcast after invalid message: %s", string(res.msg))
	case <-time.After(200 * time.Millisecond):
		// expected: nothing received
	}

	// Send valid JSON; should be normalized and broadcast.
	valid := []byte(`{"type":"update","id":"123"}`)
	if err := sender.WriteMessage(websocket.TextMessage, valid); err != nil {
		t.Fatalf("write valid message: %v", err)
	}

	select {
	case res := <-pending:
		if res.err != nil {
			t.Fatalf("receiver connection error waiting for valid broadcast: %v", res.err)
		}
		var envelope inboundEnvelope
		if err := json.Unmarshal(res.msg, &envelope); err != nil {
			t.Fatalf("unmarshal broadcast: %v", err)
		}
		if envelope.Type != "update" || envelope.ID != "123" {
			t.Fatalf("unexpected broadcast payload: %+v", envelope)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for normalized broadcast")
	}
}

func TestServeWSRejectsOversizedMessages(t *testing.T) {
	upgrader.CheckOrigin = func(*http.Request) bool { return true }
	broker := NewBroker(64, 0, time.Now(), logging.NewTestLogger()) // very small limit for the test

	server := httptest.NewServer(http.HandlerFunc(broker.serveWS))
	defer server.Close()

	receiver := dialTestWebSocket(t, server.URL)
	defer receiver.Close()

	sender := dialTestWebSocket(t, server.URL)
	defer sender.Close()

	pending := listenOnce(receiver)

	// Build an envelope that exceeds the 64-byte limit.
	oversized := []byte(fmt.Sprintf(`{"type":"big","id":"%s"}`, strings.Repeat("x", 80)))
	if int64(len(oversized)) <= broker.maxPayloadBytes {
		t.Fatalf("constructed message length %d does not exceed broker limit %d", len(oversized), broker.maxPayloadBytes)
	}

	// Send oversized; server should close the offending connection.
	if err := sender.WriteMessage(websocket.TextMessage, oversized); err != nil {
		t.Fatalf("write oversized message: %v", err)
	}
	if err := sender.SetReadDeadline(time.Now().Add(time.Second)); err != nil {
		t.Fatalf("set read deadline: %v", err)
	}
	if _, _, err := sender.ReadMessage(); err == nil {
		t.Fatal("expected connection to close after oversized message")
	} else if !websocket.IsCloseError(err, websocket.CloseMessageTooBig) && !strings.Contains(strings.ToLower(err.Error()), "close 1009") {
		// some stacks map this to 1009 (Message Too Big)
		t.Fatalf("expected CloseMessageTooBig/1009 error, got %v", err)
	}
	if err := sender.SetReadDeadline(time.Time{}); err != nil {
		t.Fatalf("reset read deadline: %v", err)
	}

	// No broadcast should have been delivered.
	select {
	case res := <-pending:
		if res.err != nil {
			t.Fatalf("receiver connection error after oversized message: %v", res.err)
		}
		t.Fatalf("unexpected broadcast after oversized message: %s", string(res.msg))
	case <-time.After(200 * time.Millisecond):
		// expected
	}

	// New client can still send a valid message and be broadcast to the receiver.
	replacement := dialTestWebSocket(t, server.URL)
	defer replacement.Close()

	valid := []byte(`{"type":"ok","id":"42"}`)
	if err := replacement.WriteMessage(websocket.TextMessage, valid); err != nil {
		t.Fatalf("write valid message from replacement client: %v", err)
	}

	select {
	case res := <-pending:
		if res.err != nil {
			t.Fatalf("receiver connection error waiting for broadcast: %v", res.err)
		}
		var envelope inboundEnvelope
		if err := json.Unmarshal(res.msg, &envelope); err != nil {
			t.Fatalf("unmarshal broadcast: %v", err)
		}
		if envelope.Type != "ok" || envelope.ID != "42" {
			t.Fatalf("unexpected broadcast payload: %+v", envelope)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for broadcast after oversized message")
	}
}

func TestBrokerSnapshotRecovery(t *testing.T) {
	upgrader.CheckOrigin = func(*http.Request) bool { return true }
	tmpDir := t.TempDir()
	snapshotPath := filepath.Join(tmpDir, "state.json")

	logger := logging.NewTestLogger()

	// Seed snapshot with initial state.
	seedSnapshotter, err := NewStateSnapshotter(snapshotPath, time.Hour, logger)
	if err != nil {
		t.Fatalf("NewStateSnapshotter (seed): %v", err)
	}
	broker := NewBroker(configpkg.DefaultMaxPayloadBytes, 0, time.Now(), logger, WithSnapshotter(seedSnapshotter))
	waitForBrokerRecovery(t, broker)

	initial := []byte(`{"type":"match_state","id":"abc","score":1}`)
	seedSnapshotter.Record("match_state", initial)
	if err := seedSnapshotter.Flush(); err != nil {
		t.Fatalf("seed snapshot flush: %v", err)
	}
	if err := seedSnapshotter.Close(); err != nil {
		t.Fatalf("seed snapshot close: %v", err)
	}

	// Restart broker with delayed snapshot load to exercise recovery behaviour.
	recoveringSnapshotter, err := NewStateSnapshotter(snapshotPath, time.Hour, logger, WithSnapshotReplayDelay(time.Second))
	if err != nil {
		t.Fatalf("NewStateSnapshotter (recovering): %v", err)
	}
	defer func() { _ = recoveringSnapshotter.Close() }()

	recoveringBroker := NewBroker(configpkg.DefaultMaxPayloadBytes, 0, time.Now(), logger, WithSnapshotter(recoveringSnapshotter))

	cfg := &configpkg.Config{
		AdminToken:       "test-token",
		ReplayDumpWindow: configpkg.DefaultReplayDumpWindow,
		ReplayDumpBurst:  configpkg.DefaultReplayDumpBurst,
	}
	server := httptest.NewServer(buildHandler(recoveringBroker, cfg))
	defer server.Close()

	// Ready endpoint should report recovery in progress.
	respReady, err := server.Client().Get(server.URL + "/readyz")
	if err != nil {
		t.Fatalf("GET readyz during recovery: %v", err)
	}
	if respReady.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("expected readyz 503 during recovery, got %d", respReady.StatusCode)
	}
	var readyPayload struct {
		Status  string `json:"status"`
		Message string `json:"message"`
	}
	if err := json.NewDecoder(respReady.Body).Decode(&readyPayload); err != nil {
		t.Fatalf("decode readyz payload: %v", err)
	}
	respReady.Body.Close()
	if !strings.Contains(readyPayload.Message, "recovery") {
		t.Fatalf("expected ready message to mention recovery, got %+v", readyPayload)
	}

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/ws"
	conn, resp, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err == nil {
		conn.Close()
		t.Fatal("expected websocket dial to fail during recovery")
	}
	if resp == nil || resp.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("expected websocket rejection with 503, got resp=%v err=%v", resp, err)
	}
	if resp != nil && resp.Body != nil {
		resp.Body.Close()
	}

	waitForBrokerRecovery(t, recoveringBroker)

	// Ready endpoint should now be healthy.
	respReady2, err := server.Client().Get(server.URL + "/readyz")
	if err != nil {
		t.Fatalf("GET readyz after recovery: %v", err)
	}
	if respReady2.StatusCode != http.StatusOK {
		t.Fatalf("expected readyz 200 after recovery, got %d", respReady2.StatusCode)
	}
	respReady2.Body.Close()

	snapshots := recoveringSnapshotter.StateMessages()
	if len(snapshots) != 2 {
		t.Fatalf("expected two snapshot messages, got %d", len(snapshots))
	}

	conn, _, err = websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial websocket after recovery: %v", err)
	}
	defer conn.Close()
	if err := conn.SetReadDeadline(time.Now().Add(time.Second)); err != nil {
		t.Fatalf("set read deadline: %v", err)
	}
	var receivedTypes []string
	for i := 0; i < 2; i++ {
		if err := conn.SetReadDeadline(time.Now().Add(time.Second)); err != nil {
			t.Fatalf("set read deadline %d: %v", i, err)
		}
		_, payload, err := conn.ReadMessage()
		if err != nil {
			t.Fatalf("read snapshot message %d: %v", i, err)
		}
		var envelope struct {
			Type   string `json:"type"`
			Status string `json:"status"`
		}
		if err := json.Unmarshal(payload, &envelope); err != nil {
			t.Fatalf("decode snapshot message %d: %v", i, err)
		}
		receivedTypes = append(receivedTypes, envelope.Type)
		if envelope.Type == "system_status" && envelope.Status != "recovered" {
			t.Fatalf("unexpected system status payload: %+v", envelope)
		}
	}
	sort.Strings(receivedTypes)
	if !reflect.DeepEqual(receivedTypes, []string{"match_state", "system_status"}) {
		t.Fatalf("expected replay types match_state and system_status, got %v", receivedTypes)
	}
}

/*********************************
 * Test: capacity limiting (HTTP 503)
 *********************************/

func TestServeWSRejectsWhenAtCapacity(t *testing.T) {
	// Limit to 1 client
	b := NewBroker(configpkg.DefaultMaxPayloadBytes, 1, time.Now(), logging.NewTestLogger())

	// Pretend one client is already connected
	existing := &Client{send: make(chan []byte, 1)}
	b.lock.Lock()
	b.clients[existing] = true
	b.stats.Clients = 1
	b.lock.Unlock()

	// Plain HTTP request (no real upgrade needed) should hit pre-upgrade capacity check.
	req := httptest.NewRequest(http.MethodGet, "/ws", nil)
	req.Header.Set("Connection", "Upgrade")
	req.Header.Set("Upgrade", "websocket")
	rr := httptest.NewRecorder()

	b.serveWS(rr, req)

	if rr.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected status %d, got %d", http.StatusServiceUnavailable, rr.Code)
	}

	b.lock.Lock()
	clientCount := len(b.clients)
	pending := b.pendingClients
	b.lock.Unlock()

	if clientCount != 1 {
		t.Fatalf("expected client count to remain 1, got %d", clientCount)
	}
	if pending != 0 {
		t.Fatalf("expected pending clients to be 0, got %d", pending)
	}
}
