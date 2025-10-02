package input

import (
	"sync"
	"time"

	"driftpursuit/broker/internal/logging"
)

// Clock exposes the current time for rate limiting decisions.
type Clock interface {
	Now() time.Time
}

type clockFunc func() time.Time

// Now implements Clock for functional adapters.
func (c clockFunc) Now() time.Time { return c() }

// systemClock relies on time.Now for production code paths.
type systemClock struct{}

// Now implements Clock by delegating to time.Now.
func (systemClock) Now() time.Time { return time.Now() }

// Config controls the freshness and throughput gates applied to client inputs.
type Config struct {
	MaxAge      time.Duration
	MinInterval time.Duration
}

// DropReason enumerates why a frame was rejected by the gate.
type DropReason string

const (
	DropReasonNone        DropReason = ""
	DropReasonSequence    DropReason = "sequence"
	DropReasonStale       DropReason = "stale"
	DropReasonRateLimited DropReason = "rate_limit"
)

// String returns the textual representation of the drop reason.
func (r DropReason) String() string { return string(r) }

// Decision summarises whether a frame passed validation.
type Decision struct {
	Accepted bool
	Reason   DropReason
	Delay    time.Duration
}

// Frame captures the metadata required to validate a control update.
type Frame struct {
	ClientID   string
	SequenceID uint64
	SentAt     time.Time
}

type clientState struct {
	lastSequence uint64
	lastAccepted time.Time
}

// DropCounters aggregates per-reason drop counts.
type DropCounters struct {
	Sequence    uint64 `json:"sequence"`
	Stale       uint64 `json:"stale"`
	RateLimited uint64 `json:"rate_limited"`
}

// Metrics stores per-client drop counters for diagnostics.
type Metrics struct {
	mu    sync.RWMutex
	drops map[string]DropCounters
}

// newMetrics provisions an empty metrics container.
func newMetrics() *Metrics {
	return &Metrics{drops: make(map[string]DropCounters)}
}

// observe increments the counter for the supplied reason.
func (m *Metrics) observe(clientID string, reason DropReason) {
	if m == nil || clientID == "" || reason == DropReasonNone {
		return
	}
	//1.- Lock while mutating the counters so concurrent updates stay consistent.
	m.mu.Lock()
	current := m.drops[clientID]
	switch reason {
	case DropReasonSequence:
		current.Sequence++
	case DropReasonStale:
		current.Stale++
	case DropReasonRateLimited:
		current.RateLimited++
	}
	m.drops[clientID] = current
	m.mu.Unlock()
}

// snapshot returns a deep copy of the counters for external consumption.
func (m *Metrics) snapshot() map[string]DropCounters {
	if m == nil {
		return nil
	}
	//1.- Hold the read lock while cloning to avoid exposing internal maps.
	m.mu.RLock()
	defer m.mu.RUnlock()
	if len(m.drops) == 0 {
		return nil
	}
	clone := make(map[string]DropCounters, len(m.drops))
	for clientID, counters := range m.drops {
		clone[clientID] = counters
	}
	return clone
}

// forget removes a client's counters when the connection closes.
func (m *Metrics) forget(clientID string) {
	if m == nil || clientID == "" {
		return
	}
	//1.- Drop the entry under lock so future snapshots omit stale clients.
	m.mu.Lock()
	delete(m.drops, clientID)
	m.mu.Unlock()
}

// Gate validates sequencing, freshness, and throughput for inbound control frames.
type Gate struct {
	mu      sync.Mutex
	cfg     Config
	clock   Clock
	logger  *logging.Logger
	metrics *Metrics
	clients map[string]*clientState
}

// Option customises gate construction.
type Option func(*Gate)

// WithClock overrides the clock used for latency calculations.
func WithClock(clock Clock) Option {
	return func(g *Gate) {
		if clock != nil {
			g.clock = clock
		}
	}
}

// WithMetrics injects a pre-built metrics container, enabling shared aggregation across gates.
func WithMetrics(metrics *Metrics) Option {
	return func(g *Gate) {
		if metrics != nil {
			g.metrics = metrics
		}
	}
}

// NewGate constructs a gate with the supplied configuration and logger.
func NewGate(cfg Config, logger *logging.Logger, opts ...Option) *Gate {
	//1.- Normalise zero or negative intervals to disable the corresponding checks gracefully.
	if cfg.MaxAge < 0 {
		cfg.MaxAge = 0
	}
	if cfg.MinInterval < 0 {
		cfg.MinInterval = 0
	}
	gate := &Gate{
		cfg:     cfg,
		clock:   systemClock{},
		logger:  logger,
		metrics: newMetrics(),
		clients: make(map[string]*clientState),
	}
	for _, opt := range opts {
		if opt != nil {
			opt(gate)
		}
	}
	if gate.clock == nil {
		gate.clock = systemClock{}
	}
	if gate.metrics == nil {
		gate.metrics = newMetrics()
	}
	return gate
}

// Evaluate applies sequencing, freshness, and throughput guards to the frame.
func (g *Gate) Evaluate(frame Frame) Decision {
	decision := Decision{Accepted: true}
	if g == nil {
		return decision
	}
	if frame.ClientID == "" {
		return decision
	}
	now := g.clock.Now()
	if !frame.SentAt.IsZero() {
		//1.- Compute the wall-clock delay between capture and arrival for diagnostics.
		delay := now.Sub(frame.SentAt)
		if delay < 0 {
			delay = 0
		}
		decision.Delay = delay
	}

	g.mu.Lock()
	state := g.clients[frame.ClientID]
	if state == nil {
		//2.- Track the newly observed client to enforce future sequencing and rate limits.
		state = &clientState{}
		g.clients[frame.ClientID] = state
	}

	switch {
	case frame.SequenceID == 0:
		decision = Decision{Accepted: false, Reason: DropReasonSequence, Delay: decision.Delay}
	case state.lastSequence == 0:
		//3.- First frame for this client always passes baseline checks.
		state.lastSequence = frame.SequenceID
		state.lastAccepted = now
	default:
		if frame.SequenceID <= state.lastSequence {
			decision = Decision{Accepted: false, Reason: DropReasonSequence, Delay: decision.Delay}
			break
		}
		interval := now.Sub(state.lastAccepted)
		if g.cfg.MinInterval > 0 && interval < g.cfg.MinInterval {
			decision = Decision{Accepted: false, Reason: DropReasonRateLimited, Delay: decision.Delay}
			break
		}

		if g.cfg.MaxAge > 0 {
			if decision.Delay > g.cfg.MaxAge && decision.Delay > 0 {
				decision = Decision{Accepted: false, Reason: DropReasonStale, Delay: decision.Delay}
				break
			}
			//4.- Estimate extra latency using the previous acceptance time when capture timestamps are absent.
			if g.cfg.MinInterval > 0 {
				seqDelta := frame.SequenceID - state.lastSequence
				expected := time.Duration(seqDelta) * g.cfg.MinInterval
				extra := interval - expected
				if extra > g.cfg.MaxAge {
					decision = Decision{Accepted: false, Reason: DropReasonStale, Delay: decision.Delay}
					break
				}
			}
		}

		//5.- Promote the frame as the latest accepted event when it passes all gates.
		state.lastSequence = frame.SequenceID
		state.lastAccepted = now
	}
	g.mu.Unlock()

	if !decision.Accepted {
		g.metrics.observe(frame.ClientID, decision.Reason)
	}
	return decision
}

// Forget clears cached sequencing and metrics for a disconnected client.
func (g *Gate) Forget(clientID string) {
	if g == nil || clientID == "" {
		return
	}
	//1.- Remove per-client sequencing state so future sessions start fresh.
	g.mu.Lock()
	delete(g.clients, clientID)
	g.mu.Unlock()
	g.metrics.forget(clientID)
}

// Metrics returns a snapshot of the latest drop counters.
func (g *Gate) Metrics() map[string]DropCounters {
	if g == nil {
		return nil
	}
	return g.metrics.snapshot()
}
