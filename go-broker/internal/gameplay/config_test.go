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
