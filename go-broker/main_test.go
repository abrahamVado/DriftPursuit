package main

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"net"
	"net/http"
	"testing"
	"time"

	"crypto/tls"
	"os"
)

func TestBrokerServesViewerOverTLS(t *testing.T) {
	certFile, keyFile := generateSelfSignedCert(t)
	t.Cleanup(func() {
		_ = os.Remove(certFile)
		_ = os.Remove(keyFile)
	})

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

	client := &http.Client{Transport: &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}}}
	resp, err := client.Get("https://" + ln.Addr().String() + "/viewer/index.html")
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
		t.Fatalf("serveTLS: %v", err)
	}
}

func generateSelfSignedCert(t *testing.T) (certFile, keyFile string) {
	t.Helper()

	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}

	serialNumberLimit := new(big.Int).Lsh(big.NewInt(1), 128)
	serialNumber, err := rand.Int(rand.Reader, serialNumberLimit)
	if err != nil {
		t.Fatalf("serial number: %v", err)
	}

	tmpl := x509.Certificate{
		SerialNumber: serialNumber,
		Subject:      pkix.Name{CommonName: "localhost"},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(time.Hour),
		DNSNames:     []string{"localhost"},
		IPAddresses:  []net.IP{net.ParseIP("127.0.0.1")},
		KeyUsage:     x509.KeyUsageKeyEncipherment | x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}

	derBytes, err := x509.CreateCertificate(rand.Reader, &tmpl, &tmpl, &privateKey.PublicKey, privateKey)
	if err != nil {
		t.Fatalf("create certificate: %v", err)
	}

	certOut, err := os.CreateTemp("", "broker-cert-*.pem")
	if err != nil {
		t.Fatalf("create cert temp: %v", err)
	}
	if err := pem.Encode(certOut, &pem.Block{Type: "CERTIFICATE", Bytes: derBytes}); err != nil {
		t.Fatalf("encode cert: %v", err)
	}
	if err := certOut.Close(); err != nil {
		t.Fatalf("close cert: %v", err)
	}

	keyOut, err := os.CreateTemp("", "broker-key-*.pem")
	if err != nil {
		t.Fatalf("create key temp: %v", err)
	}
	if err := pem.Encode(keyOut, &pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(privateKey)}); err != nil {
		t.Fatalf("encode key: %v", err)
	}
	if err := keyOut.Close(); err != nil {
		t.Fatalf("close key: %v", err)
	}

	return certOut.Name(), keyOut.Name()
}
