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
	"fmt"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"testing"
	"time"
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

	certFile, keyFile := generateSelfSignedCert(t)

	handler, err := buildHandler()
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

	url := fmt.Sprintf("https://%s/viewer/index.html", ln.Addr().String())
	resp, err := client.Get(url)
	if err != nil {
		t.Fatalf("GET viewer: %v", err)
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
