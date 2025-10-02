package physics

import (
	"math"
	"testing"

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
