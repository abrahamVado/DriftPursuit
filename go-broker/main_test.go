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
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

/***************
 * Test helpers
 ***************/

// ensureViewerFixture makes sure ../viewer/index.html exists relative to this file.
// If it creates the directory/file, it will clean them up after the test.
func ensureViewerFixture(t *testing.T) {
	t.Helper()

	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatalf("runtime.Caller failed")
	}
	viewerDir := filepath.Clean(filepath.Join(filepath.Dir(thisFile), "..", "viewer"))
	indexPath := filepath.Join(viewerDir, "index.html")

	// Track whether we created things, so we can clean up.
	var createdDir, createdFile bool

	if _, err := os.Stat(viewerDir); os.IsNotExist(err) {
		if err := os.MkdirAll(viewerDir, 0o755); err != nil {
			t.Fatalf("mkdir viewer dir: %v", err)
		}
		createdDir = true
	}
	if _, err := os.Stat(indexPath); os.IsNotExist(err) {
		if err := os.WriteFile(indexPath, []byte("<!doctype html><title>viewer</title>ok"), 0o644); err != nil {
			t.Fatalf("write viewer/index.html: %v", err)
		}
		createdFile = true
	}

	// Cleanup only what we created.
	t.Cleanup(func() {
		if createdFile {
			_ = os.Remove(indexPath)
		}
		if createdDir {
			_ = os.Remove(viewerDir)
		}
	})
}

func ensureViewerMissing(t *testing.T) {
	t.Helper()

	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatalf("runtime.Caller failed")
	}
	viewerDir := filepath.Clean(filepath.Join(filepath.Dir(thisFile), "..", "viewer"))

	info, err := os.Stat(viewerDir)
	if err != nil {
		if os.IsNotExist(err) {
			return
		}
		t.Fatalf("stat viewer dir: %v", err)
	}
	if !info.IsDir() {
		t.Fatalf("viewer path exists but is not a directory: %s", viewerDir)
	}

	backupDir := viewerDir
	for i := 0; ; i++ {
		candidate := fmt.Sprintf("%s-backup-%d", viewerDir, i)
		if _, err := os.Stat(candidate); os.IsNotExist(err) {
			backupDir = candidate
			break
		}
	}

	if err := os.Rename(viewerDir, backupDir); err != nil {
		t.Fatalf("rename viewer dir for backup: %v", err)
	}

	t.Cleanup(func() {
		if err := os.Rename(backupDir, viewerDir); err != nil {
			t.Fatalf("restore viewer dir: %v", err)
		}
	})
}

func ensureTerraSandboxFixture(t *testing.T) {
	t.Helper()

	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatalf("runtime.Caller failed")
	}
	sandboxDir := filepath.Clean(filepath.Join(filepath.Dir(thisFile), "..", "terra-sandbox"))
	indexPath := filepath.Join(sandboxDir, "index.html")

	var createdDir, createdFile bool

	if _, err := os.Stat(sandboxDir); os.IsNotExist(err) {
		if err := os.MkdirAll(sandboxDir, 0o755); err != nil {
			t.Fatalf("mkdir terra-sandbox dir: %v", err)
		}
		createdDir = true
	}
	if _, err := os.Stat(indexPath); os.IsNotExist(err) {
		if err := os.WriteFile(indexPath, []byte("<!doctype html><title>terra sandbox</title>ok"), 0o644); err != nil {
			t.Fatalf("write terra-sandbox/index.html: %v", err)
		}
		createdFile = true
	}

	t.Cleanup(func() {
		if createdFile {
			_ = os.Remove(indexPath)
		}
		if createdDir {
			_ = os.Remove(sandboxDir)
		}
	})
}

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
 * Tests: TLS + static viewer
 ******************************/

func TestBrokerServesViewerOverTLS(t *testing.T) {
	ensureViewerFixture(t)
	ensureTerraSandboxFixture(t)

	certFile, keyFile := generateSelfSignedCert(t)

	broker := NewBroker(defaultMaxPayloadBytes, 256, time.Now())

	handler, err := buildHandler(broker)
	if err != nil {
		t.Fatalf("buildHandler: %v", err)
	}

	srv := &http.Server{Addr: "127.0.0.1:0", Handler: handler}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}

	serverErr := make(chan error, 1)
	go func() {
		serverErr <- srv.ServeTLS(ln, certFile, keyFile)
	}()

	// Insecure client (ok for test)
	client := &http.Client{
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: true}, //nolint:gosec
		},
		Timeout: 5 * time.Second,
	}

	u := fmt.Sprintf("https://%s/viewer/index.html", ln.Addr().String())
	resp, err := client.Get(u)
	if err != nil {
		t.Fatalf("GET viewer: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("unexpected status: %d", resp.StatusCode)
	}

	sandboxURL := fmt.Sprintf("https://%s/terra-sandbox/index.html", ln.Addr().String())
	respSandbox, err := client.Get(sandboxURL)
	if err != nil {
		t.Fatalf("GET terra-sandbox: %v", err)
	}
	defer respSandbox.Body.Close()

	if respSandbox.StatusCode != http.StatusOK {
		t.Fatalf("unexpected terra-sandbox status: %d", respSandbox.StatusCode)
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

func TestBuildHandlerWithoutViewer(t *testing.T) {
	ensureViewerMissing(t)
	ensureTerraSandboxFixture(t)

	broker := NewBroker(defaultMaxPayloadBytes, 256, time.Now())

	handler, err := buildHandler(broker)
	if err != nil {
		t.Fatalf("buildHandler: %v", err)
	}

	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)

	client := srv.Client()
	client.Timeout = 5 * time.Second

	respViewer, err := client.Get(srv.URL + "/viewer/index.html")
	if err != nil {
		t.Fatalf("GET viewer: %v", err)
	}
	respViewer.Body.Close()

	if respViewer.StatusCode != http.StatusNotFound {
		t.Fatalf("expected viewer to be unavailable, got status %d", respViewer.StatusCode)
	}

	respSandbox, err := client.Get(srv.URL + "/terra-sandbox/index.html")
	if err != nil {
		t.Fatalf("GET terra-sandbox: %v", err)
	}
	respSandbox.Body.Close()

	if respSandbox.StatusCode != http.StatusOK {
		t.Fatalf("expected terra-sandbox to be served, got status %d", respSandbox.StatusCode)
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
	broker := NewBroker(defaultMaxPayloadBytes, 5, started)
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
	broker := NewBroker(defaultMaxPayloadBytes, 0, time.Now())
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

func TestServeWSDropsInvalidMessages(t *testing.T) {
	upgrader.CheckOrigin = func(*http.Request) bool { return true }
	broker := NewBroker(defaultMaxPayloadBytes, 0, time.Now())

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
	broker := NewBroker(64, 0, time.Now()) // very small limit for the test

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

/*********************************
 * Test: capacity limiting (HTTP 503)
 *********************************/

func TestServeWSRejectsWhenAtCapacity(t *testing.T) {
	// Limit to 1 client
	b := NewBroker(defaultMaxPayloadBytes, 1, time.Now())

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
