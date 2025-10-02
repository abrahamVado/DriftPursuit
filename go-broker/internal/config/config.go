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

	// DefaultReplayDumpWindow bounds how frequently replay dump triggers may be requested.
	DefaultReplayDumpWindow = time.Minute
	// DefaultReplayDumpBurst sets how many replay dump requests may be made per window.
	DefaultReplayDumpBurst = 1

	// DefaultLogLevel controls verbosity for broker logs.
	DefaultLogLevel = "info"
	// DefaultLogPath is where structured logs are written.
	DefaultLogPath = "broker.log"
	// DefaultLogMaxSizeMB caps the size of a single log file before rotation.
	DefaultLogMaxSizeMB = 100
	// DefaultLogMaxBackups limits retained rotated log files.
	DefaultLogMaxBackups = 10
	// DefaultLogMaxAgeDays controls how long rotated log files are kept on disk.
	DefaultLogMaxAgeDays = 7
	// DefaultLogCompress toggles gzip compression for rotated log files.
	DefaultLogCompress = true

	// DefaultStateSnapshotInterval controls how frequently state snapshots are persisted.
	DefaultStateSnapshotInterval = 30 * time.Second
)

// Config captures all runtime tunables for the broker service.
type Config struct {
	Address               string
	AllowedOrigins        []string
	MaxPayloadBytes       int64
	PingInterval          time.Duration
	MaxClients            int
	TLSCertPath           string
	TLSKeyPath            string
	AdminToken            string
	ReplayDumpWindow      time.Duration
	ReplayDumpBurst       int
	Logging               LoggingConfig
	StateSnapshotPath     string
	StateSnapshotInterval time.Duration
}

// LoggingConfig captures structured logging configuration options.
type LoggingConfig struct {
	Level      string
	Path       string
	MaxSizeMB  int
	MaxBackups int
	MaxAgeDays int
	Compress   bool
}

// Load reads the broker configuration from environment variables, applying sane defaults
// and returning descriptive errors for invalid overrides.
func Load() (*Config, error) {
	cfg := &Config{
		Address:          getString("BROKER_ADDR", DefaultAddr),
		AllowedOrigins:   parseList(os.Getenv("BROKER_ALLOWED_ORIGINS")),
		MaxPayloadBytes:  DefaultMaxPayloadBytes,
		PingInterval:     DefaultPingInterval,
		MaxClients:       DefaultMaxClients,
		TLSCertPath:      strings.TrimSpace(os.Getenv("BROKER_TLS_CERT")),
		TLSKeyPath:       strings.TrimSpace(os.Getenv("BROKER_TLS_KEY")),
		AdminToken:       strings.TrimSpace(os.Getenv("BROKER_ADMIN_TOKEN")),
		ReplayDumpWindow: DefaultReplayDumpWindow,
		ReplayDumpBurst:  DefaultReplayDumpBurst,
		Logging: LoggingConfig{
			Level:      strings.TrimSpace(getString("BROKER_LOG_LEVEL", DefaultLogLevel)),
			Path:       strings.TrimSpace(getString("BROKER_LOG_PATH", DefaultLogPath)),
			MaxSizeMB:  DefaultLogMaxSizeMB,
			MaxBackups: DefaultLogMaxBackups,
			MaxAgeDays: DefaultLogMaxAgeDays,
			Compress:   DefaultLogCompress,
		},
		StateSnapshotPath:     strings.TrimSpace(os.Getenv("BROKER_STATE_PATH")),
		StateSnapshotInterval: DefaultStateSnapshotInterval,
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

	if raw := strings.TrimSpace(os.Getenv("BROKER_LOG_MAX_SIZE_MB")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value <= 0 {
			problems = append(problems, fmt.Sprintf("BROKER_LOG_MAX_SIZE_MB must be a positive integer, got %q", raw))
		} else {
			cfg.Logging.MaxSizeMB = value
		}
	}

	if raw := strings.TrimSpace(os.Getenv("BROKER_LOG_MAX_BACKUPS")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 0 {
			problems = append(problems, fmt.Sprintf("BROKER_LOG_MAX_BACKUPS must be a non-negative integer, got %q", raw))
		} else {
			cfg.Logging.MaxBackups = value
		}
	}

	if raw := strings.TrimSpace(os.Getenv("BROKER_LOG_MAX_AGE_DAYS")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 0 {
			problems = append(problems, fmt.Sprintf("BROKER_LOG_MAX_AGE_DAYS must be a non-negative integer, got %q", raw))
		} else {
			cfg.Logging.MaxAgeDays = value
		}
	}

	if raw := strings.TrimSpace(os.Getenv("BROKER_LOG_COMPRESS")); raw != "" {
		value, err := strconv.ParseBool(raw)
		if err != nil {
			problems = append(problems, fmt.Sprintf("BROKER_LOG_COMPRESS must be a boolean value, got %q", raw))
		} else {
			cfg.Logging.Compress = value
		}
	}

	if raw := strings.TrimSpace(os.Getenv("BROKER_REPLAY_DUMP_WINDOW")); raw != "" {
		duration, err := time.ParseDuration(raw)
		if err != nil || duration <= 0 {
			problems = append(problems, fmt.Sprintf("BROKER_REPLAY_DUMP_WINDOW must be a positive duration, got %q", raw))
		} else {
			cfg.ReplayDumpWindow = duration
		}
	}

	if raw := strings.TrimSpace(os.Getenv("BROKER_REPLAY_DUMP_BURST")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value <= 0 {
			problems = append(problems, fmt.Sprintf("BROKER_REPLAY_DUMP_BURST must be a positive integer, got %q", raw))
		} else {
			cfg.ReplayDumpBurst = value
		}
	}

	if raw := strings.TrimSpace(os.Getenv("BROKER_STATE_INTERVAL")); raw != "" {
		duration, err := time.ParseDuration(raw)
		if err != nil || duration <= 0 {
			problems = append(problems, fmt.Sprintf("BROKER_STATE_INTERVAL must be a positive duration, got %q", raw))
		} else {
			cfg.StateSnapshotInterval = duration
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
