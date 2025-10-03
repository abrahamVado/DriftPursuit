package gameplay

import "testing"

func TestSkiffStatsMatchExpectedValues(t *testing.T) {
	//1.- Retrieve the cached configuration to validate the embedded payload.
	stats := SkiffStats()
	//2.- Assert every documented constant so accidental edits trigger failures.
	if stats.MaxSpeedMps != 120.0 {
		t.Fatalf("unexpected max speed %.2f", stats.MaxSpeedMps)
	}
	if stats.MaxAngularSpeedDegPerSec != 180.0 {
		t.Fatalf("unexpected max angular speed %.2f", stats.MaxAngularSpeedDegPerSec)
	}
	if stats.ForwardAccelerationMps2 != 32.0 {
		t.Fatalf("unexpected forward acceleration %.2f", stats.ForwardAccelerationMps2)
	}
	if stats.ReverseAccelerationMps2 != 22.0 {
		t.Fatalf("unexpected reverse acceleration %.2f", stats.ReverseAccelerationMps2)
	}
	if stats.StrafeAccelerationMps2 != 18.0 {
		t.Fatalf("unexpected strafe acceleration %.2f", stats.StrafeAccelerationMps2)
	}
	if stats.VerticalAccelerationMps2 != 16.0 {
		t.Fatalf("unexpected vertical acceleration %.2f", stats.VerticalAccelerationMps2)
	}
	if stats.BoostAccelerationMps2 != 48.0 {
		t.Fatalf("unexpected boost acceleration %.2f", stats.BoostAccelerationMps2)
	}
	if stats.BoostDurationSeconds != 3.5 {
		t.Fatalf("unexpected boost duration %.2f", stats.BoostDurationSeconds)
	}
	if stats.BoostCooldownSeconds != 9.0 {
		t.Fatalf("unexpected boost cooldown %.2f", stats.BoostCooldownSeconds)
	}
}

func TestSkiffLoadoutsExposeSelectableCatalog(t *testing.T) {
	//1.- Load the shared catalog and ensure the selectable entries remain stable.
	loadouts := SkiffLoadouts()
	var selectable []string
	for _, loadout := range loadouts {
		if loadout.Selectable {
			selectable = append(selectable, loadout.ID)
		}
	}
	if len(selectable) != 2 {
		t.Fatalf("expected two selectable loadouts, got %v", selectable)
	}
	if selectable[0] != "skiff-strike" || selectable[1] != "skiff-raider" {
		t.Fatalf("unexpected selectable loadouts: %v", selectable)
	}

	//2.- Derive stats for the raider loadout and ensure modifiers are applied.
	raider := LoadoutStats("skiff-raider")
	base := SkiffStats()
	if raider.MaxSpeedMps <= base.MaxSpeedMps {
		t.Fatalf("expected raider speed boost, got %.2f vs %.2f", raider.MaxSpeedMps, base.MaxSpeedMps)
	}
	if raider.ForwardAccelerationMps2 >= base.ForwardAccelerationMps2 {
		t.Fatalf("expected agility reduction, got %.2f vs %.2f", raider.ForwardAccelerationMps2, base.ForwardAccelerationMps2)
	}

	//3.- Damage multipliers should default to 1 for unknown identifiers.
	if mult := LoadoutDamageMultiplier("skiff-tank"); mult <= 1 {
		t.Fatalf("tank loadout should boost damage, got %.2f", mult)
	}
	if mult := LoadoutDamageMultiplier("unknown"); mult != 1 {
		t.Fatalf("unknown loadout should be neutral, got %.2f", mult)
	}

	//4.- Default helper returns the first selectable loadout for quick spawns.
	if id := DefaultSkiffLoadoutID(); id != "skiff-strike" {
		t.Fatalf("unexpected default loadout %q", id)
	}

	//5.- Radar range helper must respect the tuning window per loadout configuration.
	if rng := LoadoutRadarRange("skiff-raider"); rng != 900 {
		t.Fatalf("unexpected raider radar range %.2f", rng)
	}
	if rng := LoadoutRadarRange("skiff-strike"); rng != 720 {
		t.Fatalf("unexpected strike radar range %.2f", rng)
	}
	if rng := LoadoutRadarRange("unknown"); rng != 600 {
		t.Fatalf("unknown loadout should fall back to minimum range, got %.2f", rng)
	}
}
