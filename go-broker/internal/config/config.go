package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

const (
	// DefaultAddr is the default TCP address the broker listens on.
	DefaultAddr = ":43127"
	// DefaultPingInterval controls the keepalive cadence for WebSocket connections.
	DefaultPingInterval = 30 * time.Second
	// DefaultMaxPayloadBytes limits inbound WebSocket frame size.
	DefaultMaxPayloadBytes int64 = 1 << 20
	// DefaultMaxClients bounds concurrent WebSocket connections. Zero disables the limit.
	DefaultMaxClients = 256
)

// Config captures all runtime tunables for the broker service.
type Config struct {
	Address         string
	AllowedOrigins  []string
	MaxPayloadBytes int64
	PingInterval    time.Duration
	MaxClients      int
	TLSCertPath     string
	TLSKeyPath      string
}

// Load reads the broker configuration from environment variables, applying sane defaults
// and returning descriptive errors for invalid overrides.
func Load() (*Config, error) {
	cfg := &Config{
		Address:         getString("BROKER_ADDR", DefaultAddr),
		AllowedOrigins:  parseList(os.Getenv("BROKER_ALLOWED_ORIGINS")),
		MaxPayloadBytes: DefaultMaxPayloadBytes,
		PingInterval:    DefaultPingInterval,
		MaxClients:      DefaultMaxClients,
		TLSCertPath:     strings.TrimSpace(os.Getenv("BROKER_TLS_CERT")),
		TLSKeyPath:      strings.TrimSpace(os.Getenv("BROKER_TLS_KEY")),
	}

	var problems []string

	if raw := strings.TrimSpace(os.Getenv("BROKER_MAX_PAYLOAD_BYTES")); raw != "" {
		value, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || value <= 0 {
			problems = append(problems, fmt.Sprintf("BROKER_MAX_PAYLOAD_BYTES must be a positive integer, got %q", raw))
		} else {
			cfg.MaxPayloadBytes = value
		}
	}

	if raw := strings.TrimSpace(os.Getenv("BROKER_PING_INTERVAL")); raw != "" {
		duration, err := time.ParseDuration(raw)
		if err != nil || duration <= 0 {
			problems = append(problems, fmt.Sprintf("BROKER_PING_INTERVAL must be a positive duration, got %q", raw))
		} else {
			cfg.PingInterval = duration
		}
	}

	if raw := strings.TrimSpace(os.Getenv("BROKER_MAX_CLIENTS")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 0 {
			problems = append(problems, fmt.Sprintf("BROKER_MAX_CLIENTS must be a non-negative integer, got %q", raw))
		} else {
			cfg.MaxClients = value
		}
	}

	if (cfg.TLSCertPath == "") != (cfg.TLSKeyPath == "") {
		problems = append(problems, "BROKER_TLS_CERT and BROKER_TLS_KEY must be provided together")
	}

	if len(problems) > 0 {
		return nil, fmt.Errorf(strings.Join(problems, "; "))
	}

	return cfg, nil
}

func getString(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func parseList(raw string) []string {
	if raw == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	values := make([]string, 0, len(parts))
	for _, part := range parts {
		if item := strings.TrimSpace(part); item != "" {
			values = append(values, item)
		}
	}
	return values
}
