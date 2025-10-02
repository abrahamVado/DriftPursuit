package httpapi

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"driftpursuit/broker/internal/logging"
	"driftpursuit/broker/internal/networking"
	"driftpursuit/broker/internal/replay"
)

// ReadinessProvider exposes broker state required for readiness checks.
type ReadinessProvider interface {
	SnapshotClientCounts() (clients, pending int)
	StartupError() error
	Uptime() time.Duration
}

// StatsFunc returns cumulative broadcast and client statistics.
type StatsFunc func() (broadcasts, clients int)

// ReplayDumper triggers a replay dump and optionally returns the artifact location.
type ReplayDumper interface {
	DumpReplay(ctx context.Context) (string, error)
}

// ReplayDumperFunc adapts a function into a ReplayDumper.
type ReplayDumperFunc func(ctx context.Context) (string, error)

// DumpReplay implements ReplayDumper.
func (f ReplayDumperFunc) DumpReplay(ctx context.Context) (string, error) { return f(ctx) }

// RateLimiter gates how frequently sensitive operations may be invoked.
type RateLimiter interface {
	Allow() bool
}

// Options configures the HandlerSet.
type Options struct {
	Logger      *logging.Logger
	Readiness   ReadinessProvider
	Stats       StatsFunc
	Snapshots   *networking.SnapshotMetrics
	Bandwidth   *networking.BandwidthRegulator
	Replay      ReplayDumper
	AdminToken  string
	RateLimiter RateLimiter
	TimeSource  func() time.Time
	ReplayStats func() replay.Stats
}

// HandlerSet bundles the broker operational handlers.
type HandlerSet struct {
	logger      *logging.Logger
	readiness   ReadinessProvider
	stats       StatsFunc
	snapshots   *networking.SnapshotMetrics
	bandwidth   *networking.BandwidthRegulator
	replay      ReplayDumper
	adminToken  string
	rateLimiter RateLimiter
	now         func() time.Time
	replayStats func() replay.Stats
}

// NewHandlerSet constructs a HandlerSet using the provided options.
func NewHandlerSet(opts Options) *HandlerSet {
	logger := opts.Logger
	if logger == nil {
		logger = logging.L()
	}
	now := opts.TimeSource
	if now == nil {
		now = time.Now
	}
	return &HandlerSet{
		logger:      logger,
		readiness:   opts.Readiness,
		stats:       opts.Stats,
		snapshots:   opts.Snapshots,
		bandwidth:   opts.Bandwidth,
		replay:      opts.Replay,
		adminToken:  strings.TrimSpace(opts.AdminToken),
		rateLimiter: opts.RateLimiter,
		now:         now,
		replayStats: opts.ReplayStats,
	}
}

// Register attaches all handlers to the provided mux.
func (h *HandlerSet) Register(mux *http.ServeMux) {
	if mux == nil {
		return
	}
	mux.HandleFunc("/livez", h.LivenessHandler())
	mux.HandleFunc("/readyz", h.ReadinessHandler())
	mux.HandleFunc("/metrics", h.MetricsHandler())
	mux.HandleFunc("/replay/dump", h.ReplayDumpHandler())
}

// LivenessHandler reports that the HTTP server is reachable.
func (h *HandlerSet) LivenessHandler() http.HandlerFunc {
	type response struct {
		Status    string `json:"status"`
		Timestamp string `json:"timestamp"`
	}
	return func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, response{
			Status:    "alive",
			Timestamp: h.now().UTC().Format(time.RFC3339Nano),
		})
	}
}

// ReadinessHandler reports broker readiness, including client counts and startup status.
func (h *HandlerSet) ReadinessHandler() http.HandlerFunc {
	type response struct {
		Status         string  `json:"status"`
		Message        string  `json:"message,omitempty"`
		UptimeSeconds  float64 `json:"uptime_seconds"`
		Clients        int     `json:"clients"`
		PendingClients int     `json:"pending_clients"`
	}
	return func(w http.ResponseWriter, r *http.Request) {
		status := http.StatusOK
		resp := response{Status: "ok"}
		if h.readiness != nil {
			clients, pending := h.readiness.SnapshotClientCounts()
			resp.Clients = clients
			resp.PendingClients = pending
			resp.UptimeSeconds = h.readiness.Uptime().Seconds()
			if err := h.readiness.StartupError(); err != nil {
				status = http.StatusServiceUnavailable
				resp.Status = "error"
				resp.Message = err.Error()
			}
		}
		writeJSON(w, status, resp)
	}
}

// MetricsHandler emits Prometheus compatible text metrics.
func (h *HandlerSet) MetricsHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		broadcasts, clients := h.metricsStats()
		pending, uptime := h.pendingAndUptime()

		w.Header().Set("Content-Type", "text/plain; version=0.0.4")
		fmt.Fprintf(w, "# HELP broker_uptime_seconds Broker uptime in seconds.\n")
		fmt.Fprintf(w, "# TYPE broker_uptime_seconds gauge\n")
		fmt.Fprintf(w, "broker_uptime_seconds %.0f\n", uptime)

		fmt.Fprintf(w, "# HELP broker_clients Current connected WebSocket clients.\n")
		fmt.Fprintf(w, "# TYPE broker_clients gauge\n")
		fmt.Fprintf(w, "broker_clients %d\n", clients)

		fmt.Fprintf(w, "# HELP broker_pending_clients Pending WebSocket handshakes awaiting upgrade.\n")
		fmt.Fprintf(w, "# TYPE broker_pending_clients gauge\n")
		fmt.Fprintf(w, "broker_pending_clients %d\n", pending)

		fmt.Fprintf(w, "# HELP broker_broadcasts_total Total broadcast payloads delivered.\n")
		fmt.Fprintf(w, "# TYPE broker_broadcasts_total counter\n")
		fmt.Fprintf(w, "broker_broadcasts_total %d\n", broadcasts)
		if h.snapshots != nil {
			bytes := h.snapshots.BytesPerClient()
			fmt.Fprintf(w, "# HELP broker_snapshot_bytes_per_client Last encoded world snapshot size per client in bytes.\n")
			fmt.Fprintf(w, "# TYPE broker_snapshot_bytes_per_client gauge\n")
			for clientID, size := range bytes {
				fmt.Fprintf(w, "broker_snapshot_bytes_per_client{client=%q} %d\n", clientID, size)
			}
			drops := h.snapshots.DropCounts()
			fmt.Fprintf(w, "# HELP broker_snapshot_dropped_entities_total Total dropped entities per interest tier due to budgeting.\n")
			fmt.Fprintf(w, "# TYPE broker_snapshot_dropped_entities_total counter\n")
			for tier, count := range drops {
				fmt.Fprintf(w, "broker_snapshot_dropped_entities_total{tier=%q} %d\n", tier.String(), count)
			}
		}
		if h.bandwidth != nil {
			usage := h.bandwidth.SnapshotUsage()
			if len(usage) > 0 {
				fmt.Fprintf(w, "# HELP broker_bandwidth_bytes_per_second Observed outbound bandwidth per client in bytes per second.\n")
				fmt.Fprintf(w, "# TYPE broker_bandwidth_bytes_per_second gauge\n")
				for clientID, sample := range usage {
					fmt.Fprintf(w, "broker_bandwidth_bytes_per_second{client=%q} %.2f\n", clientID, sample.BytesPerSecond)
				}
				fmt.Fprintf(w, "# HELP broker_bandwidth_available_bytes Remaining bandwidth tokens per client.\n")
				fmt.Fprintf(w, "# TYPE broker_bandwidth_available_bytes gauge\n")
				for clientID, sample := range usage {
					fmt.Fprintf(w, "broker_bandwidth_available_bytes{client=%q} %.2f\n", clientID, sample.AvailableBytes)
				}
				fmt.Fprintf(w, "# HELP broker_bandwidth_denied_total Total throttled deliveries per client.\n")
				fmt.Fprintf(w, "# TYPE broker_bandwidth_denied_total counter\n")
				for clientID, sample := range usage {
					fmt.Fprintf(w, "broker_bandwidth_denied_total{client=%q} %d\n", clientID, sample.DeniedDeliveries)
				}
			}
		}
		if h.replayStats != nil {
			stats := h.replayStats()
			fmt.Fprintf(w, "# HELP broker_replay_buffer_frames Buffered replay frames awaiting flush.\n")
			fmt.Fprintf(w, "# TYPE broker_replay_buffer_frames gauge\n")
			fmt.Fprintf(w, "broker_replay_buffer_frames %d\n", stats.BufferedFrames)
			fmt.Fprintf(w, "# HELP broker_replay_buffer_bytes Buffered replay payload size in bytes.\n")
			fmt.Fprintf(w, "# TYPE broker_replay_buffer_bytes gauge\n")
			fmt.Fprintf(w, "broker_replay_buffer_bytes %d\n", stats.BufferedBytes)
			fmt.Fprintf(w, "# HELP broker_replay_dumps_total Replay dumps completed successfully.\n")
			fmt.Fprintf(w, "# TYPE broker_replay_dumps_total counter\n")
			fmt.Fprintf(w, "broker_replay_dumps_total %d\n", stats.Dumps)
		}
	}
}

// ReplayDumpHandler authorises and triggers replay dump creation.
func (h *HandlerSet) ReplayDumpHandler() http.HandlerFunc {
	type response struct {
		Status   string `json:"status"`
		Location string `json:"location,omitempty"`
	}
	return func(w http.ResponseWriter, r *http.Request) {
		reqLogger := h.logger.With(
			logging.String("handler", "replay_dump"),
			logging.String("remote_addr", r.RemoteAddr),
		)
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if h.adminToken == "" {
			reqLogger.Warn("replay dump denied: admin auth disabled")
			http.Error(w, "admin authentication not configured", http.StatusForbidden)
			return
		}
		if !h.authorise(r) {
			reqLogger.Warn("replay dump denied: unauthorized request")
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		if h.rateLimiter != nil && !h.rateLimiter.Allow() {
			reqLogger.Warn("replay dump denied: rate limit exceeded")
			http.Error(w, "too many requests", http.StatusTooManyRequests)
			return
		}
		if h.replay == nil {
			reqLogger.Warn("replay dump denied: no dumper configured")
			http.Error(w, "replay dumping is unavailable", http.StatusServiceUnavailable)
			return
		}
		location, err := h.replay.DumpReplay(r.Context())
		if err != nil {
			reqLogger.Error("replay dump trigger failed", logging.Error(err))
			http.Error(w, "failed to trigger replay dump", http.StatusInternalServerError)
			return
		}
		reqLogger.Info("replay dump triggered")
		writeJSON(w, http.StatusAccepted, response{Status: "accepted", Location: location})
	}
}

func (h *HandlerSet) metricsStats() (broadcasts, clients int) {
	if h.stats != nil {
		return h.stats()
	}
	if h.readiness != nil {
		clients, _ = h.readiness.SnapshotClientCounts()
	}
	return
}

func (h *HandlerSet) pendingAndUptime() (pending int, uptime float64) {
	if h.readiness == nil {
		return 0, 0
	}
	_, pending = h.readiness.SnapshotClientCounts()
	return pending, h.readiness.Uptime().Seconds()
}

func (h *HandlerSet) authorise(r *http.Request) bool {
	header := strings.TrimSpace(r.Header.Get("Authorization"))
	var token string
	if len(header) > 7 && strings.EqualFold(header[:7], "Bearer ") {
		token = strings.TrimSpace(header[7:])
	} else if header != "" {
		token = header
	}
	if token == "" {
		token = strings.TrimSpace(r.Header.Get("X-Admin-Token"))
	}
	if token == "" {
		token = strings.TrimSpace(r.URL.Query().Get("token"))
	}
	if token == "" {
		return false
	}
	if subtle.ConstantTimeCompare([]byte(token), []byte(h.adminToken)) == 1 {
		return true
	}
	return false
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	if status != http.StatusOK {
		w.WriteHeader(status)
	}
	_ = json.NewEncoder(w).Encode(payload)
}
