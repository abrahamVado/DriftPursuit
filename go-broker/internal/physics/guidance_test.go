package physics

import (
	"math"
	"testing"

	pb "driftpursuit/broker/internal/proto/pb"
)

func TestAlignToGuidanceAdjustsOrientation(t *testing.T) {
	//1.- Create a straight spline pointing along the positive X axis.
	spline := NewGuidanceSpline([]Vec3{{X: 0, Y: 0, Z: 0}, {X: 10, Y: 0, Z: 0}})
	state := &pb.VehicleState{
		Position:        &pb.Vector3{X: 1, Y: 0, Z: 0},
		Orientation:     &pb.Orientation{YawDeg: 0, PitchDeg: 0, RollDeg: 0},
		AngularVelocity: &pb.Vector3{X: 5, Y: -5, Z: 2},
	}
	//2.- Align to the spline and verify the yaw target is achieved.
	AlignToGuidance(state, spline)
	if math.Abs(state.Orientation.YawDeg-90) > 1e-9 {
		t.Fatalf("expected yaw to align to +X, got %.2f", state.Orientation.YawDeg)
	}
	if math.Abs(state.Orientation.PitchDeg) > 1e-9 {
		t.Fatalf("expected level pitch, got %.2f", state.Orientation.PitchDeg)
	}
	if state.AngularVelocity == nil || state.AngularVelocity.X != 0 || state.AngularVelocity.Y != 0 || state.AngularVelocity.Z != 0 {
		t.Fatalf("expected angular velocity to be dampened")
	}
}

func TestAlignToGuidanceHandlesNilInputs(t *testing.T) {
	//1.- Exercise nil and degenerate paths to ensure stability.
	AlignToGuidance(nil, nil)
	state := &pb.VehicleState{}
	AlignToGuidance(state, nil)
	if state.Orientation != nil {
		t.Fatalf("orientation should remain unset without guidance")
	}
}
