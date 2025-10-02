package simulation

import (
	"math"
	"testing"
	"time"

	"driftpursuit/broker/internal/physics"
	pb "driftpursuit/broker/internal/proto/pb"
	"driftpursuit/broker/internal/state"
)

func TestManualModeRetainsAngularIntegration(t *testing.T) {
	//1.- Configure the world with a placeholder guidance spline.
	world := state.NewWorldState()
	world.Vehicles.SetGuidanceSpline(physics.NewGuidanceSpline([]physics.Vec3{{X: 0, Y: 0, Z: 0}, {X: 0, Y: 0, Z: 10}}))
	vehicle := &pb.VehicleState{
		VehicleId:           "manual-1",
		Position:            &pb.Vector3{X: 0, Y: 0, Z: 0},
		Velocity:            &pb.Vector3{X: 0, Y: 0, Z: 0},
		Orientation:         &pb.Orientation{YawDeg: 0, PitchDeg: 0, RollDeg: 0},
		AngularVelocity:     &pb.Vector3{Y: 90},
		FlightAssistEnabled: false,
	}
	world.Vehicles.Upsert(vehicle)
	world.Vehicles.ConsumeDiff()
	//2.- Advance half a second and expect the yaw to integrate freely.
	diff := world.AdvanceTick(500 * time.Millisecond)
	if len(diff.Vehicles.Updated) != 1 {
		t.Fatalf("expected vehicle diff entry")
	}
	updated := diff.Vehicles.Updated[0]
	if math.Abs(updated.Orientation.YawDeg-45) > 1e-9 {
		t.Fatalf("expected yaw 45 degrees, got %.2f", updated.Orientation.YawDeg)
	}
}

func TestAssistModeAlignsToSpline(t *testing.T) {
	//1.- Configure a spline that climbs upward while moving along +Z.
	world := state.NewWorldState()
	spline := physics.NewGuidanceSpline([]physics.Vec3{{X: 0, Y: 0, Z: 0}, {X: 0, Y: 5, Z: 5}})
	world.Vehicles.SetGuidanceSpline(spline)
	vehicle := &pb.VehicleState{
		VehicleId:           "assist-1",
		Position:            &pb.Vector3{X: 0, Y: 0, Z: 0},
		Velocity:            &pb.Vector3{X: 0, Y: 0, Z: 0},
		Orientation:         &pb.Orientation{YawDeg: -90, PitchDeg: 0, RollDeg: 45},
		AngularVelocity:     &pb.Vector3{X: 0, Y: -120, Z: 30},
		FlightAssistEnabled: true,
	}
	world.Vehicles.Upsert(vehicle)
	world.Vehicles.ConsumeDiff()
	//2.- Advance one tick and expect the orientation to match the spline tangent.
	diff := world.AdvanceTick(1 * time.Second)
	if len(diff.Vehicles.Updated) != 1 {
		t.Fatalf("expected updated vehicle")
	}
	updated := diff.Vehicles.Updated[0]
	if math.Abs(updated.Orientation.YawDeg) > 1e-9 {
		t.Fatalf("expected yaw 0, got %.2f", updated.Orientation.YawDeg)
	}
	if math.Abs(updated.Orientation.PitchDeg-45) > 1e-9 {
		t.Fatalf("expected pitch 45, got %.2f", updated.Orientation.PitchDeg)
	}
	if math.Abs(updated.Orientation.RollDeg) > 1e-9 {
		t.Fatalf("expected roll 0, got %.2f", updated.Orientation.RollDeg)
	}
	if updated.AngularVelocity == nil || updated.AngularVelocity.X != 0 || updated.AngularVelocity.Y != 0 || updated.AngularVelocity.Z != 0 {
		t.Fatalf("expected angular velocity dampening")
	}
}
