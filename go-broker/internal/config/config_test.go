package config

import (
	"os"
	"strings"
	"testing"
)

func TestLoadDefaults(t *testing.T) {
	t.Setenv("BROKER_ADDR", "")
	t.Setenv("BROKER_ALLOWED_ORIGINS", "")
	t.Setenv("BROKER_MAX_PAYLOAD_BYTES", "")
	t.Setenv("BROKER_PING_INTERVAL", "")
	t.Setenv("BROKER_MAX_CLIENTS", "")
	t.Setenv("BROKER_TLS_CERT", "")
	t.Setenv("BROKER_TLS_KEY", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() returned error: %v", err)
	}

	if cfg.Address != DefaultAddr {
		t.Fatalf("expected default addr %q, got %q", DefaultAddr, cfg.Address)
	}
	if cfg.AllowedOrigins != nil {
		t.Fatalf("expected no allowed origins, got %#v", cfg.AllowedOrigins)
	}
	if cfg.MaxPayloadBytes != DefaultMaxPayloadBytes {
		t.Fatalf("expected default max payload %d, got %d", DefaultMaxPayloadBytes, cfg.MaxPayloadBytes)
	}
	if cfg.PingInterval != DefaultPingInterval {
		t.Fatalf("expected default ping interval %v, got %v", DefaultPingInterval, cfg.PingInterval)
	}
	if cfg.MaxClients != DefaultMaxClients {
		t.Fatalf("expected default max clients %d, got %d", DefaultMaxClients, cfg.MaxClients)
	}
	if cfg.TLSCertPath != "" || cfg.TLSKeyPath != "" {
		t.Fatalf("expected TLS paths to be empty, got cert=%q key=%q", cfg.TLSCertPath, cfg.TLSKeyPath)
	}
}

func TestLoadOverrides(t *testing.T) {
	t.Setenv("BROKER_ADDR", "127.0.0.1:9000")
	t.Setenv("BROKER_ALLOWED_ORIGINS", "https://example.com, https://demo.local")
	t.Setenv("BROKER_MAX_PAYLOAD_BYTES", "2048")
	t.Setenv("BROKER_PING_INTERVAL", "45s")
	t.Setenv("BROKER_MAX_CLIENTS", "12")
	t.Setenv("BROKER_TLS_CERT", "/tmp/cert.pem")
	t.Setenv("BROKER_TLS_KEY", "/tmp/key.pem")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() returned error: %v", err)
	}

	if cfg.Address != "127.0.0.1:9000" {
		t.Fatalf("unexpected address: %q", cfg.Address)
	}
	if len(cfg.AllowedOrigins) != 2 || cfg.AllowedOrigins[0] != "https://example.com" || cfg.AllowedOrigins[1] != "https://demo.local" {
		t.Fatalf("unexpected allowed origins: %#v", cfg.AllowedOrigins)
	}
	if cfg.MaxPayloadBytes != 2048 {
		t.Fatalf("expected overridden max payload, got %d", cfg.MaxPayloadBytes)
	}
	if cfg.PingInterval.String() != "45s" {
		t.Fatalf("expected ping interval 45s, got %v", cfg.PingInterval)
	}
	if cfg.MaxClients != 12 {
		t.Fatalf("expected max clients 12, got %d", cfg.MaxClients)
	}
	if cfg.TLSCertPath != "/tmp/cert.pem" || cfg.TLSKeyPath != "/tmp/key.pem" {
		t.Fatalf("unexpected TLS paths cert=%q key=%q", cfg.TLSCertPath, cfg.TLSKeyPath)
	}
}

func TestLoadReturnsValidationErrors(t *testing.T) {
	t.Setenv("BROKER_MAX_PAYLOAD_BYTES", "-5")
	t.Setenv("BROKER_PING_INTERVAL", "abc")
	t.Setenv("BROKER_MAX_CLIENTS", "-1")
	t.Setenv("BROKER_TLS_CERT", "/tmp/cert.pem")
	t.Setenv("BROKER_TLS_KEY", "")

	_, err := Load()
	if err == nil {
		t.Fatal("expected error from invalid configuration, got nil")
	}

	for _, want := range []string{
		"BROKER_MAX_PAYLOAD_BYTES",
		"BROKER_PING_INTERVAL",
		"BROKER_MAX_CLIENTS",
		"BROKER_TLS_CERT",
	} {
		if !strings.Contains(err.Error(), want) {
			t.Fatalf("expected error to mention %s, got %q", want, err.Error())
		}
	}
}

func TestLoadIgnoresEmptyAllowedOrigins(t *testing.T) {
	t.Setenv("BROKER_ALLOWED_ORIGINS", " , ,https://ok.example, ")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() returned error: %v", err)
	}

	if len(cfg.AllowedOrigins) != 1 || cfg.AllowedOrigins[0] != "https://ok.example" {
		t.Fatalf("expected single cleaned origin, got %#v", cfg.AllowedOrigins)
	}
}

func TestLoadReturnsErrorWhenEnvUnsetAfterOverride(t *testing.T) {
	t.Setenv("BROKER_MAX_PAYLOAD_BYTES", "1024")
	t.Setenv("BROKER_TLS_CERT", "")
	t.Setenv("BROKER_TLS_KEY", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() returned error: %v", err)
	}

	if cfg.MaxPayloadBytes != 1024 {
		t.Fatalf("expected overridden payload value, got %d", cfg.MaxPayloadBytes)
	}
}

func TestLoadAllowsUnlimitedClients(t *testing.T) {
	t.Setenv("BROKER_MAX_CLIENTS", "0")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() returned error: %v", err)
	}

	if cfg.MaxClients != 0 {
		t.Fatalf("expected zero to disable limit, got %d", cfg.MaxClients)
	}
}

func TestLoadWithCustomTLSPair(t *testing.T) {
	certFile := createTempFile(t)
	keyFile := createTempFile(t)

	t.Setenv("BROKER_TLS_CERT", certFile)
	t.Setenv("BROKER_TLS_KEY", keyFile)

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() returned error: %v", err)
	}
	if cfg.TLSCertPath != certFile || cfg.TLSKeyPath != keyFile {
		t.Fatalf("unexpected TLS pair cert=%q key=%q", cfg.TLSCertPath, cfg.TLSKeyPath)
	}
}

func createTempFile(t *testing.T) string {
	t.Helper()
	f, err := os.CreateTemp("", "broker-config-test-*")
	if err != nil {
		t.Fatalf("CreateTemp: %v", err)
	}
	name := f.Name()
	f.Close()
	t.Cleanup(func() { _ = os.Remove(name) })
	return name
}
