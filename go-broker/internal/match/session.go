package match

import (
	"errors"
	"fmt"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	envMatchID         = "BROKER_MATCH_ID"
	envMatchMinPlayers = "BROKER_MATCH_MIN_PLAYERS"
	envMatchMaxPlayers = "BROKER_MATCH_MAX_PLAYERS"
)

var (
	// ErrInvalidPlayerID is returned when a join request omits the participant identifier.
	ErrInvalidPlayerID = errors.New("player id must not be empty")
	// ErrMatchFull indicates that the session has reached the configured capacity limit.
	ErrMatchFull = errors.New("match capacity reached")
	// ErrInvalidCapacity is returned when capacity updates violate basic invariants.
	ErrInvalidCapacity = errors.New("invalid match capacity configuration")
)

// Capacity expresses the configured participant limits for a match session.
type Capacity struct {
	MinPlayers int `json:"min_players"`
	MaxPlayers int `json:"max_players"`
}

// Snapshot captures a stable view of the match session state for observers.
type Snapshot struct {
	MatchID       string   `json:"match_id"`
	Capacity      Capacity `json:"capacity"`
	ActivePlayers []string `json:"active_players"`
}

// SessionOption configures optional Session behaviour at construction time.
type SessionOption func(*Session)

// Session maintains the lifecycle of a persistent match instance.
type Session struct {
	mu sync.RWMutex

	id        string
	capacity  Capacity
	players   map[string]time.Time
	now       func() time.Time
	envLookup func(string) string

	idConfigured  bool
	capConfigured bool
}

// WithSessionClock overrides the default wall-clock time source.
func WithSessionClock(clock func() time.Time) SessionOption {
	return func(s *Session) {
		//1.- Allow tests to inject a deterministic time source for reproducibility.
		if clock != nil {
			s.now = clock
		}
	}
}

// WithSessionEnvLookup injects a custom environment variable lookup mechanism.
func WithSessionEnvLookup(lookup func(string) string) SessionOption {
	return func(s *Session) {
		//1.- Swap the environment lookup so tests can provide deterministic values.
		s.envLookup = lookup
	}
}

// WithSessionMatchID sets the identifier used for the persistent match instance.
func WithSessionMatchID(id string) SessionOption {
	return func(s *Session) {
		trimmed := strings.TrimSpace(id)
		if trimmed == "" {
			return
		}
		//1.- Record the supplied match identifier and mark it as explicit configuration.
		s.id = trimmed
		s.idConfigured = true
	}
}

// WithSessionCapacity configures the session capacity explicitly, bypassing environment parsing.
func WithSessionCapacity(cap Capacity) SessionOption {
	return func(s *Session) {
		//1.- Apply the provided capacity bounds and mark them as caller supplied.
		s.capacity = cap
		s.capConfigured = true
	}
}

// NewSession constructs a persistent match session using environment defaults when available.
func NewSession(opts ...SessionOption) (*Session, error) {
	session := &Session{
		players:   make(map[string]time.Time),
		now:       time.Now,
		envLookup: os.Getenv,
	}
	//1.- Apply any caller supplied functional options prior to reading the environment.
	for _, opt := range opts {
		if opt != nil {
			opt(session)
		}
	}
	//2.- Populate configuration from the environment when the caller did not override values.
	if err := session.applyEnvironment(); err != nil {
		return nil, err
	}
	//3.- Ensure a deterministic identifier exists for downstream replay or telemetry.
	if strings.TrimSpace(session.id) == "" {
		session.id = session.defaultIdentifier()
	}
	//4.- Validate the resolved capacity so subsequent joins enforce coherent limits.
	if err := session.validateCapacity(session.capacity); err != nil {
		return nil, err
	}
	return session, nil
}

// Join registers a participant with the match session, enforcing capacity constraints.
func (s *Session) Join(playerID string) (Snapshot, error) {
	if s == nil {
		return Snapshot{}, fmt.Errorf("session is nil")
	}
	trimmed := strings.TrimSpace(playerID)
	if trimmed == "" {
		return Snapshot{}, ErrInvalidPlayerID
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	//1.- Reject new players when the session already holds the maximum number of participants.
	if _, exists := s.players[trimmed]; !exists {
		if s.capacity.MaxPlayers > 0 && len(s.players) >= s.capacity.MaxPlayers {
			return Snapshot{}, ErrMatchFull
		}
	}
	//2.- Track the latest join timestamp so reconnects refresh the participant heartbeat.
	s.players[trimmed] = s.now()
	return s.snapshotLocked(), nil
}

// Leave removes a participant from the match session while preserving overall state.
func (s *Session) Leave(playerID string) Snapshot {
	if s == nil {
		return Snapshot{}
	}
	trimmed := strings.TrimSpace(playerID)
	if trimmed == "" {
		return s.Snapshot()
	}
	s.mu.Lock()
	delete(s.players, trimmed)
	//1.- Emit a snapshot reflecting the updated participant roster.
	snapshot := s.snapshotLocked()
	s.mu.Unlock()
	return snapshot
}

// Snapshot returns a read-only view of the current match session state.
func (s *Session) Snapshot() Snapshot {
	if s == nil {
		return Snapshot{}
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.snapshotLocked()
}

// AdjustCapacity safely mutates the capacity bounds while guarding active participants.
func (s *Session) AdjustCapacity(minPlayers, maxPlayers int) (Snapshot, error) {
	if s == nil {
		return Snapshot{}, fmt.Errorf("session is nil")
	}
	proposed := Capacity{MinPlayers: minPlayers, MaxPlayers: maxPlayers}
	//1.- Validate the requested capacity before taking the write lock to fail fast.
	if err := s.validateCapacity(proposed); err != nil {
		return Snapshot{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	//2.- Ensure the new maximum does not evict already active participants.
	if proposed.MaxPlayers > 0 && len(s.players) > proposed.MaxPlayers {
		return Snapshot{}, fmt.Errorf("%w: %d active players exceed max %d", ErrInvalidCapacity, len(s.players), proposed.MaxPlayers)
	}
	s.capacity = proposed
	return s.snapshotLocked(), nil
}

func (s *Session) applyEnvironment() error {
	if s == nil {
		return nil
	}
	lookup := s.envLookup
	if lookup == nil {
		return nil
	}
	if !s.idConfigured {
		if id := strings.TrimSpace(lookup(envMatchID)); id != "" {
			//1.- Honour the configured match identifier from the environment.
			s.id = id
			s.idConfigured = true
		}
	}
	if s.capConfigured {
		return nil
	}
	var (
		minSet bool
		maxSet bool
	)
	if raw := strings.TrimSpace(lookup(envMatchMinPlayers)); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil {
			return fmt.Errorf("%w: BROKER_MATCH_MIN_PLAYERS=%q", ErrInvalidCapacity, raw)
		}
		s.capacity.MinPlayers = value
		minSet = true
	}
	if raw := strings.TrimSpace(lookup(envMatchMaxPlayers)); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil {
			return fmt.Errorf("%w: BROKER_MATCH_MAX_PLAYERS=%q", ErrInvalidCapacity, raw)
		}
		s.capacity.MaxPlayers = value
		maxSet = true
	}
	if minSet || maxSet {
		//1.- Flag that the environment supplied at least one bound so subsequent calls skip overrides.
		s.capConfigured = true
	}
	return nil
}

func (s *Session) snapshotLocked() Snapshot {
	snapshot := Snapshot{MatchID: s.id, Capacity: s.capacity}
	if len(s.players) == 0 {
		return snapshot
	}
	snapshot.ActivePlayers = make([]string, 0, len(s.players))
	for id := range s.players {
		snapshot.ActivePlayers = append(snapshot.ActivePlayers, id)
	}
	//1.- Sort identifiers to guarantee deterministic payloads for consumers and tests.
	sort.Strings(snapshot.ActivePlayers)
	return snapshot
}

func (s *Session) defaultIdentifier() string {
	timestamp := ""
	if s.now != nil {
		timestamp = s.now().UTC().Format("match-20060102T150405")
	}
	if strings.TrimSpace(timestamp) == "" {
		//1.- Provide a predictable fallback when the clock is unavailable.
		return "match"
	}
	return timestamp
}

func (s *Session) validateCapacity(cap Capacity) error {
	if cap.MinPlayers < 0 {
		return fmt.Errorf("%w: minimum players must be non-negative", ErrInvalidCapacity)
	}
	if cap.MaxPlayers < 0 {
		return fmt.Errorf("%w: maximum players must be non-negative", ErrInvalidCapacity)
	}
	if cap.MaxPlayers > 0 && cap.MaxPlayers < cap.MinPlayers {
		return fmt.Errorf("%w: max %d is less than min %d", ErrInvalidCapacity, cap.MaxPlayers, cap.MinPlayers)
	}
	return nil
}
