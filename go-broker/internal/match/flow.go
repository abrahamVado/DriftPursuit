package match

import (
	"errors"
	"math"
	"time"

	pb "driftpursuit/broker/internal/proto/pb"
)

// ErrNoSafeRings signals that the flow cannot respawn without configured rings.
var ErrNoSafeRings = errors.New("no safe rings configured")

// SafeVolume enumerates a spawn volume aligned along the ring trajectory.
type SafeVolume struct {
	Center *pb.Vector3
	Radius float64
}

// SafeRing describes a respawn anchor with a stable identifier for telemetry.
type SafeRing struct {
	ID       string
	Position *pb.Vector3
	Volumes  []SafeVolume
}

// DefaultSpawnShieldDuration expresses how long respawn shields last unless overridden.
const DefaultSpawnShieldDuration = 1500 * time.Millisecond

const safeVolumeProbeDistance = 300.0

// Flow coordinates respawn timing and destination selection for vehicles.
type Flow struct {
	rings        []SafeRing
	respawnDelay time.Duration
	shieldDelay  time.Duration
	now          func() time.Time
	deaths       map[string]time.Time
	shields      map[string]time.Time
}

// Option configures optional flow parameters at construction time.
type Option func(*Flow)

// WithRespawnDelay overrides the default respawn delay duration.
func WithRespawnDelay(delay time.Duration) Option {
	return func(f *Flow) {
		//1.- Use the provided duration when calculating respawn readiness.
		if delay > 0 {
			f.respawnDelay = delay
		}
	}
}

// WithSpawnShieldDuration overrides the default spawn protection duration.
func WithSpawnShieldDuration(duration time.Duration) Option {
	return func(f *Flow) {
		//1.- Clamp the configured shield duration so zero disables protection.
		if duration >= 0 {
			f.shieldDelay = duration
		}
	}
}

// WithClock injects a deterministic clock, primarily for tests.
func WithClock(clock func() time.Time) Option {
	return func(f *Flow) {
		//1.- Replace the default time.Now reference with the supplied clock.
		if clock != nil {
			f.now = clock
		}
	}
}

// NewFlow constructs a match flow controller with a three second default delay.
func NewFlow(rings []SafeRing, opts ...Option) *Flow {
	//1.- Seed the structure with the default three second respawn delay.
	flow := &Flow{
		rings:        cloneRings(rings),
		respawnDelay: 3 * time.Second,
		shieldDelay:  DefaultSpawnShieldDuration,
		now:          time.Now,
		deaths:       make(map[string]time.Time),
		shields:      make(map[string]time.Time),
	}
	//2.- Apply the functional options to customize timing or the clock source.
	for _, opt := range opts {
		if opt != nil {
			opt(flow)
		}
	}
	return flow
}

// RegisterElimination marks when a vehicle has been eliminated.
func (f *Flow) RegisterElimination(vehicleID string) {
	if f == nil || vehicleID == "" {
		return
	}
	//1.- Record the elimination timestamp for subsequent delay calculations.
	f.deaths[vehicleID] = f.now()
}

// RespawnETA reports the remaining duration before a vehicle can respawn.
func (f *Flow) RespawnETA(vehicleID string) time.Duration {
	if f == nil || vehicleID == "" {
		return 0
	}
	//1.- Look up the elimination timestamp and short-circuit if none exists.
	eliminatedAt, ok := f.deaths[vehicleID]
	if !ok {
		return 0
	}
	//2.- Compute the elapsed time and clamp the remaining delay at zero.
	elapsed := f.now().Sub(eliminatedAt)
	remaining := f.respawnDelay - elapsed
	if remaining < 0 {
		return 0
	}
	return remaining
}

// ClearRespawn clears state for vehicles that have successfully respawned.
func (f *Flow) ClearRespawn(vehicleID string) {
	if f == nil || vehicleID == "" {
		return
	}
	//1.- Remove the elimination marker so subsequent checks return immediately.
	delete(f.deaths, vehicleID)
	//2.- Activate the spawn shield when a positive protection window is configured.
	if f.shieldDelay > 0 {
		f.shields[vehicleID] = f.now().Add(f.shieldDelay)
	} else {
		delete(f.shields, vehicleID)
	}
}

// SpawnShieldRemaining reports how much protection time remains for the vehicle.
func (f *Flow) SpawnShieldRemaining(vehicleID string) time.Duration {
	if f == nil || vehicleID == "" {
		return 0
	}
	//1.- Look up the shield expiry and prune expired windows eagerly.
	expiry, ok := f.shields[vehicleID]
	if !ok {
		return 0
	}
	remaining := expiry.Sub(f.now())
	if remaining <= 0 {
		delete(f.shields, vehicleID)
		return 0
	}
	return remaining
}

// SelectSafeRing chooses the nearest safe ring positioned in front of the vehicle.
func (f *Flow) SelectSafeRing(position, forward *pb.Vector3) (SafeRing, error) {
	//1.- Validate that rings exist before performing any geometric computations.
	if f == nil || len(f.rings) == 0 {
		return SafeRing{}, ErrNoSafeRings
	}
	//2.- Normalize the forward vector to decide whether a ring lies ahead.
	fx, fy, fz := vectorComponents(forward)
	forwardMag := math.Sqrt(fx*fx + fy*fy + fz*fz)
	aheadOnly := forwardMag > 1e-6
	if aheadOnly {
		invMag := 1.0 / forwardMag
		fx *= invMag
		fy *= invMag
		fz *= invMag
	}
	//3.- Evaluate the rings, preferring those with a positive dot product.
	var (
		bestAhead     SafeRing
		bestAheadDist = math.MaxFloat64
		bestAny       SafeRing
		bestAnyDist   = math.MaxFloat64
	)
	px, py, pz := vectorComponents(position)
	for _, ring := range f.rings {
		if !ringHasProbeVolume(ring, forward) {
			//1.- Skip rings that lack nearby safe volumes for late joiners.
			continue
		}
		rx, ry, rz := vectorComponents(ring.Position)
		dx := rx - px
		dy := ry - py
		dz := rz - pz
		distance := dx*dx + dy*dy + dz*dz
		dot := dx*fx + dy*fy + dz*fz
		if aheadOnly && dot <= 0 {
			if distance < bestAnyDist {
				//1.- Track the overall nearest ring for fallbacks when none lie ahead.
				bestAny = ring
				bestAnyDist = distance
			}
			continue
		}
		if distance < bestAheadDist {
			//2.- Update the ahead candidate when the distance shrinks.
			bestAhead = ring
			bestAheadDist = distance
		}
		if distance < bestAnyDist {
			//3.- Keep the overall nearest for the zero forward vector scenario.
			bestAny = ring
			bestAnyDist = distance
		}
	}
	//4.- Return the ahead candidate when available, otherwise fall back.
	if bestAheadDist < math.MaxFloat64 {
		return bestAhead, nil
	}
	if bestAnyDist < math.MaxFloat64 {
		return bestAny, nil
	}
	return SafeRing{}, ErrNoSafeRings
}

// vectorComponents safely extracts coordinates from optional protobuf vectors.
func vectorComponents(v *pb.Vector3) (float64, float64, float64) {
	if v == nil {
		return 0, 0, 0
	}
	return v.GetX(), v.GetY(), v.GetZ()
}

func cloneRings(rings []SafeRing) []SafeRing {
	if len(rings) == 0 {
		return nil
	}
	//1.- Allocate a fresh slice and deep copy safe volumes to avoid aliasing.
	clones := make([]SafeRing, len(rings))
	for i, ring := range rings {
		clone := ring
		if len(ring.Volumes) > 0 {
			clone.Volumes = append([]SafeVolume(nil), ring.Volumes...)
		}
		clones[i] = clone
	}
	return clones
}

func ringHasProbeVolume(ring SafeRing, forward *pb.Vector3) bool {
	if len(ring.Volumes) == 0 {
		return false
	}
	fx, fy, fz := vectorComponents(forward)
	magnitude := math.Sqrt(fx*fx + fy*fy + fz*fz)
	normalized := magnitude > 1e-6
	if normalized {
		inv := 1.0 / magnitude
		fx *= inv
		fy *= inv
		fz *= inv
	}
	rx, ry, rz := vectorComponents(ring.Position)
	for _, volume := range ring.Volumes {
		vx, vy, vz := vectorComponents(volume.Center)
		dx := vx - rx
		dy := vy - ry
		dz := vz - rz
		if normalized {
			projection := dx*fx + dy*fy + dz*fz
			if math.Abs(projection) <= safeVolumeProbeDistance {
				return true
			}
			continue
		}
		distance := math.Sqrt(dx*dx + dy*dy + dz*dz)
		if distance <= safeVolumeProbeDistance {
			return true
		}
	}
	return false
}
