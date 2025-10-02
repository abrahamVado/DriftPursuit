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
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	configpkg "driftpursuit/broker/internal/config"
	grpcstream "driftpursuit/broker/internal/grpc"
	httpapi "driftpursuit/broker/internal/http"
	"driftpursuit/broker/internal/input"
	"driftpursuit/broker/internal/logging"
	"driftpursuit/broker/internal/networking"
	pb "driftpursuit/broker/internal/proto/pb"
	"driftpursuit/broker/internal/radar"
	"driftpursuit/broker/internal/replay"
	"driftpursuit/broker/internal/simulation"
	"driftpursuit/broker/internal/state"
	"driftpursuit/broker/internal/timesync"
	"github.com/gorilla/websocket"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/encoding/protojson"
)

// Will be configured in main() after parsing flags/env.
var upgrader = websocket.Upgrader{}

const (
	writeWait          = 10 * time.Second // write deadline for outgoing frames
	pongWaitMultiplier = 2                // read deadline = pingInterval * multiplier
)

const (
	driftWarnThresholdMs int64 = 50
)

const replayFrameRateHz = 5

var pingInterval = configpkg.DefaultPingInterval
var timeSyncInterval = time.Second

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

type vehicleDiffEnvelope struct {
	Updated []*pb.VehicleState `json:"updated,omitempty"`
	Removed []string           `json:"removed,omitempty"`
}

type projectileDiffEnvelope struct {
	Updated []*state.ProjectileState `json:"updated,omitempty"`
	Removed []string                 `json:"removed,omitempty"`
}

type worldDiffEnvelope struct {
	Type        string                  `json:"type"`
	Tick        uint64                  `json:"tick"`
	Vehicles    *vehicleDiffEnvelope    `json:"vehicles,omitempty"`
	Projectiles *projectileDiffEnvelope `json:"projectiles,omitempty"`
	Events      []*pb.GameEvent         `json:"events,omitempty"`
}

type timeSyncEnvelope struct {
	Type                 string `json:"type"`
	ServerTimestampMs    int64  `json:"server_timestamp_ms"`
	SimulatedTimestampMs int64  `json:"simulated_timestamp_ms"`
	RecommendedOffsetMs  int64  `json:"recommended_offset_ms"`
}

type Broker struct {
	clients         map[*Client]bool
	lock            sync.RWMutex
	stats           BrokerStats
	maxPayloadBytes int64

	wsAuthenticator websocketAuthenticator

	// capacity limiting
	maxClients     int
	pendingClients int

	stateMu    sync.RWMutex
	startedAt  time.Time
	startupErr error
	recovering bool
	log        *logging.Logger

	snapshotter       *StateSnapshotter
	snapshotPublisher *networking.SnapshotPublisher
	snapshotMetrics   *networking.SnapshotMetrics
	bandwidth         *networking.BandwidthRegulator
	tierManager       *networking.TierManager
	radarEvents       chan<- *pb.RadarContact
	radarProc         *radar.Processor

	replayRecorder      *replay.Recorder
	replayFrameInterval time.Duration
	replayFrameBudget   time.Duration

	intentMu        sync.RWMutex
	intentStates    map[string]*intentPayload
	lastIntentSeqs  map[string]uint64
	intentGate      *input.Gate
	intentValidator *input.Validator

	world              *state.WorldState
	tickCounter        uint64
	simulatedElapsedNs int64

	diffMu          sync.RWMutex
	diffSubscribers map[uint64]chan grpcstream.DiffEvent
	nextDiffID      uint64
}

var errRecoveryInProgress = errors.New("state recovery in progress")

type BrokerOption func(*Broker)

// WithSnapshotter attaches a state snapshotter to the broker for persistence and recovery.
func WithSnapshotter(snapshotter *StateSnapshotter) BrokerOption {
	return func(b *Broker) {
		b.snapshotter = snapshotter
	}
}

// WithRadarEventChannel wires the broker to forward bundled radar contacts to the supplied channel.
func WithRadarEventChannel(events chan<- *pb.RadarContact) BrokerOption {
	return func(b *Broker) {
		if b == nil || events == nil {
			return
		}
		b.radarEvents = events
		b.radarProc = radar.NewProcessor(events)
	}
}

// 1.- WithIntentGate allows tests to inject a customised intent gate.
func WithIntentGate(gate *input.Gate) BrokerOption {
	return func(b *Broker) {
		if b == nil || gate == nil {
			return
		}
		b.intentGate = gate
	}
}

// 2.- WithIntentValidator lets tests override the default intent validator implementation.
func WithIntentValidator(validator *input.Validator) BrokerOption {
	return func(b *Broker) {
		if b == nil || validator == nil {
			return
		}
		b.intentValidator = validator
	}
}

// 3.- WithBandwidthRegulator overrides the default per-client bandwidth regulator.
func WithBandwidthRegulator(regulator *networking.BandwidthRegulator) BrokerOption {
	return func(b *Broker) {
		if b == nil || regulator == nil {
			return
		}
		//1.- Swap in the provided regulator so tests can exercise throttling boundaries.
		b.bandwidth = regulator
	}
}

// 4.- WithReplayRecorder attaches a replay recorder to persist tick deltas.
func WithReplayRecorder(recorder *replay.Recorder) BrokerOption {
	return func(b *Broker) {
		if b == nil || recorder == nil {
			return
		}
		//1.- Capture the recorder so replay dumps persist buffered frames during shutdown hooks.
		b.replayRecorder = recorder
	}
}

func NewBroker(maxPayloadBytes int64, maxClients int, startedAt time.Time, logger *logging.Logger, opts ...BrokerOption) *Broker {
	if maxPayloadBytes <= 0 {
		maxPayloadBytes = configpkg.DefaultMaxPayloadBytes
	}
	if logger == nil {
		logger = logging.L()
	}
	snapshotMetrics := networking.NewSnapshotMetrics()
	bandwidth := networking.NewBandwidthRegulator(networking.DefaultBandwidthLimitBytesPerSecond, nil)

	broker := &Broker{
		clients:             make(map[*Client]bool),
		maxPayloadBytes:     maxPayloadBytes,
		maxClients:          maxClients,
		startedAt:           startedAt,
		log:                 logger,
		snapshotPublisher:   networking.NewSnapshotPublisher(int(maxPayloadBytes)),
		snapshotMetrics:     snapshotMetrics,
		bandwidth:           bandwidth,
		tierManager:         networking.NewTierManager(networking.DefaultTierConfig()),
		intentStates:        make(map[string]*intentPayload),
		lastIntentSeqs:      make(map[string]uint64),
		world:               state.NewWorldState(),
		diffSubscribers:     make(map[uint64]chan grpcstream.DiffEvent),
		replayFrameInterval: time.Second / replayFrameRateHz,
	}
	for _, opt := range opts {
		if opt != nil {
			opt(broker)
		}
	}

	if broker.wsAuthenticator == nil {
		broker.wsAuthenticator = allowAllAuthenticator{}
	}

	if broker.intentGate == nil {
		gateLogger := logger
		if gateLogger != nil {
			gateLogger = gateLogger.With(logging.String("component", "intent_gate"))
		}
		broker.intentGate = input.NewGate(input.Config{
			MaxAge:      250 * time.Millisecond,
			MinInterval: time.Second / 60,
		}, gateLogger)
	}

	if broker.intentValidator == nil {
		validatorLogger := logger
		if validatorLogger != nil {
			validatorLogger = validatorLogger.With(logging.String("component", "intent_validator"))
		}
		broker.intentValidator = input.NewValidator(input.DefaultControlConstraints, validatorLogger)
	}

	if broker.radarProc == nil {
		broker.radarProc = radar.NewProcessor(broker.radarEvents)
	}

	if broker.snapshotter != nil {
		broker.setRecovering(true)
		broker.setStartupError(errRecoveryInProgress)
		go broker.finishRecovery()
	}

	return broker
}

func (b *Broker) storeVehicleState(state *pb.VehicleState) {
	if b == nil || state == nil || state.VehicleId == "" {
		return
	}
	//1.- Delegate to the world state container to record and mark the update.
	b.world.Vehicles.Upsert(state)
}

func (b *Broker) vehicleState(vehicleID string) *pb.VehicleState {
	if b == nil || vehicleID == "" {
		return nil
	}
	//1.- Read a defensive clone from the world state container.
	return b.world.Vehicles.Get(vehicleID)
}

type BrokerStats struct {
	Broadcasts       int                                 `json:"broadcasts"`
	Clients          int                                 `json:"clients"`
	IntentDrops      map[string]input.DropCounters       `json:"intent_drops,omitempty"`
	IntentValidation map[string]input.ValidationCounters `json:"intent_validation,omitempty"`
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
	if b.tierManager != nil && client != nil {
		b.tierManager.RemoveObserver(client.id)
	}
	if b.snapshotMetrics != nil && client != nil {
		b.snapshotMetrics.ForgetClient(client.id)
	}
	if b.bandwidth != nil && client != nil {
		b.bandwidth.Forget(client.id)
	}
	if b.intentGate != nil && client != nil {
		b.intentGate.Forget(client.id)
	}
	if b.intentValidator != nil && client != nil {
		b.intentValidator.Forget(client.id)
	}
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

func (b *Broker) TimeSyncSnapshot() (int64, int64, int64) {
	if b == nil {
		return 0, 0, 0
	}

	//1.- Capture the current wall-clock timestamp so clients can correlate updates.
	now := time.Now().UTC()

	//2.- Translate the accumulated simulation nanoseconds into an absolute timestamp.
	elapsedNs := atomic.LoadInt64(&b.simulatedElapsedNs)
	simulated := b.startedAt.Add(time.Duration(elapsedNs))

	serverMs := now.UnixMilli()
	simulatedMs := simulated.UTC().UnixMilli()
	offsetMs := simulatedMs - serverMs
	return serverMs, simulatedMs, offsetMs
}

func (b *Broker) marshalTimeSyncEnvelope() ([]byte, int64) {
	if b == nil {
		return nil, 0
	}

	//1.- Derive the authoritative timestamps representing wall and simulation clocks.
	serverMs, simulatedMs, offsetMs := b.TimeSyncSnapshot()

	//2.- Marshal the payload so transports can fan it out without duplicating logic.
	payload, err := json.Marshal(timeSyncEnvelope{
		Type:                 "time_sync",
		ServerTimestampMs:    serverMs,
		SimulatedTimestampMs: simulatedMs,
		RecommendedOffsetMs:  offsetMs,
	})
	if err != nil {
		if b.log != nil {
			b.log.Error("failed to marshal time sync payload", logging.Error(err))
		}
		return nil, offsetMs
	}
	return payload, offsetMs
}

func (b *Broker) LogTimeDrift(channel, target string, offsetMs int64) {
	if b == nil || b.log == nil {
		return
	}

	//1.- Populate shared context for downstream log aggregation.
	fields := []logging.Field{
		logging.String("channel", channel),
		logging.String("target", target),
		logging.Int64("offset_ms", offsetMs),
	}

	//2.- Escalate to warnings when the skew exceeds the configured tolerance.
	if abs := absInt64(offsetMs); abs >= driftWarnThresholdMs {
		b.log.Warn("time drift exceeds tolerance", append(fields, logging.Int64("tolerance_ms", driftWarnThresholdMs))...)
		return
	}

	//3.- Emit lower-severity telemetry so operators can monitor the typical drift envelope.
	b.log.Debug("time drift sample", fields...)
}

func absInt64(value int64) int64 {
	if value < 0 {
		return -value
	}
	return value
}

func (b *Broker) enqueueSnapshot(client *Client, payload []byte) bool {
	if b == nil || client == nil || len(payload) == 0 {
		return false
	}
	//1.- Attempt a non-blocking send so encoding latency does not stall writers.
	select {
	case client.send <- payload:
		return true
	default:
	}
	//2.- Remove saturated clients under lock to avoid leaking goroutines.
	b.lock.Lock()
	if _, exists := b.clients[client]; exists {
		close(client.send)
		delete(b.clients, client)
		if b.stats.Clients > 0 {
			b.stats.Clients--
		}
	}
	b.lock.Unlock()
	//3.- Clear exported metrics for the disconnected client.
	if b.snapshotMetrics != nil {
		b.snapshotMetrics.ForgetClient(client.id)
	}
	if b.bandwidth != nil {
		b.bandwidth.Forget(client.id)
	}
	return false
}

func (b *Broker) publishWorldSnapshot(snapshot *pb.WorldSnapshot) {
	if b == nil || snapshot == nil || b.snapshotPublisher == nil || b.tierManager == nil {
		return
	}

	//1.- Capture the current client list without holding the write lock during encoding.
	b.lock.RLock()
	clients := make([]*Client, 0, len(b.clients))
	for client := range b.clients {
		clients = append(clients, client)
	}
	b.lock.RUnlock()
	if len(clients) == 0 {
		return
	}

	deliveries := 0
	for _, client := range clients {
		if client == nil {
			continue
		}
		//2.- Build the tailored snapshot using the budgeting planner.
		plan, err := b.snapshotPublisher.Build(client.id, snapshot, b.tierManager.Buckets(client.id))
		if err != nil {
			b.log.Warn("failed to build world snapshot", logging.Error(err))
			continue
		}
		bytes := 0
		if len(plan.Payload) > 0 {
			if b.bandwidth != nil && !b.bandwidth.Allow(client.id, len(plan.Payload)) {
				if b.snapshotMetrics != nil {
					b.snapshotMetrics.Observe(client.id, 0, plan.Result.Dropped)
				}
				continue
			}
			if b.enqueueSnapshot(client, plan.Payload) {
				bytes = len(plan.Payload)
				deliveries++
			}
		}
		if b.snapshotMetrics != nil {
			b.snapshotMetrics.Observe(client.id, bytes, plan.Result.Dropped)
		}
	}

	if deliveries == 0 {
		return
	}

	//3.- Count the publish as a broadcast so existing metrics remain consistent.
	b.lock.Lock()
	b.stats.Broadcasts++
	b.lock.Unlock()
}

func (b *Broker) Stats() BrokerStats {
	b.lock.RLock()
	stats := b.stats
	b.lock.RUnlock()
	if b.intentGate != nil {
		stats.IntentDrops = b.intentGate.Metrics()
	}
	if b.intentValidator != nil {
		stats.IntentValidation = b.intentValidator.Metrics()
	}
	return stats
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

func (b *Broker) setRecovering(recovering bool) {
	b.stateMu.Lock()
	b.recovering = recovering
	b.stateMu.Unlock()
}

func (b *Broker) isRecovering() bool {
	b.stateMu.RLock()
	recovering := b.recovering
	b.stateMu.RUnlock()
	return recovering
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

	if b.isRecovering() {
		reqLogger.Warn("rejecting websocket connection: broker recovering state")
		http.Error(w, "service unavailable: recovering state", http.StatusServiceUnavailable)
		return
	}

	clientID := r.RemoteAddr
	if b.wsAuthenticator != nil {
		subject, err := b.wsAuthenticator.Authenticate(r)
		if err != nil {
			reqLogger.Warn("rejecting websocket connection: authentication failed", logging.Error(err))
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		if strings.TrimSpace(subject) != "" {
			clientID = subject
			reqLogger = reqLogger.With(logging.String("client_subject", subject))
			ctx = logging.ContextWithLogger(ctx, reqLogger)
			r = r.WithContext(ctx)
		}
	}

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
	client := &Client{conn: conn, send: make(chan []byte, 256), id: clientID}
	client.log = reqLogger.With(logging.String("client_id", client.id))

	b.lock.Lock()
	if b.maxClients > 0 && b.pendingClients > 0 {
		b.pendingClients--
	}
	b.clients[client] = true
	b.stats.Clients++
	b.lock.Unlock()

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

	if snapshots := b.snapshotMessages(); len(snapshots) > 0 {
		go b.replaySnapshots(client, snapshots)
	}

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

			if b.handleStructuredMessage(client, envelope, msg) {
				continue
			}

			b.recordSnapshot(envelope.Type, msg)
			b.broadcast(msg)
		}
	}()

	// writer (handles errors + periodic ping)
	go func() {
		pingTicker := time.NewTicker(pingInterval)
		syncTicker := time.NewTicker(timeSyncInterval)
		defer func() {
			pingTicker.Stop()
			syncTicker.Stop()
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
			case <-pingTicker.C:
				// Send ping periodically; pong handler extends read deadline
				if err := client.conn.WriteControl(websocket.PingMessage, []byte{}, time.Now().Add(writeWait)); err != nil {
					client.log.Warn("ping failure", logging.Error(err))
					b.deregisterClient(client)
					return
				}
			case <-syncTicker.C:
				//1.- Build and queue the time-sync envelope for this client.
				payload, offsetMs := b.marshalTimeSyncEnvelope()
				if len(payload) == 0 {
					continue
				}

				if err := client.conn.SetWriteDeadline(time.Now().Add(writeWait)); err != nil {
					client.log.Error("failed to set write deadline for time sync", logging.Error(err))
					b.deregisterClient(client)
					return
				}
				if err := client.conn.WriteMessage(websocket.TextMessage, payload); err != nil {
					client.log.Error("time sync write error", logging.Error(err))
					b.deregisterClient(client)
					return
				}

				//2.- Emit structured drift metrics whenever an update is delivered.
				b.LogTimeDrift("websocket", client.id, offsetMs)
			}
		}
	}()
}

func (b *Broker) finishRecovery() {
	if b.snapshotter == nil {
		b.setStartupError(nil)
		b.setRecovering(false)
		return
	}

	if err := b.snapshotter.load(); err != nil {
		b.log.Error("failed to load state snapshot", logging.Error(err))
		b.setStartupError(err)
		b.setRecovering(false)
		return
	}

	snapshots := b.snapshotter.StateMessages()

	if len(snapshots) > 0 {
		b.log.Info("state snapshot loaded", logging.Int("messages", len(snapshots)))
	} else {
		b.log.Info("no state snapshot to apply")
	}

	b.setStartupError(nil)
	b.setRecovering(false)

	status := map[string]string{
		"type":   "system_status",
		"status": "recovered",
	}
	if data, err := json.Marshal(status); err == nil {
		b.recordSnapshot("system_status", data)
		b.broadcast(data)
	}
}

func (b *Broker) recordSnapshot(messageType string, payload []byte) {
	if b.snapshotter == nil {
		return
	}
	b.snapshotter.Record(messageType, payload)
}

func (b *Broker) snapshotMessages() [][]byte {
	if b.snapshotter == nil {
		return nil
	}
	return b.snapshotter.StateMessages()
}

func (b *Broker) replaySnapshots(client *Client, snapshots [][]byte) {
	if client == nil {
		return
	}
	for _, msg := range snapshots {
		select {
		case client.send <- msg:
		default:
			client.log.Warn("dropping snapshot message: client buffer full")
			return
		}
	}
}

func (b *Broker) publishWorldDiff(tick uint64, diff state.TickDiff) {
	if b == nil || !diff.HasChanges() {
		return
	}

	envelope := worldDiffEnvelope{Type: "world_diff", Tick: tick}

	//1.- Attach vehicle changes when they exist.
	if len(diff.Vehicles.Updated) > 0 || len(diff.Vehicles.Removed) > 0 {
		envelope.Vehicles = &vehicleDiffEnvelope{
			Updated: diff.Vehicles.Updated,
			Removed: diff.Vehicles.Removed,
		}
	}

	//2.- Attach projectile changes for downstream prediction.
	if len(diff.Projectiles.Updated) > 0 || len(diff.Projectiles.Removed) > 0 {
		envelope.Projectiles = &projectileDiffEnvelope{
			Updated: diff.Projectiles.Updated,
			Removed: diff.Projectiles.Removed,
		}
	}

	//3.- Include queued events for HUD/log updates.
	if len(diff.Events.Events) > 0 {
		envelope.Events = diff.Events.Events
		b.recordReplayEvents(tick, diff.Events.Events)
	}

	data, err := json.Marshal(envelope)
	if err != nil {
		b.log.Error("failed to marshal world diff", logging.Error(err))
		return
	}
	if b.replayRecorder != nil {
		simulatedMs := atomic.LoadInt64(&b.simulatedElapsedNs) / int64(time.Millisecond)
		b.replayRecorder.RecordTick(tick, simulatedMs, data)
	}
	b.broadcast(data)

	if len(data) > 0 {
		payload := append([]byte(nil), data...)
		event := grpcstream.DiffEvent{Tick: tick, Payload: payload}
		b.diffMu.RLock()
		for id, ch := range b.diffSubscribers {
			select {
			case ch <- event:
			default:
				if b.log != nil {
					b.log.Debug("dropping grpc diff", logging.Field{Key: "subscriber_id", Value: id})
				}
			}
		}
		b.diffMu.RUnlock()
	}
}

// DumpReplay persists the buffered replay frames and returns the artefact path.
func (b *Broker) DumpReplay(ctx context.Context) (string, error) {
	if b == nil || b.replayRecorder == nil {
		return "", fmt.Errorf("replay recorder unavailable")
	}
	//1.- Use the broker start time to derive a deterministic match identifier.
	matchID := b.startedAt.UTC().Format("match-20060102T150405")
	if matchID == "" {
		matchID = "match"
	}
	//2.- Trigger the recorder roll so the buffered frames land on disk.
	path, err := b.replayRecorder.Roll(matchID)
	if err != nil {
		return "", err
	}
	//3.- Emit a minimal notification for administrative consumers.
	payload := map[string]any{
		"type":         "replay_dump",
		"location":     path,
		"requested_at": time.Now().UTC().Format(time.RFC3339Nano),
	}
	data, err := json.Marshal(payload)
	if err == nil {
		b.broadcast(data)
	}
	return path, nil
}

func (b *Broker) advanceSimulation(step time.Duration) {
	if b == nil || step <= 0 {
		return
	}

	//1.- Track total simulated time so clock sync can compare against wall clock drift.
	atomic.AddInt64(&b.simulatedElapsedNs, step.Nanoseconds())

	//2.- Accumulate elapsed time to capture world frames at the configured replay cadence.
	b.maybeRecordReplayFrame(step)

	diff := b.world.AdvanceTick(step)
	if !diff.HasChanges() {
		return
	}

	tick := atomic.AddUint64(&b.tickCounter, 1)
	//3.- Publish the diff after incrementing the authoritative tick counter.
	b.publishWorldDiff(tick, diff)
}

func (b *Broker) maybeRecordReplayFrame(step time.Duration) {
	if b == nil || b.replayRecorder == nil || b.world == nil {
		return
	}
	interval := b.replayFrameInterval
	if interval <= 0 {
		interval = time.Second / replayFrameRateHz
	}

	b.replayFrameBudget += step
	for b.replayFrameBudget >= interval {
		//1.- Reduce the accumulated budget so the capture cadence remains consistent.
		b.replayFrameBudget -= interval
		b.recordReplayWorldFrame()
	}
}

func (b *Broker) recordReplayWorldFrame() {
	if b == nil || b.replayRecorder == nil || b.world == nil {
		return
	}

	vehicles := b.world.Vehicles.Snapshot()
	projectiles := b.world.Projectiles.Snapshot()
	payload := struct {
		Vehicles    []*pb.VehicleState       `json:"vehicles,omitempty"`
		Projectiles []*state.ProjectileState `json:"projectiles,omitempty"`
	}{Vehicles: vehicles, Projectiles: projectiles}

	data, err := json.Marshal(payload)
	if err != nil {
		if b.log != nil {
			b.log.Debug("failed to encode replay world frame", logging.Error(err))
		}
		return
	}
	simulatedMs := atomic.LoadInt64(&b.simulatedElapsedNs) / int64(time.Millisecond)
	tick := atomic.LoadUint64(&b.tickCounter)
	//1.- Record the frame so replay dumps include periodic world snapshots.
	b.replayRecorder.RecordWorldFrame(tick, simulatedMs, data)
}

func (b *Broker) recordReplayEvents(tick uint64, events []*pb.GameEvent) {
	if b == nil || b.replayRecorder == nil || len(events) == 0 {
		return
	}
	marshal := protojson.MarshalOptions{EmitUnpopulated: true}
	simulatedMs := atomic.LoadInt64(&b.simulatedElapsedNs) / int64(time.Millisecond)

	for _, event := range events {
		if event == nil {
			continue
		}
		data, err := marshal.Marshal(event)
		if err != nil {
			if b.log != nil {
				b.log.Debug("failed to encode replay event", logging.Error(err))
			}
			continue
		}
		//1.- Buffer each event to maintain deterministic playback ordering.
		b.replayRecorder.RecordEvent(tick, simulatedMs, data)
	}
}

func (b *Broker) handleStructuredMessage(client *Client, envelope inboundEnvelope, raw []byte) bool {
	if b == nil {
		return false
	}
	if b.tierManager == nil {
		return false
	}

	unmarshal := protojson.UnmarshalOptions{DiscardUnknown: true}

	switch envelope.Type {
	case "observer_state":
		var state pb.ObserverState
		if err := unmarshal.Unmarshal(raw, &state); err != nil {
			if client != nil {
				client.log.Debug("failed to decode observer_state", logging.Error(err))
			}
			return true
		}
		if state.ObserverId == "" {
			state.ObserverId = envelope.ID
		}
		b.tierManager.UpdateObserver(client.id, &state)
		return true
	case "entity_snapshot":
		var snapshot pb.EntitySnapshot
		if err := unmarshal.Unmarshal(raw, &snapshot); err != nil {
			if client != nil {
				client.log.Debug("failed to decode entity_snapshot", logging.Error(err))
			}
			return false
		}
		if snapshot.EntityId == "" {
			snapshot.EntityId = envelope.ID
		}
		b.tierManager.UpdateEntity(&snapshot)
	case "vehicle_state":
		var state pb.VehicleState
		if err := unmarshal.Unmarshal(raw, &state); err != nil {
			if client != nil {
				client.log.Debug("failed to decode vehicle_state", logging.Error(err))
			}
			return false
		}
		if state.VehicleId == "" {
			state.VehicleId = envelope.ID
		}
		b.storeVehicleState(&state)
		return true
	case "projectile_state":
		var payload struct {
			Position  state.Vector3 `json:"position"`
			Velocity  state.Vector3 `json:"velocity"`
			Active    bool          `json:"active"`
			UpdatedAt int64         `json:"updated_at_ms"`
		}
		if err := json.Unmarshal(raw, &payload); err != nil {
			if client != nil {
				client.log.Debug("failed to decode projectile_state", logging.Error(err))
			}
			return true
		}
		projectile := &state.ProjectileState{
			ID:        envelope.ID,
			Position:  payload.Position,
			Velocity:  payload.Velocity,
			Active:    payload.Active,
			UpdatedAt: payload.UpdatedAt,
		}
		if !projectile.Active {
			b.world.Projectiles.Remove(projectile.ID)
			return true
		}
		b.world.Projectiles.Upsert(projectile)
		return true
	case "intent":
		payload, err := decodeIntentPayload(raw)
		if err != nil {
			if client != nil {
				client.log.Debug("failed to decode intent", logging.Error(err))
			}
			return true
		}
		if payload.ControllerID == "" {
			payload.ControllerID = envelope.ID
		}
		if err := validateIntentPayload(payload); err != nil {
			if client != nil {
				client.log.Debug("rejecting intent", logging.Error(err))
			}
			return true
		}
		//1.- Resolve the per-connection identifier so rate limiting applies to each websocket independently.
		clientID := envelope.ID
		if client != nil && client.id != "" {
			clientID = client.id
		}
		logger := b.log
		if client != nil && client.log != nil {
			logger = client.log
		}
		disconnect, procErr := b.processIntent(clientID, payload, logger)
		if procErr != nil {
			return true
		}
		if disconnect && client != nil && client.conn != nil {
			_ = client.conn.Close()
		}
		return true
	case "game_event":
		var event pb.GameEvent
		if err := unmarshal.Unmarshal(raw, &event); err != nil {
			if client != nil {
				client.log.Debug("failed to decode game_event", logging.Error(err))
			}
			return true
		}
		if event.EventId == "" {
			event.EventId = envelope.ID
		}
		b.world.Events.Add(&event)
		return true
	case "radar_frame":
		var frame pb.RadarFrame
		if err := unmarshal.Unmarshal(raw, &frame); err != nil {
			if client != nil {
				client.log.Debug("failed to decode radar_frame", logging.Error(err))
			}
			return false
		}
		b.tierManager.ApplyRadarFrame(&frame)
		if b.radarProc != nil {
			b.radarProc.Process(&frame)
		}
	case "world_snapshot":
		var snapshot pb.WorldSnapshot
		if err := unmarshal.Unmarshal(raw, &snapshot); err != nil {
			if client != nil {
				client.log.Debug("failed to decode world_snapshot", logging.Error(err))
			}
			return false
		}
		b.tierManager.IngestWorldSnapshot(&snapshot)
		b.publishWorldSnapshot(&snapshot)
		b.recordSnapshot(envelope.Type, raw)
		return true
	}
	return false
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
		Message        string  `json:"message,omitempty"`
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
		message := ""
		if b.isRecovering() {
			status = "recovering"
			message = "state recovery in progress"
			code = http.StatusServiceUnavailable
		}
		if err := b.startupError(); err != nil {
			status = "error"
			code = http.StatusServiceUnavailable
			if message == "" {
				message = err.Error()
			}
		}

		w.Header().Set("Content-Type", "application/json")
		if code != http.StatusOK {
			w.WriteHeader(code)
		}
		resp := response{
			Status:         status,
			Message:        message,
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

	var brokerOptions []BrokerOption

	snapshotter, err := NewStateSnapshotter(cfg.StateSnapshotPath, cfg.StateSnapshotInterval, logger)
	if err != nil {
		logger.Fatal("failed to initialise state snapshotter", logging.Error(err))
	}
	if snapshotter != nil {
		brokerOptions = append(brokerOptions, WithSnapshotter(snapshotter))
		defer func() {
			if err := snapshotter.Close(); err != nil {
				logger.Warn("state snapshotter close failed", logging.Error(err))
			}
		}()
	}

	if cfg.ReplayDirectory == "" {
		cfg.ReplayDirectory = filepath.Join("storage", "replays")
	}
	if cfg.ReplayDirectory != "" {
		recorder, err := replay.NewRecorder(cfg.ReplayDirectory, nil)
		if err != nil {
			logger.Fatal("failed to initialise replay recorder", logging.Error(err))
		}
		brokerOptions = append(brokerOptions, WithReplayRecorder(recorder))
	}

	switch cfg.WSAuthMode {
	case configpkg.WSAuthModeHMAC:
		authenticator, err := newHMACWebsocketAuthenticator(cfg.WSHMACSecret)
		if err != nil {
			logger.Fatal("failed to configure websocket authenticator", logging.Error(err))
		}
		brokerOptions = append(brokerOptions, WithWebsocketAuthenticator(authenticator))
		logger.Info("websocket HMAC authentication enabled")
	default:
		logger.Info("websocket authentication disabled")
	}

	broker := NewBroker(maxPayloadBytes, maxClients, startedAt, logger, brokerOptions...)

	grpcLogger := logger.With(logging.String("component", "grpc"))
	grpcOptions, grpcCleanup, err := configureGRPCSecurity(cfg, grpcLogger)
	if err != nil {
		logger.Fatal("failed to configure gRPC security", logging.Error(err))
	}
	defer grpcCleanup()

	grpcServer := grpc.NewServer(grpcOptions...)
	timeSyncService := timesync.NewService(broker, timeSyncInterval)
	pb.RegisterTimeSyncServiceServer(grpcServer, timeSyncService)
	streamService := grpcstream.NewService(broker)
	pb.RegisterBrokerStreamServiceServer(grpcServer, streamService)

	go func() {
		listener, err := net.Listen("tcp", cfg.GRPCAddress)
		if err != nil {
			logger.Fatal("failed to start gRPC listener", logging.Error(err), logging.String("address", cfg.GRPCAddress))
		}
		logger.Info("gRPC time sync server listening", logging.String("address", cfg.GRPCAddress))
		if err := grpcServer.Serve(listener); err != nil {
			logger.Fatal("gRPC server terminated", logging.Error(err))
		}
	}()
	defer grpcServer.GracefulStop()

	simCtx, simCancel := context.WithCancel(context.Background())
	simLoop := simulation.NewLoop(60, broker.advanceSimulation)
	simLoop.Start(simCtx)
	defer simCancel()
	defer simLoop.Stop()

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
		Snapshots: b.snapshotMetrics,
		Bandwidth: b.bandwidth,
		Replay:    httpapi.ReplayDumperFunc(b.DumpReplay),
		ReplayStats: func() replay.Stats {
			stats := replay.Stats{}
			if b.replayRecorder != nil {
				snap := b.replayRecorder.Snapshot()
				stats.BufferedFrames = snap.BufferedFrames
				stats.BufferedBytes = snap.BufferedBytes
				stats.Dumps = snap.Dumps
				stats.LastDumpURI = snap.LastDumpURI
				stats.LastDumpTime = snap.LastDumpTime
			}
			return stats
		},
		AdminToken:  adminToken,
		RateLimiter: limiter,
	})
	opsHandlers.Register(mux)

	return logging.HTTPTraceMiddleware(b.log)(mux)
}
