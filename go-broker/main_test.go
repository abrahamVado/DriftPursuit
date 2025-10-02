package main

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	configpkg "driftpursuit/broker/internal/config"
	"driftpursuit/broker/internal/input"
	"driftpursuit/broker/internal/logging"
	pb "driftpursuit/broker/internal/proto/pb"
	"driftpursuit/broker/internal/state"
	"github.com/gorilla/websocket"
	"google.golang.org/protobuf/encoding/protojson"
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
	if resp.Broadcasts != fake.stats.Broadcasts || resp.Clients != fake.stats.Clients {
		t.Fatalf("unexpected stats counts: got %+v want %+v", resp, fake.stats)
	}
	if !reflect.DeepEqual(resp.IntentDrops, fake.stats.IntentDrops) {
		t.Fatalf("unexpected intent drops: got %+v want %+v", resp.IntentDrops, fake.stats.IntentDrops)
	}
	if !reflect.DeepEqual(resp.IntentValidation, fake.stats.IntentValidation) {
		t.Fatalf("unexpected intent validation: got %+v want %+v", resp.IntentValidation, fake.stats.IntentValidation)
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

func TestServeWSRequiresAuthTokenWhenConfigured(t *testing.T) {
	upgrader.CheckOrigin = func(*http.Request) bool { return true }
	authenticator, err := newHMACWebsocketAuthenticator("shared-secret")
	if err != nil {
		t.Fatalf("newHMACWebsocketAuthenticator: %v", err)
	}
	broker := NewBroker(configpkg.DefaultMaxPayloadBytes, 0, time.Now(), logging.NewTestLogger(), WithWebsocketAuthenticator(authenticator))

	server := httptest.NewServer(http.HandlerFunc(broker.serveWS))
	defer server.Close()

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http")
	if _, resp, err := websocket.DefaultDialer.Dial(wsURL, nil); err == nil {
		t.Fatal("expected websocket dial without token to fail")
	} else if resp == nil || resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected unauthorized status, got resp=%v err=%v", resp, err)
	}

	token := issueTestToken(t, "shared-secret", "pilot-42", time.Now().Add(time.Minute))
	authURL := wsURL + "/?auth_token=" + url.QueryEscape(token)
	conn, _, err := websocket.DefaultDialer.Dial(authURL, nil)
	if err != nil {
		t.Fatalf("dial websocket with token: %v", err)
	}
	defer conn.Close()

	broker.lock.RLock()
	var found bool
	for client := range broker.clients {
		if client.id == "pilot-42" {
			found = true
		}
	}
	broker.lock.RUnlock()
	if !found {
		t.Fatal("expected authenticated client id to be recorded")
	}
}

func issueTestToken(t *testing.T, secret, subject string, expires time.Time) string {
	t.Helper()
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"HS256","typ":"JWT"}`))
	payload := fmt.Sprintf(`{"sub":"%s","exp":%d,"iat":%d}`, subject, expires.Unix(), time.Now().Unix())
	encodedPayload := base64.RawURLEncoding.EncodeToString([]byte(payload))
	signingInput := header + "." + encodedPayload
	mac := hmac.New(sha256.New, []byte(secret))
	if _, err := mac.Write([]byte(signingInput)); err != nil {
		t.Fatalf("mac write: %v", err)
	}
	signature := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return signingInput + "." + signature
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

func TestHandleStructuredMessageStoresVehicleState(t *testing.T) {
	broker := NewBroker(configpkg.DefaultMaxPayloadBytes, configpkg.DefaultMaxClients, time.Now(), logging.NewTestLogger())

	envelope := inboundEnvelope{Type: "vehicle_state", ID: "veh-001"}
	payload := &pb.VehicleState{
		SchemaVersion:       "0.2.0",
		Position:            &pb.Vector3{X: 1, Y: 2, Z: 3},
		Velocity:            &pb.Vector3{X: 4, Y: 5, Z: 6},
		Orientation:         &pb.Orientation{YawDeg: 10, PitchDeg: 5, RollDeg: 1},
		AngularVelocity:     &pb.Vector3{X: 0.1, Y: 0.2, Z: 0.3},
		SpeedMps:            123.4,
		ThrottlePct:         0.5,
		VerticalThrustPct:   -0.25,
		BoostPct:            0.9,
		BoostActive:         true,
		FlightAssistEnabled: true,
		EnergyRemainingPct:  0.75,
		UpdatedAtMs:         123456789,
	}

	raw, err := protojson.Marshal(payload)
	if err != nil {
		t.Fatalf("Marshal vehicle_state: %v", err)
	}

	consumed := broker.handleStructuredMessage(nil, envelope, raw)
	if !consumed {
		t.Fatalf("vehicle_state should be consumed for diff broadcast")
	}

	stored := broker.vehicleState("veh-001")
	if stored == nil {
		t.Fatalf("vehicle_state not stored")
	}
	if got, want := stored.GetVehicleId(), "veh-001"; got != want {
		t.Fatalf("vehicle_state id = %q, want %q", got, want)
	}

	stored.SpeedMps = 1.0
	fresh := broker.vehicleState("veh-001")
	if fresh == nil {
		t.Fatalf("vehicle_state clone missing")
	}
	if got, want := fresh.GetSpeedMps(), 123.4; got != want {
		t.Fatalf("vehicle_state clone mutated: got %.1f want %.1f", got, want)
	}
}

func TestHandleStructuredMessageStoresProjectileState(t *testing.T) {
	broker := NewBroker(configpkg.DefaultMaxPayloadBytes, configpkg.DefaultMaxClients, time.Now(), logging.NewTestLogger())

	envelope := inboundEnvelope{Type: "projectile_state", ID: "proj-42"}
	raw, err := json.Marshal(map[string]any{
		"type":          "projectile_state",
		"id":            "proj-42",
		"position":      map[string]any{"x": 1.0},
		"velocity":      map[string]any{"x": 5.0},
		"active":        true,
		"updated_at_ms": 123,
	})
	if err != nil {
		t.Fatalf("marshal projectile_state: %v", err)
	}

	consumed := broker.handleStructuredMessage(nil, envelope, raw)
	if !consumed {
		t.Fatalf("projectile_state should be consumed")
	}

	diff := broker.world.Projectiles.ConsumeDiff()
	if len(diff.Updated) != 1 {
		t.Fatalf("expected projectile stored")
	}
	if diff.Updated[0].ID != "proj-42" {
		t.Fatalf("unexpected projectile id %q", diff.Updated[0].ID)
	}
}

func TestHandleStructuredMessageStoresGameEvent(t *testing.T) {
	broker := NewBroker(configpkg.DefaultMaxPayloadBytes, configpkg.DefaultMaxClients, time.Now(), logging.NewTestLogger())
	envelope := inboundEnvelope{Type: "game_event", ID: "evt-9"}
	raw, err := json.Marshal(map[string]any{
		"type":           "game_event",
		"id":             "evt-9",
		"schema_version": "1.0",
		"event_id":       "",
	})
	if err != nil {
		t.Fatalf("marshal game_event: %v", err)
	}

	consumed := broker.handleStructuredMessage(nil, envelope, raw)
	if !consumed {
		t.Fatalf("game_event should be consumed")
	}

	diff := broker.world.Events.ConsumeDiff()
	if len(diff.Events) != 1 {
		t.Fatalf("expected stored event")
	}
	if diff.Events[0].GetEventId() != "evt-9" {
		t.Fatalf("unexpected event id %q", diff.Events[0].GetEventId())
	}
}

func TestAdvanceSimulationBroadcastsDiff(t *testing.T) {
	broker := NewBroker(configpkg.DefaultMaxPayloadBytes, configpkg.DefaultMaxClients, time.Now(), logging.NewTestLogger())
	client := &Client{send: make(chan []byte, 1), id: "test"}
	broker.lock.Lock()
	broker.clients[client] = true
	broker.lock.Unlock()

	broker.storeVehicleState(&pb.VehicleState{VehicleId: "veh-adv", Position: &pb.Vector3{}})
	broker.advanceSimulation(16 * time.Millisecond)

	select {
	case msg := <-client.send:
		var envelope worldDiffEnvelope
		if err := json.Unmarshal(msg, &envelope); err != nil {
			t.Fatalf("unmarshal diff: %v", err)
		}
		if envelope.Type != "world_diff" {
			t.Fatalf("unexpected diff type %q", envelope.Type)
		}
		if envelope.Vehicles == nil || len(envelope.Vehicles.Updated) == 0 {
			t.Fatalf("expected vehicle updates in diff")
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for diff broadcast")
	}
}

func TestHandleStructuredMessageStoresIntent(t *testing.T) {
	broker := NewBroker(configpkg.DefaultMaxPayloadBytes, configpkg.DefaultMaxClients, time.Now(), logging.NewTestLogger())

	envelope := inboundEnvelope{Type: "intent", ID: "pilot-007"}
	raw, err := json.Marshal(map[string]any{
		"type":           "intent",
		"id":             "pilot-007",
		"schema_version": "0.1.0",
		"controller_id":  "",
		"sequence_id":    1,
		"throttle":       0.75,
		"brake":          0.25,
		"steer":          -0.5,
		"handbrake":      false,
		"gear":           3,
		"boost":          true,
	})
	if err != nil {
		t.Fatalf("marshal intent: %v", err)
	}

	consumed := broker.handleStructuredMessage(nil, envelope, raw)
	if !consumed {
		t.Fatalf("intent should be consumed, got broadcast")
	}

	stored := broker.intentForController("pilot-007")
	if stored == nil {
		t.Fatalf("intent not stored")
	}
	if got, want := stored.SequenceID, uint64(1); got != want {
		t.Fatalf("intent sequence = %d, want %d", got, want)
	}
	if got, want := stored.Throttle, 0.75; got != want {
		t.Fatalf("intent throttle = %.2f, want %.2f", got, want)
	}
	if !stored.Boost {
		t.Fatalf("intent boost flag lost")
	}
}

func TestHandleStructuredMessageRejectsIntentRegression(t *testing.T) {
	broker := NewBroker(configpkg.DefaultMaxPayloadBytes, configpkg.DefaultMaxClients, time.Now(), logging.NewTestLogger())

	envelope := inboundEnvelope{Type: "intent", ID: "pilot-008"}

	raw1, err := json.Marshal(map[string]any{
		"type":           "intent",
		"id":             "pilot-008",
		"schema_version": "0.1.0",
		"sequence_id":    2,
		"throttle":       0.2,
		"brake":          0.1,
		"steer":          0.1,
		"handbrake":      false,
		"gear":           2,
		"boost":          false,
	})
	if err != nil {
		t.Fatalf("marshal intent#1: %v", err)
	}

	if consumed := broker.handleStructuredMessage(nil, envelope, raw1); !consumed {
		t.Fatalf("intent#1 should be consumed")
	}

	raw2, err := json.Marshal(map[string]any{
		"type":           "intent",
		"id":             "pilot-008",
		"schema_version": "0.1.0",
		"sequence_id":    1,
		"throttle":       0.3,
		"brake":          0.0,
		"steer":          0.0,
		"handbrake":      false,
		"gear":           2,
		"boost":          false,
	})
	if err != nil {
		t.Fatalf("marshal intent#2: %v", err)
	}

	if consumed := broker.handleStructuredMessage(nil, envelope, raw2); !consumed {
		t.Fatalf("intent#2 should be consumed even when rejected")
	}

	stored := broker.intentForController("pilot-008")
	if stored == nil {
		t.Fatalf("intent missing after regression attempt")
	}
	if got, want := stored.SequenceID, uint64(2); got != want {
		t.Fatalf("intent sequence mutated: got %d want %d", got, want)
	}
}

func TestHandleStructuredMessageRejectsIntentOutOfRange(t *testing.T) {
	//1.- Build a baseline broker that uses the default validator configuration.
	broker := NewBroker(configpkg.DefaultMaxPayloadBytes, configpkg.DefaultMaxClients, time.Now(), logging.NewTestLogger())

	envelope := inboundEnvelope{Type: "intent", ID: "pilot-range"}
	//2.- Craft a payload that violates the throttle range envelope.
	raw, err := json.Marshal(map[string]any{
		"type":           "intent",
		"id":             "pilot-range",
		"schema_version": "0.1.0",
		"sequence_id":    1,
		"throttle":       1.5,
		"brake":          0.1,
		"steer":          0.0,
		"handbrake":      false,
		"gear":           2,
		"boost":          false,
	})
	if err != nil {
		t.Fatalf("marshal intent: %v", err)
	}

	if consumed := broker.handleStructuredMessage(nil, envelope, raw); !consumed {
		t.Fatalf("intent should be consumed even when rejected")
	}
	if stored := broker.intentForController("pilot-range"); stored != nil {
		t.Fatalf("out-of-range intent should not be stored")
	}

	stats := broker.Stats()
	key := fmt.Sprintf("%s|%s", envelope.ID, envelope.ID)
	counters, ok := stats.IntentValidation[key]
	if !ok {
		t.Fatalf("expected validation counters for %s", key)
	}
	if counters.Violations[input.ValidationReasonThrottleRange] == 0 {
		t.Fatalf("expected throttle range violation in stats, got %+v", counters)
	}
}

func TestHandleStructuredMessageRejectsIntentDelta(t *testing.T) {
	//1.- Initialise the broker with the default validator.
	broker := NewBroker(configpkg.DefaultMaxPayloadBytes, configpkg.DefaultMaxClients, time.Now(), logging.NewTestLogger())

	envelope := inboundEnvelope{Type: "intent", ID: "pilot-delta"}
	//2.- Seed the validator with a valid baseline frame.
	raw1, err := json.Marshal(map[string]any{
		"type":           "intent",
		"id":             "pilot-delta",
		"schema_version": "0.1.0",
		"sequence_id":    1,
		"throttle":       0.0,
		"brake":          0.0,
		"steer":          0.0,
		"handbrake":      false,
		"gear":           1,
		"boost":          false,
	})
	if err != nil {
		t.Fatalf("marshal intent#1: %v", err)
	}
	if consumed := broker.handleStructuredMessage(nil, envelope, raw1); !consumed {
		t.Fatalf("first intent should be consumed")
	}

	raw2, err := json.Marshal(map[string]any{
		"type":           "intent",
		"id":             "pilot-delta",
		"schema_version": "0.1.0",
		"sequence_id":    2,
		"throttle":       1.0,
		"brake":          0.0,
		"steer":          0.0,
		"handbrake":      false,
		"gear":           1,
		"boost":          false,
	})
	if err != nil {
		t.Fatalf("marshal intent#2: %v", err)
	}
	if consumed := broker.handleStructuredMessage(nil, envelope, raw2); !consumed {
		t.Fatalf("second intent should be consumed even when rejected")
	}

	stored := broker.intentForController("pilot-delta")
	if stored == nil {
		t.Fatalf("intent missing after delta test")
	}
	if got, want := stored.Throttle, 0.0; got != want {
		t.Fatalf("throttle changed despite rejection: got %.2f want %.2f", got, want)
	}

	stats := broker.Stats()
	key := fmt.Sprintf("%s|%s", envelope.ID, envelope.ID)
	counters, ok := stats.IntentValidation[key]
	if !ok {
		t.Fatalf("expected validation counters for %s", key)
	}
	if counters.Violations[input.ValidationReasonThrottleDelta] == 0 {
		t.Fatalf("expected throttle delta violation, got %+v", counters)
	}
}

type intentClock struct {
	mu  sync.Mutex
	now time.Time
}

// 1.-Now returns the synthetic timestamp used to drive the gate during tests.
func (c *intentClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

// 2.-Advance shifts the clock forward by the requested duration.
func (c *intentClock) Advance(d time.Duration) {
	c.mu.Lock()
	c.now = c.now.Add(d)
	c.mu.Unlock()
}

func TestHandleStructuredMessageRateLimitsIntent(t *testing.T) {
	base := time.Unix(0, 0)
	clock := &intentClock{now: base}
	gate := input.NewGate(input.Config{MaxAge: 250 * time.Millisecond, MinInterval: time.Second / 60}, logging.NewTestLogger(), input.WithClock(clock))
	broker := NewBroker(configpkg.DefaultMaxPayloadBytes, configpkg.DefaultMaxClients, time.Now(), logging.NewTestLogger(), WithIntentGate(gate))
	client := &Client{id: "conn-rate", log: logging.NewTestLogger()}

	envelope := inboundEnvelope{Type: "intent", ID: "pilot-007"}
	raw1, err := json.Marshal(map[string]any{
		"type":           "intent",
		"id":             "pilot-007",
		"schema_version": "0.1.0",
		"sequence_id":    1,
		"throttle":       0.5,
		"brake":          0.1,
		"steer":          0.0,
		"handbrake":      false,
		"gear":           3,
		"boost":          false,
	})
	if err != nil {
		t.Fatalf("marshal intent#1: %v", err)
	}

	if consumed := broker.handleStructuredMessage(client, envelope, raw1); !consumed {
		t.Fatalf("first intent should be consumed")
	}

	clock.Advance(5 * time.Millisecond)
	raw2, err := json.Marshal(map[string]any{
		"type":           "intent",
		"id":             "pilot-007",
		"schema_version": "0.1.0",
		"sequence_id":    2,
		"throttle":       0.6,
		"brake":          0.1,
		"steer":          0.1,
		"handbrake":      false,
		"gear":           3,
		"boost":          false,
	})
	if err != nil {
		t.Fatalf("marshal intent#2: %v", err)
	}

	if consumed := broker.handleStructuredMessage(client, envelope, raw2); !consumed {
		t.Fatalf("second intent should be consumed even when dropped")
	}

	stored := broker.intentForController("pilot-007")
	if stored == nil {
		t.Fatalf("intent missing after rate limit test")
	}
	if got, want := stored.SequenceID, uint64(1); got != want {
		t.Fatalf("intent sequence advanced unexpectedly: got %d want %d", got, want)
	}

	stats := broker.Stats()
	drops := stats.IntentDrops[client.id]
	if drops.RateLimited != 1 {
		t.Fatalf("rate limited drops = %d, want 1", drops.RateLimited)
	}
}

func TestHandleStructuredMessageEnforcesIntentCooldown(t *testing.T) {
	base := time.Unix(0, 0)
	clock := &intentClock{now: base}
	cfg := input.DefaultControlConstraints
	cfg.InvalidBurstLimit = 2
	cfg.CooldownDuration = 200 * time.Millisecond
	//1.- Construct a validator with a short cooldown window so the test runs quickly.
	validator := input.NewValidator(cfg, logging.NewTestLogger(), input.WithValidatorClock(clock))
	gate := input.NewGate(input.Config{}, logging.NewTestLogger(), input.WithClock(clock))
	//2.- Provision a broker that uses the customised gate and validator.
	broker := NewBroker(configpkg.DefaultMaxPayloadBytes, configpkg.DefaultMaxClients, time.Now(), logging.NewTestLogger(), WithIntentGate(gate), WithIntentValidator(validator))

	envelope := inboundEnvelope{Type: "intent", ID: "pilot-cool"}

	//3.- Accept an initial baseline frame to seed the delta calculations.
	rawValid, err := json.Marshal(map[string]any{
		"type":           "intent",
		"id":             "pilot-cool",
		"schema_version": "0.1.0",
		"sequence_id":    1,
		"throttle":       0.0,
		"brake":          0.0,
		"steer":          0.0,
		"handbrake":      false,
		"gear":           1,
		"boost":          false,
	})
	if err != nil {
		t.Fatalf("marshal baseline intent: %v", err)
	}
	if consumed := broker.handleStructuredMessage(nil, envelope, rawValid); !consumed {
		t.Fatalf("baseline intent should be consumed")
	}

	//4.- Deliver repeated delta spikes to trigger the cooldown threshold.
	rawSpike, err := json.Marshal(map[string]any{
		"type":           "intent",
		"id":             "pilot-cool",
		"schema_version": "0.1.0",
		"sequence_id":    2,
		"throttle":       1.0,
		"brake":          0.0,
		"steer":          0.0,
		"handbrake":      false,
		"gear":           1,
		"boost":          false,
	})
	if err != nil {
		t.Fatalf("marshal spike intent#1: %v", err)
	}
	if consumed := broker.handleStructuredMessage(nil, envelope, rawSpike); !consumed {
		t.Fatalf("spike intent#1 should be consumed")
	}

	rawSpike2, err := json.Marshal(map[string]any{
		"type":           "intent",
		"id":             "pilot-cool",
		"schema_version": "0.1.0",
		"sequence_id":    3,
		"throttle":       1.0,
		"brake":          0.0,
		"steer":          0.0,
		"handbrake":      false,
		"gear":           1,
		"boost":          false,
	})
	if err != nil {
		t.Fatalf("marshal spike intent#2: %v", err)
	}
	if consumed := broker.handleStructuredMessage(nil, envelope, rawSpike2); !consumed {
		t.Fatalf("spike intent#2 should be consumed")
	}

	stats := broker.Stats()
	key := fmt.Sprintf("%s|%s", envelope.ID, envelope.ID)
	counters, ok := stats.IntentValidation[key]
	if !ok {
		t.Fatalf("expected validation counters for %s", key)
	}
	if counters.Cooldowns != 1 {
		t.Fatalf("expected 1 cooldown activation, got %+v", counters)
	}

	//5.- Attempt a compliant frame during the cooldown and confirm it is rejected.
	rawDuringCooldown, err := json.Marshal(map[string]any{
		"type":           "intent",
		"id":             "pilot-cool",
		"schema_version": "0.1.0",
		"sequence_id":    4,
		"throttle":       0.2,
		"brake":          0.0,
		"steer":          0.0,
		"handbrake":      false,
		"gear":           1,
		"boost":          false,
	})
	if err != nil {
		t.Fatalf("marshal cooldown intent: %v", err)
	}
	if consumed := broker.handleStructuredMessage(nil, envelope, rawDuringCooldown); !consumed {
		t.Fatalf("cooldown intent should be consumed")
	}
	stored := broker.intentForController("pilot-cool")
	if stored == nil {
		t.Fatalf("intent missing after cooldown attempt")
	}
	if got, want := stored.SequenceID, uint64(1); got != want {
		t.Fatalf("sequence advanced during cooldown: got %d want %d", got, want)
	}

	//6.- Fast-forward beyond the cooldown interval and verify the next frame is accepted.
	clock.Advance(cfg.CooldownDuration)

	rawPostCooldown, err := json.Marshal(map[string]any{
		"type":           "intent",
		"id":             "pilot-cool",
		"schema_version": "0.1.0",
		"sequence_id":    5,
		"throttle":       0.2,
		"brake":          0.0,
		"steer":          0.0,
		"handbrake":      false,
		"gear":           1,
		"boost":          false,
	})
	if err != nil {
		t.Fatalf("marshal post-cooldown intent: %v", err)
	}
	if consumed := broker.handleStructuredMessage(nil, envelope, rawPostCooldown); !consumed {
		t.Fatalf("post-cooldown intent should be consumed")
	}

	stored = broker.intentForController("pilot-cool")
	if stored == nil {
		t.Fatalf("intent missing after post-cooldown")
	}
	if got, want := stored.SequenceID, uint64(5); got != want {
		t.Fatalf("unexpected sequence after cooldown: got %d want %d", got, want)
	}
	if got, want := stored.Throttle, 0.2; got != want {
		t.Fatalf("unexpected throttle after cooldown: got %.2f want %.2f", got, want)
	}
}

func TestBrokerTimeSyncSnapshot(t *testing.T) {
	logger := logging.NewTestLogger()
	startedAt := time.Now().Add(-123 * time.Millisecond)
	broker := NewBroker(configpkg.DefaultMaxPayloadBytes, configpkg.DefaultMaxClients, startedAt, logger)

	atomic.StoreInt64(&broker.simulatedElapsedNs, (123 * time.Millisecond).Nanoseconds())

	serverMs, simulatedMs, offsetMs := broker.TimeSyncSnapshot()

	expectedSim := startedAt.UTC().Add(123 * time.Millisecond).UnixMilli()
	if simulatedMs != expectedSim {
		t.Fatalf("expected simulated timestamp %d, got %d", expectedSim, simulatedMs)
	}

	if abs := absInt64(offsetMs); abs > 10 {
		t.Fatalf("expected offset within 10ms, got %d (server=%d simulated=%d)", offsetMs, serverMs, simulatedMs)
	}
}

func TestBrokerSubscribeStateDiffs(t *testing.T) {
	broker := NewBroker(configpkg.DefaultMaxPayloadBytes, configpkg.DefaultMaxClients, time.Now(), logging.NewTestLogger())
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	ch, stop, err := broker.SubscribeStateDiffs(ctx)
	if err != nil {
		t.Fatalf("subscribe state diffs: %v", err)
	}
	defer stop()

	diff := state.TickDiff{Vehicles: state.VehicleDiff{Updated: []*pb.VehicleState{{VehicleId: "veh-42"}}}}
	broker.publishWorldDiff(7, diff)

	select {
	case event := <-ch:
		if event.Tick != 7 {
			t.Fatalf("unexpected tick %d", event.Tick)
		}
		var decoded map[string]any
		if err := json.Unmarshal(event.Payload, &decoded); err != nil {
			t.Fatalf("decode payload: %v", err)
		}
		if decoded["tick"].(float64) != 7 {
			t.Fatalf("payload tick mismatch: %+v", decoded)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for diff event")
	}
}
