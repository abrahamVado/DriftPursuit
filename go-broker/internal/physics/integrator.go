package physics

import (
	"math"

	pb "driftpursuit/broker/internal/proto/pb"
)

// Vec3 is a lightweight vector helper used by the physics utilities.
type Vec3 struct {
	X float64
	Y float64
	Z float64
}

// FromProtoVec3 converts a protobuf vector into the helper representation.
func FromProtoVec3(v *pb.Vector3) Vec3 {
	//1.- Protect against nil inputs to keep call sites concise.
	if v == nil {
		return Vec3{}
	}
	return Vec3{X: v.X, Y: v.Y, Z: v.Z}
}

// ToProtoVec3 copies the helper representation back into a protobuf vector.
func ToProtoVec3(v Vec3, dst *pb.Vector3) *pb.Vector3 {
	//1.- Allocate the destination if required for easier callers.
	if dst == nil {
		dst = &pb.Vector3{}
	}
	//2.- Copy each component for the mutation based workflow.
	dst.X = v.X
	dst.Y = v.Y
	dst.Z = v.Z
	return dst
}

// wrapAngleDeg normalizes an angle to the [-180, 180) range.
func wrapAngleDeg(angle float64) float64 {
	//1.- Use math.Mod to keep values bounded across many integration steps.
	wrapped := math.Mod(angle+180.0, 360.0)
	if wrapped < 0 {
		wrapped += 360.0
	}
	return wrapped - 180.0
}

// integrateLinear applies velocity over the timestep to update the position.
func integrateLinear(position *pb.Vector3, velocity *pb.Vector3, step float64) {
	//1.- Skip integration when inputs are missing or invalid.
	if position == nil || velocity == nil || step <= 0 {
		return
	}
	//2.- Advance each axis using the standard Euler integration.
	position.X += velocity.X * step
	position.Y += velocity.Y * step
	position.Z += velocity.Z * step
}

// integrateAngular applies angular velocity to the Euler orientation.
func integrateAngular(orientation *pb.Orientation, angularVelocity *pb.Vector3, step float64) {
	//1.- Require valid orientation data before attempting integration.
	if orientation == nil || angularVelocity == nil || step <= 0 {
		return
	}
	//2.- Update each Euler component in degrees per second then wrap.
	orientation.YawDeg = wrapAngleDeg(orientation.YawDeg + angularVelocity.Y*step)
	orientation.PitchDeg = wrapAngleDeg(orientation.PitchDeg + angularVelocity.X*step)
	orientation.RollDeg = wrapAngleDeg(orientation.RollDeg + angularVelocity.Z*step)
}

// IntegrateVehicle advances both linear and angular state for the vehicle.
func IntegrateVehicle(state *pb.VehicleState, step float64) {
	//1.- Guard against nil or invalid timesteps for robustness.
	if state == nil || step <= 0 {
		return
	}
	//2.- Integrate translation if both position and velocity are present.
	integrateLinear(state.Position, state.Velocity, step)
	//3.- Integrate rotation using the angular velocity channel.
	integrateAngular(state.Orientation, state.AngularVelocity, step)
}
