package physics

import (
	"math"

	pb "driftpursuit/broker/internal/proto/pb"
)

// GuidanceSpline represents a polyline used for assisted alignment.
type GuidanceSpline struct {
	nodes []Vec3
}

// NewGuidanceSpline defensively copies nodes for use during alignment.
func NewGuidanceSpline(nodes []Vec3) *GuidanceSpline {
	//1.- Require at least two nodes to compute tangents along the spline.
	if len(nodes) < 2 {
		return nil
	}
	copied := make([]Vec3, len(nodes))
	copy(copied, nodes)
	return &GuidanceSpline{nodes: copied}
}

// tangentFor returns the unit tangent of the closest segment to the position.
func (g *GuidanceSpline) tangentFor(position Vec3) (Vec3, bool) {
	//1.- Ensure the spline has data before computing tangents.
	if g == nil || len(g.nodes) < 2 {
		return Vec3{}, false
	}
	bestDistance := math.MaxFloat64
	bestTangent := Vec3{}
	//2.- Iterate over each segment and choose the closest projection.
	for idx := 0; idx < len(g.nodes)-1; idx++ {
		a := g.nodes[idx]
		b := g.nodes[idx+1]
		ab := Vec3{X: b.X - a.X, Y: b.Y - a.Y, Z: b.Z - a.Z}
		abLenSquared := ab.X*ab.X + ab.Y*ab.Y + ab.Z*ab.Z
		if abLenSquared == 0 {
			continue
		}
		ap := Vec3{X: position.X - a.X, Y: position.Y - a.Y, Z: position.Z - a.Z}
		t := (ap.X*ab.X + ap.Y*ab.Y + ap.Z*ab.Z) / abLenSquared
		if t < 0 {
			t = 0
		} else if t > 1 {
			t = 1
		}
		closest := Vec3{X: a.X + ab.X*t, Y: a.Y + ab.Y*t, Z: a.Z + ab.Z*t}
		dx := position.X - closest.X
		dy := position.Y - closest.Y
		dz := position.Z - closest.Z
		distance := math.Sqrt(dx*dx + dy*dy + dz*dz)
		if distance < bestDistance {
			bestDistance = distance
			length := math.Sqrt(abLenSquared)
			inv := 1.0 / length
			bestTangent = Vec3{X: ab.X * inv, Y: ab.Y * inv, Z: ab.Z * inv}
		}
	}
	return bestTangent, bestDistance < math.MaxFloat64
}

// AlignToGuidance rotates the vehicle orientation toward the spline tangent.
func AlignToGuidance(state *pb.VehicleState, spline *GuidanceSpline) {
	//1.- Guard against missing prerequisites so manual mode is unaffected.
	if state == nil || spline == nil || state.Position == nil {
		return
	}
	tangent, ok := spline.tangentFor(FromProtoVec3(state.Position))
	if !ok {
		return
	}
	//2.- Compute yaw and pitch angles from the tangent vector.
	horizontal := math.Sqrt(tangent.X*tangent.X + tangent.Z*tangent.Z)
	yaw := 0.0
	if horizontal != 0 {
		yaw = math.Atan2(tangent.X, tangent.Z) * 180.0 / math.Pi
	}
	pitch := math.Atan2(tangent.Y, horizontal) * 180.0 / math.Pi
	//3.- Apply the orientation and dampen angular velocity for stability.
	if state.Orientation == nil {
		state.Orientation = &pb.Orientation{}
	}
	state.Orientation.YawDeg = wrapAngleDeg(yaw)
	state.Orientation.PitchDeg = wrapAngleDeg(pitch)
	state.Orientation.RollDeg = 0
	if state.AngularVelocity != nil {
		state.AngularVelocity.X = 0
		state.AngularVelocity.Y = 0
		state.AngularVelocity.Z = 0
	}
}
