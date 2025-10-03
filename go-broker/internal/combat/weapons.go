package combat

import (
	"errors"
	"math"
	"time"
)

// WeaponBehaviour merges archetype defaults with per-weapon overrides for runtime use.
type WeaponBehaviour struct {
	ID                    string
	Archetype             WeaponArchetype
	Cooldown              time.Duration
	Damage                float64
	ProjectileSpeed       float64
	ProjectileLifetime    time.Duration
	BeamDuration          time.Duration
	MuzzleEffect          string
	ImpactEffect          string
	TrailEffect           string
	BeamEffect            string
	DecoyBreakProbability float64
}

// WeaponRequest describes a weapon trigger initiated by a player or bot.
type WeaponRequest struct {
	WeaponID                      string
	MatchSeed                     string
	ProjectileID                  string
	TargetID                      string
	DistanceMeters                float64
	DecoyActive                   bool
	DecoyBreakProbabilityOverride *float64
}

// WeaponEvent captures the resolved behaviour for a weapon trigger.
type WeaponEvent struct {
	Behaviour      WeaponBehaviour
	TravelTime     time.Duration
	BeamDuration   time.Duration
	MissileSpoofed bool
	DecoyTriggered bool
}

// DecoyEvent describes a decoy activation window available to missile handlers.
type DecoyEvent struct {
	Duration         time.Duration
	BreakProbability float64
}

// ResolveWeaponBehaviour returns the merged behaviour for the provided weapon identifier.
func ResolveWeaponBehaviour(weaponID string) (WeaponBehaviour, error) {
	catalog := WeaponBalance()
	variant, ok := catalog.Weapons[weaponID]
	if !ok {
		return WeaponBehaviour{}, errors.New("unknown weapon identifier")
	}
	base, ok := catalog.Archetypes[string(variant.Archetype)]
	if !ok {
		return WeaponBehaviour{}, errors.New("missing archetype configuration")
	}

	behaviour := WeaponBehaviour{ID: weaponID, Archetype: variant.Archetype}
	behaviour.Cooldown = durationFromSeconds(pickFloat(base.CooldownSeconds, variant.CooldownSeconds, true))
	behaviour.ProjectileSpeed = pickFloat(base.ProjectileSpeed, variant.ProjectileSpeed, false)
	behaviour.ProjectileLifetime = durationFromSeconds(pickFloat(base.ProjectileLifetimeSeconds, variant.ProjectileLifetimeSeconds, false))
	behaviour.BeamDuration = durationFromSeconds(pickFloat(base.BeamDurationSeconds, variant.BeamDurationSeconds, false))
	behaviour.Damage = pickFloat(base.Damage, variant.Damage, false)
	behaviour.MuzzleEffect = pickString(base.MuzzleEffect, variant.MuzzleEffect)
	behaviour.ImpactEffect = pickString(base.ImpactEffect, variant.ImpactEffect)
	behaviour.TrailEffect = pickString(base.TrailEffect, variant.TrailEffect)
	behaviour.BeamEffect = pickString(base.BeamEffect, variant.BeamEffect)
	behaviour.DecoyBreakProbability = clampProbability(pickFloat(base.DecoyBreakProbability, variant.DecoyBreakProbability, true))
	return behaviour, nil
}

// HandleWeaponFire evaluates the appropriate weapon handler based on the resolved archetype.
func HandleWeaponFire(req WeaponRequest) (WeaponEvent, error) {
	behaviour, err := ResolveWeaponBehaviour(req.WeaponID)
	if err != nil {
		return WeaponEvent{}, err
	}
	switch behaviour.Archetype {
	case WeaponArchetypeShell:
		return handleShellFire(req, behaviour), nil
	case WeaponArchetypeMissile:
		return handleMissileFire(req, behaviour), nil
	case WeaponArchetypeLaser:
		return handleLaserFire(req, behaviour), nil
	default:
		return WeaponEvent{}, errors.New("unsupported weapon archetype")
	}
}

// HandleDecoyActivation generates the decoy activation window based on balance configuration.
func HandleDecoyActivation() DecoyEvent {
	balance := DecoyBalance()
	//1.- Convert the configured activation window from seconds to a duration.
	duration := durationFromSeconds(balance.ActivationDurationSeconds)
	//2.- Clamp the probability so missile handlers operate with safe values.
	probability := clampProbability(balance.BreakProbability)
	return DecoyEvent{Duration: duration, BreakProbability: probability}
}

// TriggerBotWeapon exposes a simplified surface for bot controllers to fire weapons.
func TriggerBotWeapon(req WeaponRequest) (WeaponEvent, error) {
	//1.- Delegate to HandleWeaponFire so bot triggers share the same deterministic flow as players.
	event, err := HandleWeaponFire(req)
	if err != nil {
		return WeaponEvent{}, err
	}
	//2.- Mark the trigger as bot-driven so downstream telemetry can attribute the source if desired.
	event.DecoyTriggered = event.DecoyTriggered || req.DecoyActive
	return event, nil
}

// TriggerBotDecoy allows bot controllers to activate decoys using shared balance values.
func TriggerBotDecoy() DecoyEvent {
	//1.- Bots use the same decoy pipeline so they respect match balance tuning.
	return HandleDecoyActivation()
}

func handleShellFire(req WeaponRequest, behaviour WeaponBehaviour) WeaponEvent {
	//1.- Shells are ballistic; compute flight time using the configured projectile speed.
	travel := projectileTravelTime(req.DistanceMeters, behaviour.ProjectileSpeed)
	return WeaponEvent{Behaviour: behaviour, TravelTime: travel}
}

func handleMissileFire(req WeaponRequest, behaviour WeaponBehaviour) WeaponEvent {
	//1.- Missiles spawn projectiles so compute travel time identical to shells.
	travel := projectileTravelTime(req.DistanceMeters, behaviour.ProjectileSpeed)
	//2.- Determine whether an active decoy spoofs the missile guidance.
	probability := behaviour.DecoyBreakProbability
	if req.DecoyBreakProbabilityOverride != nil {
		probability = clampProbability(*req.DecoyBreakProbabilityOverride)
	}
	decoyTriggered := req.DecoyActive && probability > 0
	spoofed := false
	if decoyTriggered && req.MatchSeed != "" && req.ProjectileID != "" && req.TargetID != "" {
		spoofed = ShouldDecoyBreak(req.MatchSeed, req.ProjectileID, req.TargetID, probability)
	}
	return WeaponEvent{Behaviour: behaviour, TravelTime: travel, MissileSpoofed: spoofed, DecoyTriggered: decoyTriggered}
}

func handleLaserFire(req WeaponRequest, behaviour WeaponBehaviour) WeaponEvent {
	_ = req
	//1.- Lasers are hitscan so flight time is effectively zero while the beam persists.
	return WeaponEvent{Behaviour: behaviour, BeamDuration: behaviour.BeamDuration}
}

func pickFloat(base float64, override *float64, allowZero bool) float64 {
	//1.- Use the override when present while respecting zero-friendly fields like probabilities.
	if override != nil {
		if !allowZero && *override <= 0 {
			return base
		}
		return *override
	}
	if !allowZero && base < 0 {
		return 0
	}
	return base
}

func pickString(base, override string) string {
	//1.- Prefer the override when provided so art teams can customise effects per weapon.
	if override != "" {
		return override
	}
	return base
}

func durationFromSeconds(seconds float64) time.Duration {
	//1.- Guard against invalid configuration to avoid negative durations entering the pipeline.
	if !(seconds > 0) {
		return 0
	}
	return time.Duration(seconds * float64(time.Second))
}

func projectileTravelTime(distanceMeters, speedMetersPerSecond float64) time.Duration {
	//1.- A non-positive speed or distance yields zero travel time to simplify downstream logic.
	if !(distanceMeters > 0) || !(speedMetersPerSecond > 0) {
		return 0
	}
	seconds := distanceMeters / speedMetersPerSecond
	return durationFromSeconds(seconds)
}

func clampProbability(probability float64) float64 {
	//1.- NaN probabilities collapse to zero to keep determinism intact.
	if math.IsNaN(probability) {
		return 0
	}
	if probability < 0 {
		return 0
	}
	if probability > 1 {
		return 1
	}
	return probability
}
