package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	configpkg "driftpursuit/broker/internal/config"
	httpapi "driftpursuit/broker/internal/http"
	"driftpursuit/broker/internal/logging"
	"github.com/gorilla/websocket"
)

// Will be configured in main() after parsing flags/env.
var upgrader = websocket.Upgrader{}

const (
	writeWait          = 10 * time.Second // write deadline for outgoing frames
	pongWaitMultiplier = 2                // read deadline = pingInterval * multiplier
)

var pingInterval = configpkg.DefaultPingInterval

// Always allow localhost for dev convenience.
var localHosts = map[string]struct{}{
	"127.0.0.1": {},
	"localhost": {},
	"::1":       {},
}

type Client struct {
	conn *websocket.Conn
	send chan []byte
	id   string
	log  *logging.Logger
}

type Broker struct {
	clients         map[*Client]bool
	lock            sync.RWMutex
	stats           BrokerStats
	maxPayloadBytes int64

	// capacity limiting
	maxClients     int
	pendingClients int

	stateMu    sync.RWMutex
	startedAt  time.Time
	startupErr error
	log        *logging.Logger
}

func NewBroker(maxPayloadBytes int64, maxClients int, startedAt time.Time, logger *logging.Logger) *Broker {
	if maxPayloadBytes <= 0 {
		maxPayloadBytes = configpkg.DefaultMaxPayloadBytes
	}
	if logger == nil {
		logger = logging.L()
	}
	return &Broker{
		clients:         make(map[*Client]bool),
		maxPayloadBytes: maxPayloadBytes,
		maxClients:      maxClients,
		startedAt:       startedAt,
		log:             logger,
	}
}

type BrokerStats struct {
	Broadcasts int `json:"broadcasts"`
	Clients    int `json:"clients"`
}

type statsProvider interface {
	Stats() BrokerStats
}

func (b *Broker) deregisterClient(client *Client) {
	b.lock.Lock()
	if _, exists := b.clients[client]; exists {
		delete(b.clients, client)
		close(client.send)
		if b.stats.Clients > 0 {
			b.stats.Clients--
		}
	}
	b.lock.Unlock()
}

func (b *Broker) broadcast(msg []byte) {
	b.lock.Lock()
	b.stats.Broadcasts++
	defer b.lock.Unlock()
	for c := range b.clients {
		select {
		case c.send <- msg:
		default:
			close(c.send)
			delete(b.clients, c)
			if b.stats.Clients > 0 {
				b.stats.Clients--
			}
		}
	}
}

func (b *Broker) Stats() BrokerStats {
	b.lock.RLock()
	defer b.lock.RUnlock()
	return b.stats
}

func (b *Broker) snapshotClientCounts() (clients, pending int) {
	b.lock.RLock()
	defer b.lock.RUnlock()
	return b.stats.Clients, b.pendingClients
}

// SnapshotClientCounts returns the current number of connected and pending clients.
func (b *Broker) SnapshotClientCounts() (clients, pending int) {
	return b.snapshotClientCounts()
}

func (b *Broker) setStartupError(err error) {
	b.stateMu.Lock()
	b.startupErr = err
	b.stateMu.Unlock()
}

func (b *Broker) startupError() error {
	b.stateMu.RLock()
	defer b.stateMu.RUnlock()
	return b.startupErr
}

// StartupError exposes any startup failure encountered by the broker.
func (b *Broker) StartupError() error {
	return b.startupError()
}

func (b *Broker) uptime() time.Duration {
	b.stateMu.RLock()
	started := b.startedAt
	b.stateMu.RUnlock()
	if started.IsZero() {
		return 0
	}
	return time.Since(started)
}

// Uptime reports the broker uptime.
func (b *Broker) Uptime() time.Duration {
	return b.uptime()
}

// --- Origin allowlist helpers ---

func parseAllowedOrigins(raw string) []string {
	parts := strings.Split(raw, ",")
	origins := make([]string, 0, len(parts))
	for _, part := range parts {
		origin := strings.TrimSpace(part)
		if origin == "" {
			continue
		}
		origins = append(origins, origin)
	}
	return origins
}

func buildOriginChecker(logger *logging.Logger, allowlist []string) func(*http.Request) bool {
	if logger == nil {
		logger = logging.L()
	}
	allowed := make(map[string]struct{}, len(allowlist))
	for _, origin := range allowlist {
		u, err := url.Parse(origin)
		if err != nil || u.Scheme == "" || u.Host == "" {
			logger.Warn("ignoring invalid allowed origin", logging.String("origin", origin), logging.Error(err))
			continue
		}
		key := strings.ToLower(u.Scheme + "://" + u.Host)
		allowed[key] = struct{}{}
	}

	return func(r *http.Request) bool {
		originHeader := r.Header.Get("Origin")
		if originHeader == "" {
			// No Origin usually means non-browser client; reject by default.
			return false
		}

		originURL, err := url.Parse(originHeader)
		if err != nil || originURL.Host == "" {
			logger.Warn("rejecting request with invalid origin", logging.String("origin", originHeader), logging.Error(err))
			return false
		}

		// Always allow localhost for dev workflows.
		if _, ok := localHosts[originURL.Hostname()]; ok {
			return true
		}

		key := strings.ToLower(originURL.Scheme + "://" + originURL.Host)
		if _, ok := allowed[key]; ok {
			return true
		}

		logger.Warn("rejecting request from disallowed origin", logging.String("origin", originHeader))
		return false
	}
}

// --- WS handler ---

type inboundEnvelope struct {
	Type string `json:"type"`
	ID   string `json:"id"`
}

func (b *Broker) serveWS(w http.ResponseWriter, r *http.Request) {
	ctx, baseLogger, _ := logging.WithTrace(r.Context(), logging.LoggerFromContext(r.Context()), logging.TraceIDFromContext(r.Context()))
	reqLogger := baseLogger.With(logging.String("remote_addr", r.RemoteAddr))
	ctx = logging.ContextWithLogger(ctx, reqLogger)
	r = r.WithContext(ctx)

	// Capacity pre-check
	if b.maxClients > 0 {
		b.lock.Lock()
		if len(b.clients)+b.pendingClients >= b.maxClients {
			b.lock.Unlock()
			reqLogger.Warn("refusing websocket connection: client limit reached", logging.Int("max_clients", b.maxClients))
			http.Error(w, "service unavailable: client limit reached", http.StatusServiceUnavailable)
			return
		}
		b.pendingClients++
		b.lock.Unlock()
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		if b.maxClients > 0 {
			b.lock.Lock()
			if b.pendingClients > 0 {
				b.pendingClients--
			}
			b.lock.Unlock()
		}
		reqLogger.Error("websocket upgrade failed", logging.Error(err))
		return
	}
	client := &Client{conn: conn, send: make(chan []byte, 256), id: r.RemoteAddr}
	client.log = reqLogger.With(logging.String("client_id", client.id))

	// Enforce payload limit (read side)
	if b.maxPayloadBytes > 0 {
		client.conn.SetReadLimit(b.maxPayloadBytes)
	}

	// Keepalive: read deadline & pong handler
	waitDuration := time.Duration(pongWaitMultiplier) * pingInterval
	if err := client.conn.SetReadDeadline(time.Now().Add(waitDuration)); err != nil {
		client.log.Error("failed to set initial read deadline", logging.Error(err))
		_ = client.conn.Close()
		return
	}
	client.conn.SetPongHandler(func(string) error {
		return client.conn.SetReadDeadline(time.Now().Add(waitDuration))
	})

	b.lock.Lock()
	if b.maxClients > 0 && b.pendingClients > 0 {
		b.pendingClients--
	}
	b.clients[client] = true
	b.stats.Clients++
	b.lock.Unlock()

	// reader
	go func() {
		defer func() {
			b.deregisterClient(client)
			_ = client.conn.Close()
		}()
		for {
			messageType, msg, err := client.conn.ReadMessage()
			if err != nil {
				// Better logging on exits
				if ne, ok := err.(net.Error); ok && ne.Timeout() {
					client.log.Warn("read deadline exceeded", logging.Error(err))
				} else if websocket.IsCloseError(err, websocket.CloseMessageTooBig) || errors.Is(err, websocket.ErrReadLimit) {
					client.log.Warn("closing connection due to oversized payload", logging.Error(err))
				} else if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure) {
					client.log.Warn("unexpected websocket close", logging.Error(err))
				} else {
					client.log.Error("read error", logging.Error(err))
				}
				break
			}

			// Extend read deadline after every frame
			if err := client.conn.SetReadDeadline(time.Now().Add(waitDuration)); err != nil {
				client.log.Error("failed to extend read deadline", logging.Error(err))
				break
			}

			if messageType != websocket.TextMessage {
				client.log.Debug("dropping non-text message")
				continue
			}

			// Ensure inbound payload is JSON
			var envelope inboundEnvelope
			if err := json.Unmarshal(msg, &envelope); err != nil {
				client.log.Debug("dropping invalid JSON message", logging.Error(err))
				continue
			}
			if envelope.Type == "" || envelope.ID == "" {
				client.log.Debug("dropping message with missing type or id")
				continue
			}

			b.broadcast(msg)
		}
	}()

	// writer (handles errors + periodic ping)
	go func() {
		ticker := time.NewTicker(pingInterval)
		defer func() {
			ticker.Stop()
			_ = client.conn.Close()
		}()
		for {
			select {
			case msg, ok := <-client.send:
				if !ok {
					_ = client.conn.WriteMessage(websocket.CloseMessage, []byte{})
					return
				}
				if err := client.conn.SetWriteDeadline(time.Now().Add(writeWait)); err != nil {
					client.log.Error("failed to set write deadline", logging.Error(err))
					b.deregisterClient(client)
					return
				}
				if err := client.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
					client.log.Error("write error", logging.Error(err))
					b.deregisterClient(client)
					return
				}
			case <-ticker.C:
				// Send ping periodically; pong handler extends read deadline
				if err := client.conn.WriteControl(websocket.PingMessage, []byte{}, time.Now().Add(writeWait)); err != nil {
					client.log.Warn("ping failure", logging.Error(err))
					b.deregisterClient(client)
					return
				}
			}
		}
	}()
}
func statsHandler(provider statsProvider) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		logger := logging.LoggerFromContext(r.Context()).With(logging.String("handler", "stats"))
		stats := provider.Stats()
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(stats); err != nil {
			logger.Error("encode stats response failed", logging.Error(err))
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}
	}
}

func healthzHandler(b *Broker) http.HandlerFunc {
	type response struct {
		Status         string  `json:"status"`
		UptimeSeconds  float64 `json:"uptime_seconds"`
		Clients        int     `json:"clients"`
		PendingClients int     `json:"pending_clients"`
	}

	return func(w http.ResponseWriter, r *http.Request) {
		logger := logging.LoggerFromContext(r.Context()).With(logging.String("handler", "healthz"))
		clients, pending := b.snapshotClientCounts()
		uptime := b.uptime().Seconds()
		status := "ok"
		code := http.StatusOK
		if err := b.startupError(); err != nil {
			status = "error"
			code = http.StatusServiceUnavailable
		}

		w.Header().Set("Content-Type", "application/json")
		if code != http.StatusOK {
			w.WriteHeader(code)
		}
		resp := response{
			Status:         status,
			UptimeSeconds:  uptime,
			Clients:        clients,
			PendingClients: pending,
		}
		if err := json.NewEncoder(w).Encode(resp); err != nil {
			logger.Error("encode healthz response failed", logging.Error(err))
		}
	}
}

// --- main / static viewer resolution ---

func main() {
	startedAt := time.Now()

	cfg, err := configpkg.Load()
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to load configuration: %v\n", err)
		os.Exit(1)
	}

	logger, err := logging.New(cfg.Logging)
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to initialize structured logger: %v\n", err)
		os.Exit(1)
	}
	defer func() {
		_ = logger.Sync()
	}()

	// ping interval
	pingInterval = cfg.PingInterval

	// origin policy
	allowlist := cfg.AllowedOrigins
	originLogger := logger.With(logging.String("component", "origin-check"))
	upgrader.CheckOrigin = buildOriginChecker(originLogger, allowlist)
	if len(allowlist) > 0 {
		logger.Info("allowing WebSocket origins", logging.Strings("origins", allowlist))
	} else {
		logger.Info("no allowed origins configured; permitting only local development origins")
	}

	// payload policy
	maxPayloadBytes := cfg.MaxPayloadBytes
	if maxPayloadBytes <= 0 {
		logger.Warn("invalid max payload provided; using default", logging.Int64("configured_bytes", maxPayloadBytes), logging.Int64("default_bytes", configpkg.DefaultMaxPayloadBytes))
		maxPayloadBytes = configpkg.DefaultMaxPayloadBytes
	}
	logger.Info("maximum WebSocket payload configured", logging.Int64("bytes", maxPayloadBytes))

	// capacity policy
	maxClients := cfg.MaxClients
	if maxClients > 0 {
		logger.Info("limiting WebSocket clients", logging.Int("max_clients", maxClients))
	} else {
		logger.Info("no limit configured for WebSocket clients")
	}

	// TLS config sanity
	certProvided := cfg.TLSCertPath != ""

	broker := NewBroker(maxPayloadBytes, maxClients, startedAt, logger)

	// build handler with consistent mux
	handler := buildHandler(broker, cfg)

	server := &http.Server{Addr: cfg.Address, Handler: handler}

	logger.Info("broker listening", logging.String("address", cfg.Address), logging.Bool("tls", certProvided))

	if certProvided {
		if err := server.ListenAndServeTLS(cfg.TLSCertPath, cfg.TLSKeyPath); err != nil {
			logger.Fatal("broker server terminated", logging.Error(err))
		}
		return
	}

	if err := server.ListenAndServe(); err != nil {
		logger.Fatal("broker server terminated", logging.Error(err))
	}
}

func buildHandler(b *Broker, cfg *configpkg.Config) http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("/ws", b.serveWS)
	mux.HandleFunc("/api/stats", statsHandler(b))
	mux.HandleFunc("/healthz", healthzHandler(b))
	registerControlDocEndpoints(mux)

	var limiter httpapi.RateLimiter
	if cfg != nil && cfg.ReplayDumpWindow > 0 && cfg.ReplayDumpBurst > 0 {
		limiter = httpapi.NewSlidingWindowLimiter(cfg.ReplayDumpWindow, cfg.ReplayDumpBurst, nil)
	}

	var adminToken string
	if cfg != nil {
		adminToken = cfg.AdminToken
	}

	opsHandlers := httpapi.NewHandlerSet(httpapi.Options{
		Logger:    b.log,
		Readiness: b,
		Stats: func() (int, int) {
			stats := b.Stats()
			return stats.Broadcasts, stats.Clients
		},
		Replay: httpapi.ReplayDumperFunc(func(ctx context.Context) (string, error) {
			payload := map[string]any{
				"type":         "replay_dump",
				"requested_at": time.Now().UTC().Format(time.RFC3339Nano),
			}
			data, err := json.Marshal(payload)
			if err != nil {
				return "", err
			}
			b.broadcast(data)
			return "", nil
		}),
		AdminToken:  adminToken,
		RateLimiter: limiter,
	})
	opsHandlers.Register(mux)

	return logging.HTTPTraceMiddleware(b.log)(mux)
}
