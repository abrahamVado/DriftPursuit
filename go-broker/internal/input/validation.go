package input

import (
	"fmt"
	"math"
	"sync"
	"time"

	"driftpursuit/broker/internal/logging"
)

// ValidationReason identifies why a control frame was rejected by the validator.
type ValidationReason string

const (
	ValidationReasonNone           ValidationReason = ""
	ValidationReasonThrottleRange  ValidationReason = "throttle_range"
	ValidationReasonBrakeRange     ValidationReason = "brake_range"
	ValidationReasonSteerRange     ValidationReason = "steer_range"
	ValidationReasonGearRange      ValidationReason = "gear_range"
	ValidationReasonThrottleDelta  ValidationReason = "throttle_delta"
	ValidationReasonBrakeDelta     ValidationReason = "brake_delta"
	ValidationReasonSteerDelta     ValidationReason = "steer_delta"
	ValidationReasonGearDelta      ValidationReason = "gear_delta"
	ValidationReasonCooldownActive ValidationReason = "cooldown_active"
)

// ControlRanges groups the inclusive ranges for each analog control channel.
type ControlRanges struct {
	Throttle Range
	Brake    Range
	Steer    Range
	Gear     IntRange
}

// Range defines the inclusive min/max for a floating point channel.
type Range struct {
	Min float64
	Max float64
}

// IntRange defines the inclusive min/max for an integer channel.
type IntRange struct {
	Min int32
	Max int32
}

// ControlDeltas groups the maximum per-frame deltas for each control channel.
type ControlDeltas struct {
	Throttle float64
	Brake    float64
	Steer    float64
	Gear     int32
}

// Controls captures the subset of intent payload required for validation.
type Controls struct {
	Throttle float64
	Brake    float64
	Steer    float64
	Gear     int32
}

// ControlConstraints configures the validator's range, delta, and cooldown policies.
type ControlConstraints struct {
	Ranges             ControlRanges
	Deltas             ControlDeltas
	InvalidBurstLimit  int
	InvalidBurstWindow time.Duration
	CooldownDuration   time.Duration
	MaxCooldownStrikes int
}

// ValidationDecision summarises the result of a Validate call.
type ValidationDecision struct {
	Accepted   bool
	Reason     ValidationReason
	Warn       bool
	Disconnect bool
	Cooldown   time.Duration
	Details    string
}

// ValidationCounters aggregates per-client violation statistics.
type ValidationCounters struct {
	Violations  map[ValidationReason]uint64 `json:"violations,omitempty"`
	Cooldowns   uint64                      `json:"cooldowns"`
	Disconnects uint64                      `json:"disconnects"`
}

// ValidatorOption customises validator construction.
type ValidatorOption func(*Validator)

// Validator enforces control ranges, delta limits, and cooldown behaviour.
type Validator struct {
	mu      sync.Mutex
	cfg     ControlConstraints
	clock   Clock
	logger  *logging.Logger
	clients map[string]*validatorClientState
	metrics map[string]ValidationCounters
}

type validatorClientState struct {
	lastControls  Controls
	hasLast       bool
	firstInvalid  time.Time
	invalidCount  int
	cooldownUntil time.Time
	strikes       int
}

// DefaultControlConstraints provides the tuned baseline for production traffic.
var DefaultControlConstraints = ControlConstraints{
	Ranges: ControlRanges{
		Throttle: Range{Min: -1.0, Max: 1.0},
		Brake:    Range{Min: 0.0, Max: 1.0},
		Steer:    Range{Min: -1.0, Max: 1.0},
		Gear:     IntRange{Min: -1, Max: 9},
	},
	Deltas: ControlDeltas{
		Throttle: 0.35,
		Brake:    0.50,
		Steer:    0.45,
		Gear:     1,
	},
	InvalidBurstLimit:  5,
	InvalidBurstWindow: time.Second,
	CooldownDuration:   500 * time.Millisecond,
	MaxCooldownStrikes: 3,
}

// WithValidatorClock overrides the clock used to determine cooldown windows.
func WithValidatorClock(clock Clock) ValidatorOption {
	return func(v *Validator) {
		if clock != nil {
			v.clock = clock
		}
	}
}

// WithValidatorLogger injects a logger for diagnostics.
func WithValidatorLogger(logger *logging.Logger) ValidatorOption {
	return func(v *Validator) {
		if logger != nil {
			v.logger = logger
		}
	}
}

// NewValidator builds a validator with the supplied constraints and logger.
func NewValidator(cfg ControlConstraints, logger *logging.Logger, opts ...ValidatorOption) *Validator {
	//1.- Copy the configuration so we can safely mutate defaults.
	if cfg.InvalidBurstLimit <= 0 {
		cfg.InvalidBurstLimit = DefaultControlConstraints.InvalidBurstLimit
	}
	if cfg.InvalidBurstWindow <= 0 {
		cfg.InvalidBurstWindow = DefaultControlConstraints.InvalidBurstWindow
	}
	if cfg.CooldownDuration <= 0 {
		cfg.CooldownDuration = DefaultControlConstraints.CooldownDuration
	}
	if cfg.MaxCooldownStrikes <= 0 {
		cfg.MaxCooldownStrikes = DefaultControlConstraints.MaxCooldownStrikes
	}
	if cfg.Ranges == (ControlRanges{}) {
		cfg.Ranges = DefaultControlConstraints.Ranges
	}
	if cfg.Deltas == (ControlDeltas{}) {
		cfg.Deltas = DefaultControlConstraints.Deltas
	}
	validator := &Validator{
		cfg:     cfg,
		clock:   systemClock{},
		logger:  logger,
		clients: make(map[string]*validatorClientState),
		metrics: make(map[string]ValidationCounters),
	}
	for _, opt := range opts {
		if opt != nil {
			opt(validator)
		}
	}
	if validator.clock == nil {
		validator.clock = systemClock{}
	}
	return validator
}

// Validate checks the supplied controls and records any violations.
func (v *Validator) Validate(clientID, controllerID string, controls Controls) ValidationDecision {
	//2.- Assume acceptance when the validator is absent to reduce call sites.
	if v == nil {
		return ValidationDecision{Accepted: true}
	}
	key := v.key(clientID, controllerID)
	now := v.clock.Now()

	v.mu.Lock()
	defer v.mu.Unlock()

	state := v.ensureStateLocked(key)

	if !state.cooldownUntil.IsZero() && now.Before(state.cooldownUntil) {
		remaining := state.cooldownUntil.Sub(now)
		return ValidationDecision{Accepted: false, Reason: ValidationReasonCooldownActive, Cooldown: remaining}
	}

	if reason := v.checkRangesLocked(controls); reason != ValidationReasonNone {
		return v.registerViolationLocked(key, state, now, reason)
	}
	if state.hasLast {
		if reason := v.checkDeltasLocked(state.lastControls, controls); reason != ValidationReasonNone {
			return v.registerViolationLocked(key, state, now, reason)
		}
	}

	return ValidationDecision{Accepted: true}
}

// Commit marks the supplied controls as accepted, resetting invalid counters.
func (v *Validator) Commit(clientID, controllerID string, controls Controls) {
	if v == nil {
		return
	}
	key := v.key(clientID, controllerID)
	v.mu.Lock()
	state := v.ensureStateLocked(key)
	state.lastControls = controls
	state.hasLast = true
	state.invalidCount = 0
	state.firstInvalid = time.Time{}
	v.mu.Unlock()
}

// Forget clears all state for the specified client.
func (v *Validator) Forget(clientID string) {
	if v == nil || clientID == "" {
		return
	}
	v.mu.Lock()
	for key := range v.clients {
		if v.belongsToClient(key, clientID) {
			delete(v.clients, key)
			delete(v.metrics, key)
		}
	}
	v.mu.Unlock()
}

// Metrics returns a snapshot of per-client counters for diagnostics.
func (v *Validator) Metrics() map[string]ValidationCounters {
	if v == nil {
		return nil
	}
	v.mu.Lock()
	defer v.mu.Unlock()
	if len(v.metrics) == 0 {
		return nil
	}
	snapshot := make(map[string]ValidationCounters, len(v.metrics))
	for key, counters := range v.metrics {
		clone := ValidationCounters{Cooldowns: counters.Cooldowns, Disconnects: counters.Disconnects}
		if len(counters.Violations) > 0 {
			clone.Violations = make(map[ValidationReason]uint64, len(counters.Violations))
			for reason, count := range counters.Violations {
				clone.Violations[reason] = count
			}
		}
		snapshot[key] = clone
	}
	return snapshot
}

func (v *Validator) ensureStateLocked(key string) *validatorClientState {
	state := v.clients[key]
	if state == nil {
		state = &validatorClientState{}
		v.clients[key] = state
	}
	return state
}

func (v *Validator) registerViolationLocked(key string, state *validatorClientState, now time.Time, reason ValidationReason) ValidationDecision {
	counters := v.metrics[key]
	if counters.Violations == nil {
		counters.Violations = make(map[ValidationReason]uint64)
	}
	counters.Violations[reason]++
	v.metrics[key] = counters

	decision := ValidationDecision{Accepted: false, Reason: reason}

	window := v.cfg.InvalidBurstWindow
	limit := v.cfg.InvalidBurstLimit
	if limit > 0 {
		if state.invalidCount == 0 || now.Sub(state.firstInvalid) > window {
			state.firstInvalid = now
			state.invalidCount = 1
		} else {
			state.invalidCount++
		}
		remaining := limit - state.invalidCount
		if remaining <= 1 {
			decision.Warn = remaining == 1
		}
		if state.invalidCount >= limit {
			state.cooldownUntil = now.Add(v.cfg.CooldownDuration)
			state.invalidCount = 0
			state.firstInvalid = time.Time{}
			state.strikes++
			counters = v.metrics[key]
			counters.Cooldowns++
			if state.strikes >= v.cfg.MaxCooldownStrikes {
				decision.Disconnect = true
				counters.Disconnects++
			}
			v.metrics[key] = counters
			decision.Cooldown = v.cfg.CooldownDuration
			if v.logger != nil {
				v.logger.Debug("intent validator cooldown",
					logging.String("key", key),
					logging.String("reason", string(reason)),
					logging.Field{Key: "cooldown_ms", Value: v.cfg.CooldownDuration.Milliseconds()},
				)
			}
		}
	}
	return decision
}

func (v *Validator) checkRangesLocked(controls Controls) ValidationReason {
	//4.- Compare each channel individually to provide actionable feedback.
	if r := v.cfg.Ranges.Throttle; controls.Throttle < r.Min || controls.Throttle > r.Max {
		return ValidationReasonThrottleRange
	}
	if r := v.cfg.Ranges.Brake; controls.Brake < r.Min || controls.Brake > r.Max {
		return ValidationReasonBrakeRange
	}
	if r := v.cfg.Ranges.Steer; controls.Steer < r.Min || controls.Steer > r.Max {
		return ValidationReasonSteerRange
	}
	if r := v.cfg.Ranges.Gear; controls.Gear < r.Min || controls.Gear > r.Max {
		return ValidationReasonGearRange
	}
	return ValidationReasonNone
}

func (v *Validator) checkDeltasLocked(prev, next Controls) ValidationReason {
	//5.- Evaluate delta magnitudes in floating point space with tolerance for rounding.
	if limit := v.cfg.Deltas.Throttle; limit > 0 {
		if math.Abs(next.Throttle-prev.Throttle) > limit+1e-9 {
			return ValidationReasonThrottleDelta
		}
	}
	if limit := v.cfg.Deltas.Brake; limit > 0 {
		if math.Abs(next.Brake-prev.Brake) > limit+1e-9 {
			return ValidationReasonBrakeDelta
		}
	}
	if limit := v.cfg.Deltas.Steer; limit > 0 {
		if math.Abs(next.Steer-prev.Steer) > limit+1e-9 {
			return ValidationReasonSteerDelta
		}
	}
	if limit := v.cfg.Deltas.Gear; limit > 0 {
		if int32(math.Abs(float64(next.Gear-prev.Gear))) > limit {
			return ValidationReasonGearDelta
		}
	}
	return ValidationReasonNone
}

func (v *Validator) key(clientID, controllerID string) string {
	//6.- Build a stable key so multiple controllers on the same websocket stay independent.
	if clientID == "" {
		return controllerID
	}
	if controllerID == "" {
		return clientID
	}
	return fmt.Sprintf("%s|%s", clientID, controllerID)
}

func (v *Validator) belongsToClient(key, clientID string) bool {
	if key == clientID {
		return true
	}
	if len(key) <= len(clientID) || key[:len(clientID)] != clientID {
		return false
	}
	return len(key) > len(clientID) && key[len(clientID)] == '|'
}
