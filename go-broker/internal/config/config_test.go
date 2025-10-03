package config

import (
	"os"
	"strings"
	"testing"
	"time"
)

func TestLoadDefaults(t *testing.T) {
	t.Setenv("BROKER_ADDR", "")
	t.Setenv("BROKER_ALLOWED_ORIGINS", "")
	t.Setenv("BROKER_MAX_PAYLOAD_BYTES", "")
	t.Setenv("BROKER_PING_INTERVAL", "")
	t.Setenv("BROKER_MAX_CLIENTS", "")
	t.Setenv("BROKER_GRPC_ADDR", "")
	t.Setenv("BROKER_TLS_CERT", "")
	t.Setenv("BROKER_TLS_KEY", "")
	t.Setenv("BROKER_LOG_LEVEL", "")
	t.Setenv("BROKER_LOG_PATH", "")
	t.Setenv("BROKER_LOG_MAX_SIZE_MB", "")
	t.Setenv("BROKER_LOG_MAX_BACKUPS", "")
	t.Setenv("BROKER_LOG_MAX_AGE_DAYS", "")
	t.Setenv("BROKER_LOG_COMPRESS", "")
	t.Setenv("BROKER_ADMIN_TOKEN", "")
	t.Setenv("BROKER_REPLAY_DUMP_WINDOW", "")
	t.Setenv("BROKER_REPLAY_DUMP_BURST", "")
	t.Setenv("BROKER_REPLAY_DIR", "")
	t.Setenv("BROKER_MATCH_SEED", "")
	t.Setenv("BROKER_TERRAIN_PARAMS", "")
	t.Setenv("BROKER_STATE_PATH", "")
	t.Setenv("BROKER_STATE_INTERVAL", "")
	t.Setenv("BROKER_WS_AUTH_MODE", "")
	t.Setenv("BROKER_WS_HMAC_SECRET", "")
	t.Setenv("BROKER_GRPC_AUTH_MODE", "")
	t.Setenv("BROKER_GRPC_SHARED_SECRET", "dev-secret")
	t.Setenv("BROKER_GRPC_TLS_CERT", "")
	t.Setenv("BROKER_GRPC_TLS_KEY", "")
	t.Setenv("BROKER_GRPC_CLIENT_CA", "")
	t.Setenv("BROKER_BOT_CONTROLLER_URL", "")
	t.Setenv("BROKER_BOT_TARGET", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() returned error: %v", err)
	}

	if cfg.Address != DefaultAddr {
		t.Fatalf("expected default addr %q, got %q", DefaultAddr, cfg.Address)
	}
	if cfg.GRPCAddress != DefaultGRPCAddr {
		t.Fatalf("expected default gRPC addr %q, got %q", DefaultGRPCAddr, cfg.GRPCAddress)
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
	if cfg.AdminToken != "" {
		t.Fatalf("expected admin token to be empty by default")
	}
	if cfg.ReplayDumpWindow != DefaultReplayDumpWindow {
		t.Fatalf("expected default replay dump window %v, got %v", DefaultReplayDumpWindow, cfg.ReplayDumpWindow)
	}
	if cfg.ReplayDumpBurst != DefaultReplayDumpBurst {
		t.Fatalf("expected default replay dump burst %d, got %d", DefaultReplayDumpBurst, cfg.ReplayDumpBurst)
	}
	if cfg.ReplayDirectory != "" {
		t.Fatalf("expected replay directory to default to empty string")
	}
	if cfg.MatchSeed != "" {
		t.Fatalf("expected match seed to default to empty string")
	}
	if cfg.TerrainParams != nil {
		t.Fatalf("expected terrain params to be nil by default")
	}
	if cfg.Logging.Level != DefaultLogLevel {
		t.Fatalf("expected default log level %q, got %q", DefaultLogLevel, cfg.Logging.Level)
	}
	if cfg.Logging.Path != DefaultLogPath {
		t.Fatalf("expected default log path %q, got %q", DefaultLogPath, cfg.Logging.Path)
	}
	if cfg.Logging.MaxSizeMB != DefaultLogMaxSizeMB {
		t.Fatalf("expected default log max size %d, got %d", DefaultLogMaxSizeMB, cfg.Logging.MaxSizeMB)
	}
	if cfg.Logging.MaxBackups != DefaultLogMaxBackups {
		t.Fatalf("expected default log max backups %d, got %d", DefaultLogMaxBackups, cfg.Logging.MaxBackups)
	}
	if cfg.Logging.MaxAgeDays != DefaultLogMaxAgeDays {
		t.Fatalf("expected default log max age %d, got %d", DefaultLogMaxAgeDays, cfg.Logging.MaxAgeDays)
	}
	if cfg.Logging.Compress != DefaultLogCompress {
		t.Fatalf("expected default log compress %t, got %t", DefaultLogCompress, cfg.Logging.Compress)
	}
	if cfg.StateSnapshotPath != "" {
		t.Fatalf("expected state snapshot path to be empty by default")
	}
	if cfg.StateSnapshotInterval != DefaultStateSnapshotInterval {
		t.Fatalf("expected default state snapshot interval %v, got %v", DefaultStateSnapshotInterval, cfg.StateSnapshotInterval)
	}
	if cfg.WSAuthMode != WSAuthModeDisabled {
		t.Fatalf("expected websocket auth mode disabled, got %q", cfg.WSAuthMode)
	}
	if cfg.GRPCAuthMode != GRPCAuthModeSharedSecret {
		t.Fatalf("expected grpc auth mode shared_secret, got %q", cfg.GRPCAuthMode)
	}
	if cfg.GRPCSharedSecret != "dev-secret" {
		t.Fatalf("expected propagated grpc shared secret, got %q", cfg.GRPCSharedSecret)
	}
	if cfg.BotControllerURL != "" {
		t.Fatalf("expected bot controller URL to be empty by default")
	}
	if cfg.BotTargetPopulation != 0 {
		t.Fatalf("expected bot target population default to zero, got %d", cfg.BotTargetPopulation)
	}
}

func TestLoadOverrides(t *testing.T) {
	t.Setenv("BROKER_ADDR", "127.0.0.1:9000")
	t.Setenv("BROKER_ALLOWED_ORIGINS", "https://example.com, https://demo.local")
	t.Setenv("BROKER_MAX_PAYLOAD_BYTES", "2048")
	t.Setenv("BROKER_PING_INTERVAL", "45s")
	t.Setenv("BROKER_MAX_CLIENTS", "12")
	t.Setenv("BROKER_GRPC_ADDR", "127.0.0.1:50051")
	t.Setenv("BROKER_TLS_CERT", "/tmp/cert.pem")
	t.Setenv("BROKER_TLS_KEY", "/tmp/key.pem")
	t.Setenv("BROKER_LOG_LEVEL", "debug")
	t.Setenv("BROKER_LOG_PATH", "/var/log/broker.log")
	t.Setenv("BROKER_LOG_MAX_SIZE_MB", "512")
	t.Setenv("BROKER_LOG_MAX_BACKUPS", "4")
	t.Setenv("BROKER_LOG_MAX_AGE_DAYS", "2")
	t.Setenv("BROKER_LOG_COMPRESS", "false")
	t.Setenv("BROKER_ADMIN_TOKEN", "s3cret")
	t.Setenv("BROKER_REPLAY_DUMP_WINDOW", "2m")
	t.Setenv("BROKER_REPLAY_DUMP_BURST", "3")
	t.Setenv("BROKER_REPLAY_DIR", "/var/run/replays")
	t.Setenv("BROKER_MATCH_SEED", "seed-42")
	t.Setenv("BROKER_TERRAIN_PARAMS", "{\"roughness\":0.7}")
	t.Setenv("BROKER_STATE_PATH", "/var/run/broker/state.json")
	t.Setenv("BROKER_STATE_INTERVAL", "15s")
	t.Setenv("BROKER_WS_AUTH_MODE", WSAuthModeHMAC)
	t.Setenv("BROKER_WS_HMAC_SECRET", "ws-secret")
	t.Setenv("BROKER_GRPC_AUTH_MODE", GRPCAuthModeMTLS)
	t.Setenv("BROKER_GRPC_SHARED_SECRET", "ignored")
	t.Setenv("BROKER_GRPC_TLS_CERT", "/tls/server.pem")
	t.Setenv("BROKER_GRPC_TLS_KEY", "/tls/server.key")
	t.Setenv("BROKER_GRPC_CLIENT_CA", "/tls/ca.pem")
	t.Setenv("BROKER_BOT_CONTROLLER_URL", "http://bots.local/scale")
	t.Setenv("BROKER_BOT_TARGET", "6")

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
	if cfg.GRPCAddress != "127.0.0.1:50051" {
		t.Fatalf("unexpected grpc address %q", cfg.GRPCAddress)
	}
	if cfg.TLSCertPath != "/tmp/cert.pem" || cfg.TLSKeyPath != "/tmp/key.pem" {
		t.Fatalf("unexpected TLS paths cert=%q key=%q", cfg.TLSCertPath, cfg.TLSKeyPath)
	}
	if cfg.Logging.Level != "debug" {
		t.Fatalf("expected overridden log level debug, got %q", cfg.Logging.Level)
	}
	if cfg.Logging.Path != "/var/log/broker.log" {
		t.Fatalf("unexpected log path %q", cfg.Logging.Path)
	}
	if cfg.Logging.MaxSizeMB != 512 {
		t.Fatalf("expected log max size 512, got %d", cfg.Logging.MaxSizeMB)
	}
	if cfg.Logging.MaxBackups != 4 {
		t.Fatalf("expected log max backups 4, got %d", cfg.Logging.MaxBackups)
	}
	if cfg.Logging.MaxAgeDays != 2 {
		t.Fatalf("expected log max age 2, got %d", cfg.Logging.MaxAgeDays)
	}
	if cfg.Logging.Compress {
		t.Fatalf("expected log compression disabled")
	}
	if cfg.BotControllerURL != "http://bots.local/scale" {
		t.Fatalf("unexpected bot controller URL %q", cfg.BotControllerURL)
	}
	if cfg.BotTargetPopulation != 6 {
		t.Fatalf("expected bot target population 6, got %d", cfg.BotTargetPopulation)
	}
	if cfg.AdminToken != "s3cret" {
		t.Fatalf("expected overridden admin token, got %q", cfg.AdminToken)
	}
	if cfg.ReplayDumpWindow != 2*time.Minute {
		t.Fatalf("expected replay dump window 2m, got %v", cfg.ReplayDumpWindow)
	}
	if cfg.ReplayDumpBurst != 3 {
		t.Fatalf("expected replay dump burst 3, got %d", cfg.ReplayDumpBurst)
	}
	if cfg.ReplayDirectory != "/var/run/replays" {
		t.Fatalf("expected replay directory override, got %q", cfg.ReplayDirectory)
	}
	if cfg.MatchSeed != "seed-42" {
		t.Fatalf("expected match seed override, got %q", cfg.MatchSeed)
	}
	if len(cfg.TerrainParams) != 1 || cfg.TerrainParams["roughness"] != 0.7 {
		t.Fatalf("unexpected terrain params: %#v", cfg.TerrainParams)
	}
	if cfg.StateSnapshotPath != "/var/run/broker/state.json" {
		t.Fatalf("unexpected state snapshot path %q", cfg.StateSnapshotPath)
	}
	if cfg.StateSnapshotInterval != 15*time.Second {
		t.Fatalf("expected state snapshot interval 15s, got %v", cfg.StateSnapshotInterval)
	}
	if cfg.WSAuthMode != WSAuthModeHMAC {
		t.Fatalf("expected websocket auth mode hmac, got %q", cfg.WSAuthMode)
	}
	if cfg.WSHMACSecret != "ws-secret" {
		t.Fatalf("expected websocket secret ws-secret, got %q", cfg.WSHMACSecret)
	}
	if cfg.GRPCAuthMode != GRPCAuthModeMTLS {
		t.Fatalf("expected grpc auth mode mtls, got %q", cfg.GRPCAuthMode)
	}
	if cfg.GRPCServerCertPath != "/tls/server.pem" || cfg.GRPCServerKeyPath != "/tls/server.key" {
		t.Fatalf("unexpected grpc server keypair cert=%q key=%q", cfg.GRPCServerCertPath, cfg.GRPCServerKeyPath)
	}
	if cfg.GRPCClientCAPath != "/tls/ca.pem" {
		t.Fatalf("unexpected grpc client ca %q", cfg.GRPCClientCAPath)
	}
}

func TestLoadReturnsValidationErrors(t *testing.T) {
	t.Setenv("BROKER_MAX_PAYLOAD_BYTES", "-5")
	t.Setenv("BROKER_PING_INTERVAL", "abc")
	t.Setenv("BROKER_MAX_CLIENTS", "-1")
	t.Setenv("BROKER_TLS_CERT", "/tmp/cert.pem")
	t.Setenv("BROKER_TLS_KEY", "")
	t.Setenv("BROKER_LOG_MAX_SIZE_MB", "-1")
	t.Setenv("BROKER_LOG_MAX_BACKUPS", "-2")
	t.Setenv("BROKER_LOG_MAX_AGE_DAYS", "-3")
	t.Setenv("BROKER_LOG_COMPRESS", "notabool")
	t.Setenv("BROKER_REPLAY_DUMP_WINDOW", "-")
	t.Setenv("BROKER_REPLAY_DUMP_BURST", "0")
	t.Setenv("BROKER_TERRAIN_PARAMS", "not-json")
	t.Setenv("BROKER_STATE_INTERVAL", "-1s")
	t.Setenv("BROKER_WS_AUTH_MODE", "invalid")
	t.Setenv("BROKER_GRPC_AUTH_MODE", "invalid")

	_, err := Load()
	if err == nil {
		t.Fatal("expected error from invalid configuration, got nil")
	}

	for _, want := range []string{
		"BROKER_MAX_PAYLOAD_BYTES",
		"BROKER_PING_INTERVAL",
		"BROKER_MAX_CLIENTS",
		"BROKER_TLS_CERT",
		"BROKER_LOG_MAX_SIZE_MB",
		"BROKER_LOG_MAX_BACKUPS",
		"BROKER_LOG_MAX_AGE_DAYS",
		"BROKER_LOG_COMPRESS",
		"BROKER_REPLAY_DUMP_WINDOW",
		"BROKER_REPLAY_DUMP_BURST",
		"BROKER_STATE_INTERVAL",
		"BROKER_WS_AUTH_MODE",
		"BROKER_GRPC_AUTH_MODE",
		"BROKER_TERRAIN_PARAMS",
	} {
		if !strings.Contains(err.Error(), want) {
			t.Fatalf("expected error to mention %s, got %q", want, err.Error())
		}
	}
}

func TestLoadIgnoresEmptyAllowedOrigins(t *testing.T) {
	t.Setenv("BROKER_GRPC_SHARED_SECRET", "dev-secret")
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
	t.Setenv("BROKER_GRPC_SHARED_SECRET", "dev-secret")
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
	t.Setenv("BROKER_GRPC_SHARED_SECRET", "dev-secret")
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
	t.Setenv("BROKER_GRPC_SHARED_SECRET", "dev-secret")
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
