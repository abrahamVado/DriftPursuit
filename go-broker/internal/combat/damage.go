package combat

import (
	"fmt"
	"math"
	"sort"

	"driftpursuit/broker/internal/events"
	"driftpursuit/broker/internal/logging"
)

// DamageSource enumerates the supported origins of combat damage for breakdowns.
type DamageSource string

const (
	// DamageSourceDirect captures weapon projectiles or beams that strike the target.
	DamageSourceDirect DamageSource = "direct"
	// DamageSourceSplash represents radial splash or area-of-effect contributions.
	DamageSourceSplash DamageSource = "splash"
	// DamageSourceCollision accounts for damage caused by terrain or environmental impacts.
	DamageSourceCollision DamageSource = "collision"
)

// DamageProfile describes the configurable magnitudes used by the resolver.
type DamageProfile struct {
	//1.- DirectDamage applies when DirectHit is true in the impact context.
	DirectDamage float64
	//2.- SplashDamage is the maximum splash value applied at the impact epicentre.
	SplashDamage float64
	//3.- SplashRadius defines the maximum radius in meters for splash falloff calculations.
	SplashRadius float64
	//4.- SplashFalloffExponent tunes how aggressively splash damage fades with distance.
	SplashFalloffExponent float64
	//5.- CollisionScale converts post-threshold impact speed into damage units.
	CollisionScale float64
	//6.- CollisionThresholdMps sets the minimum speed required before collision damage accrues.
	CollisionThresholdMps float64
}

// ImpactContext captures the runtime parameters required to resolve a hit.
type ImpactContext struct {
	//1.- DirectHit flags that the projectile or beam intersected the target directly.
	DirectHit bool
	//2.- DistanceMeters conveys the separation between the splash epicentre and target.
	DistanceMeters float64
	//3.- ImpactSpeedMps communicates the relative impact speed against the environment.
	ImpactSpeedMps float64
	//4.- TerrainHardness scales collision damage to represent softer or harder surfaces.
	TerrainHardness float64
}

// DamageResult collates the resolved totals alongside metadata helpers.
type DamageResult struct {
	//1.- TotalDamage provides the aggregate damage value combining all sources.
	TotalDamage float64
	//2.- Breakdown exposes the per-source contribution used by HUDs and logs.
	Breakdown map[DamageSource]float64
	//3.- InstantDestroy reports whether the impact mandates immediate destruction.
	InstantDestroy bool
}

const instantKillSpeedThreshold = 30.0

// ResolveDamage evaluates the configured profile against the impact context and returns the breakdown.
func ResolveDamage(profile DamageProfile, ctx ImpactContext) DamageResult {
	//1.- Allocate the breakdown map lazily so zero-damage contexts remain empty.
	breakdown := make(map[DamageSource]float64, 3)

	if profile.DirectDamage > 0 && ctx.DirectHit {
		breakdown[DamageSourceDirect] = profile.DirectDamage
	}

	if profile.SplashDamage > 0 && profile.SplashRadius > 0 {
		distance := ctx.DistanceMeters
		if !(distance > 0) {
			distance = 0
		}
		if distance <= profile.SplashRadius {
			normalized := distance / profile.SplashRadius
			if normalized < 0 {
				normalized = 0
			} else if normalized > 1 {
				normalized = 1
			}
			falloffExponent := profile.SplashFalloffExponent
			if !(falloffExponent > 0) {
				falloffExponent = 1
			}
			multiplier := math.Pow(1-normalized, falloffExponent)
			if multiplier > 0 {
				breakdown[DamageSourceSplash] = profile.SplashDamage * multiplier
			}
		}
	}

	if profile.CollisionScale > 0 && ctx.ImpactSpeedMps > 0 && ctx.TerrainHardness > 0 {
		overSpeed := ctx.ImpactSpeedMps - profile.CollisionThresholdMps
		if overSpeed < 0 {
			overSpeed = 0
		}
		if overSpeed > 0 {
			hardness := ctx.TerrainHardness
			if hardness < 0 {
				hardness = 0
			}
			collisionDamage := overSpeed * profile.CollisionScale * hardness
			if collisionDamage > 0 {
				breakdown[DamageSourceCollision] = collisionDamage
			}
		}
	}

	total := 0.0
	for _, value := range breakdown {
		total += value
	}

	//2.- Instant destruction triggers when the impact speed crosses the configured threshold.
	instant := ctx.ImpactSpeedMps >= instantKillSpeedThreshold

	return DamageResult{TotalDamage: total, Breakdown: breakdown, InstantDestroy: instant}
}

// AttachMetadata merges the per-source breakdown into the provided metadata map using stable keys.
func (r DamageResult) AttachMetadata(metadata map[string]string) map[string]string {
	//1.- Clone the input map so callers keep ownership of their original reference.
	clone := make(map[string]string, len(metadata)+len(r.Breakdown)+3)
	for key, value := range metadata {
		clone[key] = value
	}

	//2.- Emit deterministic keys to simplify HUD rendering and log inspection.
	sources := make([]DamageSource, 0, len(r.Breakdown))
	for source := range r.Breakdown {
		sources = append(sources, source)
	}
	sort.Slice(sources, func(i, j int) bool { return sources[i] < sources[j] })
	for _, source := range sources {
		amount := r.Breakdown[source]
		clone[fmt.Sprintf("damage_%s", source)] = formatDamageValue(amount)
	}

	clone["damage_total"] = formatDamageValue(r.TotalDamage)
	clone["damage_instant_kill"] = fmt.Sprintf("%t", r.InstantDestroy)
	return clone
}

// LoggingFields returns structured logging fields describing the resolved damage.
func (r DamageResult) LoggingFields() []logging.Field {
	//1.- Collect per-source entries to maintain deterministic ordering in logs.
	keys := make([]DamageSource, 0, len(r.Breakdown))
	for source := range r.Breakdown {
		keys = append(keys, source)
	}
	sort.Slice(keys, func(i, j int) bool { return keys[i] < keys[j] })

	fields := make([]logging.Field, 0, len(keys)+2)
	for _, source := range keys {
		fields = append(fields, logging.Field{Key: fmt.Sprintf("damage_%s", source), Value: r.Breakdown[source]})
	}
	fields = append(fields, logging.Field{Key: "damage_total", Value: r.TotalDamage})
	fields = append(fields, logging.Bool("damage_instant_kill", r.InstantDestroy))
	return fields
}

// ApplyToTelemetry copies the damage totals and metadata onto the provided telemetry snapshot.
func (r DamageResult) ApplyToTelemetry(telemetry *events.CombatTelemetry, damageType string) {
	if telemetry == nil {
		return
	}
	//1.- Update the numeric damage summary delivered to clients.
	telemetry.Damage.Amount = r.TotalDamage
	telemetry.Damage.Type = damageType
	telemetry.Damage.Critical = r.InstantDestroy
	//2.- Merge the per-source breakdown into the metadata channel for HUD consumption.
	telemetry.Metadata = r.AttachMetadata(telemetry.Metadata)
}

func formatDamageValue(amount float64) string {
	//1.- Clamp extremely small floating point noise to zero for readability.
	if math.Abs(amount) < 1e-6 {
		amount = 0
	}
	return fmt.Sprintf("%.2f", amount)
}
