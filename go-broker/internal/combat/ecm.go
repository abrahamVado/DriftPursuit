package combat

import (
	"crypto/sha256"
	"encoding/binary"
	"math"
	"math/rand"
	"sync"
	"time"
)

// SeedForOutcome derives a deterministic RNG seed for ECM interactions.
func SeedForOutcome(matchSeed, missileID, targetID string) int64 {
	//1.- Hash the inputs with separators so each identifier influences the result independently.
	digest := sha256.Sum256([]byte("combat.ecm\x00" + matchSeed + "\x00" + missileID + "\x00" + targetID))
	//2.- Convert the first eight bytes into a signed integer seed for math/rand.
	seed := int64(binary.LittleEndian.Uint64(digest[0:8]))
	if seed == 0 {
		seed = int64(binary.LittleEndian.Uint64(digest[8:16]))
	}
	if seed == 0 {
		seed = 1
	}
	return seed
}

// newECMRand builds a deterministic PRNG bound to the provided ECM tuple.
func newECMRand(matchSeed, missileID, targetID string) *rand.Rand {
	//1.- Use the stable seed so that every replay reproduces the same random stream.
	seed := SeedForOutcome(matchSeed, missileID, targetID)
	//2.- Create a new PRNG instance to avoid cross-talk between concurrent rolls.
	return rand.New(rand.NewSource(seed))
}

// ShouldDecoyBreak resolves whether a decoy spoofs the missile guidance.
func ShouldDecoyBreak(matchSeed, missileID, targetID string, breakProbability float64) bool {
	//1.- Clamp invalid probabilities so deterministic replays never panic or misbehave.
	if math.IsNaN(breakProbability) {
		return false
	}
	if breakProbability < 0 {
		breakProbability = 0
	} else if breakProbability > 1 {
		breakProbability = 1
	}
	if breakProbability == 0 {
		return false
	}
	if breakProbability == 1 {
		return true
	}
	//2.- Pull a deterministic roll from the seeded PRNG and compare to the threshold.
	rng := newECMRand(matchSeed, missileID, targetID)
	roll := rng.Float64()
	return roll < breakProbability
}

const (
	defaultECMInitialProbability = 0.65
	defaultECMFinalProbability   = 0.20
)

var (
	defaultECMInitialDuration = 1500 * time.Millisecond
	defaultECMTotalDuration   = 3 * time.Second
)

// ECMProbabilityWindow describes how spoof probabilities evolve during an engagement.
type ECMProbabilityWindow struct {
	InitialProbability float64
	InitialDuration    time.Duration
	FinalProbability   float64
	TotalDuration      time.Duration
}

// DefaultECMProbabilityWindow returns the shared 65% to 20% decay profile over three seconds.
func DefaultECMProbabilityWindow() ECMProbabilityWindow {
	//1.- Provide the tuned defaults mirroring the bot interface timeline.
	return ECMProbabilityWindow{
		InitialProbability: defaultECMInitialProbability,
		InitialDuration:    defaultECMInitialDuration,
		FinalProbability:   defaultECMFinalProbability,
		TotalDuration:      defaultECMTotalDuration,
	}
}

// ProbabilityAt resolves the interpolated spoof probability for the provided elapsed time.
func (w ECMProbabilityWindow) ProbabilityAt(elapsed time.Duration) float64 {
	//1.- Normalise invalid durations so callers cannot trigger negative time windows.
	if elapsed < 0 {
		elapsed = 0
	}
	window := w.normalised()
	start := clampProbability(window.InitialProbability)
	end := clampProbability(window.FinalProbability)
	//2.- Before the plateau expires the probability remains at the initial level.
	if window.InitialDuration > 0 && elapsed <= window.InitialDuration {
		return start
	}
	//3.- After the total window the probability stabilises at the configured final value.
	if window.TotalDuration <= 0 || elapsed >= window.TotalDuration {
		return end
	}
	span := window.TotalDuration - window.InitialDuration
	if span <= 0 {
		return end
	}
	progress := float64(elapsed-window.InitialDuration) / float64(span)
	if progress < 0 {
		progress = 0
	} else if progress > 1 {
		progress = 1
	}
	probability := start + (end-start)*progress
	return clampProbability(probability)
}

// normalised guards the window against invalid durations to keep interpolation stable.
func (w ECMProbabilityWindow) normalised() ECMProbabilityWindow {
	//1.- Ensure durations are non-negative so interpolation math remains sane.
	if w.InitialDuration < 0 {
		w.InitialDuration = 0
	}
	if w.TotalDuration < 0 {
		w.TotalDuration = 0
	}
	//2.- Guarantee the total duration is at least as long as the plateau.
	if w.TotalDuration != 0 && w.TotalDuration < w.InitialDuration {
		w.TotalDuration = w.InitialDuration
	}
	return w
}

// MissileECMTracker stores deterministic RNG streams per missile engagement.
type MissileECMTracker struct {
	mu     sync.Mutex
	states map[string]*missileECMState
}

// missileECMState captures the evolving spoof context for a single missile.
type missileECMState struct {
	rng         *rand.Rand
	window      ECMProbabilityWindow
	lastElapsed time.Duration
	lastOutcome bool
	hasOutcome  bool
	spoofed     bool
}

// NewMissileECMTracker constructs an empty tracker ready to service missile timelines.
func NewMissileECMTracker() *MissileECMTracker {
	//1.- Prepare the backing store lazily so tests can reset state between runs.
	return &MissileECMTracker{states: make(map[string]*missileECMState)}
}

// Resolve applies the probability window for the missile at the provided elapsed time.
func (t *MissileECMTracker) Resolve(matchSeed, missileID, targetID string, elapsed time.Duration, window ECMProbabilityWindow) bool {
	//1.- Bail out early when identifiers are missing or the window carries no chance to spoof.
	if matchSeed == "" || missileID == "" || targetID == "" {
		return false
	}
	if window.InitialProbability <= 0 && window.FinalProbability <= 0 {
		return false
	}
	key := missileECMKey(matchSeed, missileID, targetID)
	t.mu.Lock()
	defer t.mu.Unlock()
	state, ok := t.states[key]
	if !ok {
		//2.- Lazily create the RNG so each missile follows its own deterministic stream.
		state = &missileECMState{
			rng:    newECMRand(matchSeed, missileID, targetID),
			window: window.normalised(),
		}
		t.states[key] = state
	}
	return state.evaluate(elapsed)
}

// Release discards the stored state for the missile once its engagement concludes.
func (t *MissileECMTracker) Release(matchSeed, missileID, targetID string) {
	//1.- Remove the missile entry so repeated engagements restart from the original seed.
	key := missileECMKey(matchSeed, missileID, targetID)
	t.mu.Lock()
	delete(t.states, key)
	t.mu.Unlock()
}

// Reset clears every tracked missile, primarily for deterministic test harnesses.
func (t *MissileECMTracker) Reset() {
	//1.- Replace the state map with a fresh instance to drop all cached RNG streams.
	t.mu.Lock()
	t.states = make(map[string]*missileECMState)
	t.mu.Unlock()
}

// evaluate advances the deterministic RNG when a new elapsed timestamp is requested.
func (s *missileECMState) evaluate(elapsed time.Duration) bool {
	//1.- Once spoofed the missile remains spoofed regardless of later evaluations.
	if s.spoofed {
		s.lastOutcome = true
		if elapsed > s.lastElapsed {
			s.lastElapsed = elapsed
		}
		s.hasOutcome = true
		return true
	}
	if elapsed < 0 {
		elapsed = 0
	}
	//2.- Replaying an earlier or identical timestamp reuses the cached deterministic result.
	if s.hasOutcome && elapsed <= s.lastElapsed {
		return s.lastOutcome
	}
	probability := s.window.ProbabilityAt(elapsed)
	if probability <= 0 {
		s.lastElapsed = elapsed
		s.lastOutcome = false
		s.hasOutcome = true
		return false
	}
	//3.- Consume the next roll from the seeded RNG to decide the spoof outcome.
	roll := s.rng.Float64()
	if roll < probability {
		s.spoofed = true
		s.lastOutcome = true
	} else {
		s.lastOutcome = false
	}
	s.lastElapsed = elapsed
	s.hasOutcome = true
	return s.lastOutcome
}

// missileECMKey derives the composite key used to store state per missile engagement.
func missileECMKey(matchSeed, missileID, targetID string) string {
	//1.- Join identifiers with a separator so collisions remain impossible within the tracker.
	return matchSeed + "\x00" + missileID + "\x00" + targetID
}
