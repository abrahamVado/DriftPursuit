package physics

import (
	"math"
	"testing"

	"driftpursuit/broker/internal/gameplay"
	pb "driftpursuit/broker/internal/proto/pb"
)

func TestIntegrateVehicleUpdatesLinearAndAngular(t *testing.T) {
	//1.- Construct a vehicle with both velocity components populated.
	state := &pb.VehicleState{
		Position:        &pb.Vector3{X: 1, Y: 2, Z: 3},
		Velocity:        &pb.Vector3{X: 4, Y: -2, Z: 0.5},
		Orientation:     &pb.Orientation{YawDeg: 10, PitchDeg: -5, RollDeg: 0},
		AngularVelocity: &pb.Vector3{X: 20, Y: 30, Z: -10},
	}
	//2.- Advance the state by half a second and verify results.
	IntegrateVehicle(state, 0.5)
	if math.Abs(state.Position.X-3) > 1e-9 {
		t.Fatalf("unexpected X %.2f", state.Position.X)
	}
	if math.Abs(state.Position.Y-1) > 1e-9 {
		t.Fatalf("unexpected Y %.2f", state.Position.Y)
	}
	if math.Abs(state.Position.Z-3.25) > 1e-9 {
		t.Fatalf("unexpected Z %.2f", state.Position.Z)
	}
	if math.Abs(state.Orientation.YawDeg-25) > 1e-9 {
		t.Fatalf("unexpected yaw %.2f", state.Orientation.YawDeg)
	}
	if math.Abs(state.Orientation.PitchDeg-5) > 1e-9 {
		t.Fatalf("unexpected pitch %.2f", state.Orientation.PitchDeg)
	}
	if math.Abs(state.Orientation.RollDeg+5) > 1e-9 {
		t.Fatalf("unexpected roll %.2f", state.Orientation.RollDeg)
	}
}

func TestIntegrateVehicleHandlesInvalidInput(t *testing.T) {
	//1.- Use nil state and zero timestep to ensure safe no-op behaviour.
	IntegrateVehicle(nil, 0.5)
	state := &pb.VehicleState{}
	IntegrateVehicle(state, -1)
	if state.Position != nil || state.Orientation != nil {
		t.Fatalf("integration should not allocate with invalid input")
	}
}

func TestIntegrateVehicleClampsToSkiffStats(t *testing.T) {
	//1.- Build a state with exaggerated linear and angular rates.
	stats := gameplay.SkiffStats()
	state := &pb.VehicleState{
		Position:    &pb.Vector3{X: 0, Y: 0, Z: 0},
		Velocity:    &pb.Vector3{X: stats.MaxSpeedMps * 3, Y: stats.MaxSpeedMps * 2, Z: stats.MaxSpeedMps},
		Orientation: &pb.Orientation{YawDeg: 0, PitchDeg: 0, RollDeg: 0},
		AngularVelocity: &pb.Vector3{
			X: stats.MaxAngularSpeedDegPerSec * 4,
			Y: stats.MaxAngularSpeedDegPerSec * 2,
			Z: 0,
		},
	}
	//2.- Integrate a one second step to exercise the clamp logic.
	IntegrateVehicleWithStats(state, stats, 1)
	velocity := state.GetVelocity()
	if velocity == nil {
		t.Fatalf("expected velocity to remain populated")
	}
	//3.- Confirm the resulting speed is capped by the shared configuration.
	speed := math.Sqrt(velocity.X*velocity.X + velocity.Y*velocity.Y + velocity.Z*velocity.Z)
	if math.Abs(speed-stats.MaxSpeedMps) > 1e-6 {
		t.Fatalf("linear clamp mismatch: got %.6f want %.6f", speed, stats.MaxSpeedMps)
	}
	displacement := state.GetPosition()
	if displacement == nil {
		t.Fatalf("expected position after integration")
	}
	//4.- Ensure the positional delta aligns with the clamped velocity magnitude.
	dispSq := displacement.X*displacement.X + displacement.Y*displacement.Y + displacement.Z*displacement.Z
	if math.Abs(dispSq-stats.MaxSpeedMps*stats.MaxSpeedMps) > 1e-3 {
		t.Fatalf("position delta mismatch: got %.6f want %.6f", dispSq, stats.MaxSpeedMps*stats.MaxSpeedMps)
	}
	angular := state.GetAngularVelocity()
	if angular == nil {
		t.Fatalf("expected angular velocity to remain populated")
	}
	//5.- Validate the angular magnitude matches the configuration limit as well.
	angularSpeed := math.Sqrt(angular.X*angular.X + angular.Y*angular.Y + angular.Z*angular.Z)
	if math.Abs(angularSpeed-stats.MaxAngularSpeedDegPerSec) > 1e-6 {
		t.Fatalf("angular clamp mismatch: got %.6f want %.6f", angularSpeed, stats.MaxAngularSpeedDegPerSec)
	}
}

func TestIntegrateVehicleHonoursCustomLoadoutStats(t *testing.T) {
	//1.- Craft a loadout with modified speed and agility multipliers.
	base := gameplay.SkiffStats()
	tuned := gameplay.DeriveStatsWithModifiers(base, gameplay.PassiveModifiers{SpeedMultiplier: 1.2, AgilityMultiplier: 0.5, DamageMultiplier: 1, BoostCooldownScale: 1})
	state := &pb.VehicleState{
		Position:        &pb.Vector3{},
		Velocity:        &pb.Vector3{X: tuned.MaxSpeedMps * 5},
		Orientation:     &pb.Orientation{},
		AngularVelocity: &pb.Vector3{X: tuned.MaxAngularSpeedDegPerSec * 3},
	}
	//2.- Integrate a unit step with the derived stats to exercise the clamping behaviour.
	IntegrateVehicleWithStats(state, tuned, 1)
	speed := math.Sqrt(state.Velocity.X*state.Velocity.X + state.Velocity.Y*state.Velocity.Y + state.Velocity.Z*state.Velocity.Z)
	if math.Abs(speed-tuned.MaxSpeedMps) > 1e-6 {
		t.Fatalf("expected custom speed clamp %.2f got %.2f", tuned.MaxSpeedMps, speed)
	}
	angular := math.Sqrt(state.AngularVelocity.X*state.AngularVelocity.X + state.AngularVelocity.Y*state.AngularVelocity.Y + state.AngularVelocity.Z*state.AngularVelocity.Z)
	if math.Abs(angular-tuned.MaxAngularSpeedDegPerSec) > 1e-6 {
		t.Fatalf("expected custom angular clamp %.2f got %.2f", tuned.MaxAngularSpeedDegPerSec, angular)
	}
}
