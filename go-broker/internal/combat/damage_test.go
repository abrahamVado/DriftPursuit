package combat

import (
	"testing"
	"time"

	"driftpursuit/broker/internal/events"
)

func TestResolveDamageDirectHit(t *testing.T) {
	//1.- Configure a profile with direct damage to ensure direct hits apply full value.
	profile := DamageProfile{DirectDamage: 120}
	result := ResolveDamage(profile, ImpactContext{DirectHit: true})
	if result.TotalDamage != 120 {
		t.Fatalf("expected total damage 120, got %.2f", result.TotalDamage)
	}
	if result.Breakdown[DamageSourceDirect] != 120 {
		t.Fatalf("expected direct breakdown 120, got %.2f", result.Breakdown[DamageSourceDirect])
	}
	if result.InstantDestroy {
		t.Fatalf("direct hit without velocity should not force instant destruction")
	}
}

func TestResolveDamageSplashFalloff(t *testing.T) {
	//1.- Define a splash profile so distance influences the resulting amount.
	profile := DamageProfile{SplashDamage: 90, SplashRadius: 30, SplashFalloffExponent: 2}
	center := ResolveDamage(profile, ImpactContext{DistanceMeters: 0})
	edge := ResolveDamage(profile, ImpactContext{DistanceMeters: 25})
	if center.Breakdown[DamageSourceSplash] <= edge.Breakdown[DamageSourceSplash] {
		t.Fatalf("expected splash damage to fall off with distance: center %.2f edge %.2f", center.Breakdown[DamageSourceSplash], edge.Breakdown[DamageSourceSplash])
	}
	if center.TotalDamage <= edge.TotalDamage {
		t.Fatalf("total damage should reflect the same falloff behaviour")
	}
}

func TestResolveDamageTerrainScaling(t *testing.T) {
	//1.- Use a collision profile to validate terrain hardness scaling.
	profile := DamageProfile{CollisionScale: 2, CollisionThresholdMps: 5}
	result := ResolveDamage(profile, ImpactContext{ImpactSpeedMps: 20, TerrainHardness: 0.5})
	expected := (20 - 5) * 2 * 0.5
	if result.Breakdown[DamageSourceCollision] != expected {
		t.Fatalf("unexpected collision damage %.2f, expected %.2f", result.Breakdown[DamageSourceCollision], expected)
	}
	if result.TotalDamage != expected {
		t.Fatalf("expected total damage %.2f, got %.2f", expected, result.TotalDamage)
	}
}

func TestResolveDamageInstantKillTelemetryIntegration(t *testing.T) {
	//1.- Arrange a combined impact exceeding the instant kill threshold.
	profile := DamageProfile{DirectDamage: 40, SplashDamage: 20, SplashRadius: 10}
	ctx := ImpactContext{DirectHit: true, DistanceMeters: 5, ImpactSpeedMps: 42, TerrainHardness: 1}
	result := ResolveDamage(profile, ctx)
	if !result.InstantDestroy {
		t.Fatalf("expected instant destruction when impact speed >= 30 m/s")
	}

	//2.- Apply the breakdown to a combat telemetry snapshot and validate metadata propagation.
	telemetry := &events.CombatTelemetry{
		EventID:    "evt-damage",
		OccurredAt: time.UnixMilli(1234),
		Metadata:   map[string]string{"weapon": "gravity-well"},
	}
	result.ApplyToTelemetry(telemetry, "kinetic")

	if telemetry.Damage.Amount <= 0 {
		t.Fatalf("expected damage amount to be populated")
	}
	if !telemetry.Damage.Critical {
		t.Fatalf("critical flag should mirror instant destruction")
	}
	if telemetry.Metadata["damage_total"] == "" {
		t.Fatalf("expected damage_total metadata entry")
	}
	if telemetry.Metadata["damage_instant_kill"] != "true" {
		t.Fatalf("expected instant kill metadata to read true, got %q", telemetry.Metadata["damage_instant_kill"])
	}
	if telemetry.Metadata["weapon"] != "gravity-well" {
		t.Fatalf("existing metadata should be preserved")
	}
}
