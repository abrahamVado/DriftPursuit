package simulation

import "math"

// Vec3 represents a simple 3D vector for collision math.
type Vec3 struct {
        X float64
        Y float64
        Z float64
}

// Add returns the component wise sum of two vectors.
func (v Vec3) Add(other Vec3) Vec3 {
        //1.- Combine offsets to advance ray marching positions.
        return Vec3{X: v.X + other.X, Y: v.Y + other.Y, Z: v.Z + other.Z}
}

// Sub returns the difference between two vectors.
func (v Vec3) Sub(other Vec3) Vec3 {
        //1.- Differences enable distance calculations within the SDF sampler.
        return Vec3{X: v.X - other.X, Y: v.Y - other.Y, Z: v.Z - other.Z}
}

// Scale multiplies the vector by a scalar.
func (v Vec3) Scale(scalar float64) Vec3 {
        //1.- Scaling lets us travel along a direction by the sampled distance.
        return Vec3{X: v.X * scalar, Y: v.Y * scalar, Z: v.Z * scalar}
}

// Dot returns the scalar dot product of two vectors.
func (v Vec3) Dot(other Vec3) float64 {
        //1.- Dot products project vectors for plane evaluations.
        return v.X*other.X + v.Y*other.Y + v.Z*other.Z
}

// Length computes the Euclidean norm of the vector.
func (v Vec3) Length() float64 {
        //1.- Magnitudes are required for analytic SDF distances.
        return math.Sqrt(v.Dot(v))
}

// Normalize produces a unit length vector, panicking if the magnitude is zero.
func (v Vec3) Normalize() Vec3 {
        //1.- Maintain numerical stability by enforcing a non-zero direction.
        length := v.Length()
        if length == 0 {
                panic("cannot normalize zero vector")
        }
        inv := 1.0 / length
        return Vec3{X: v.X * inv, Y: v.Y * inv, Z: v.Z * inv}
}

// SignedDistanceField exposes the sampling contract for collision queries.
type SignedDistanceField interface {
        Sample(point Vec3) float64
}

// SampleFunc adapts a function into a SignedDistanceField.
type SampleFunc func(Vec3) float64

// Sample invokes the wrapped sampling function.
func (s SampleFunc) Sample(point Vec3) float64 {
        return s(point)
}

// SphereField describes an analytic sphere signed distance function.
type SphereField struct {
        Center Vec3
        Radius float64
}

// Sample calculates the signed distance from a point to the sphere surface.
func (s SphereField) Sample(point Vec3) float64 {
        //1.- The radius is subtracted from the distance between the point and center.
        return point.Sub(s.Center).Length() - s.Radius
}

// PlaneField describes an infinite plane represented by a point and normal.
type PlaneField struct {
        origin Vec3
        normal Vec3
}

// NewPlaneField normalizes the normal and stores the plane representation.
func NewPlaneField(point Vec3, normal Vec3) PlaneField {
        //1.- Normalize the plane normal to keep signed distances consistent.
        unit := normal.Normalize()
        return PlaneField{origin: point, normal: unit}
}

// Sample returns the signed distance from the plane to the provided point.
func (p PlaneField) Sample(point Vec3) float64 {
        //1.- Dot product with the normal projects the delta onto the plane axis.
        return point.Sub(p.origin).Dot(p.normal)
}

// Raycast performs sphere tracing against the provided field.
func Raycast(field SignedDistanceField, origin Vec3, direction Vec3, maxDistance float64, maxSteps int, epsilon float64) (bool, float64, Vec3) {
        //1.- Normalize the incoming direction vector before marching.
        dir := direction.Normalize()
        distance := 0.0
        current := origin
        for step := 0; step < maxSteps; step++ {
                sample := field.Sample(current)
                if sample < epsilon {
                        //2.- Return a hit once the sampled distance is within tolerance.
                        return true, distance, current
                }
                distance += sample
                if distance > maxDistance {
                        break
                }
                //3.- Advance the ray origin using the sampled distance.
                current = origin.Add(dir.Scale(distance))
        }
        capped := math.Min(distance, maxDistance)
        return false, capped, origin.Add(dir.Scale(capped))
}

// SphereIntersection evaluates whether a bounding sphere penetrates the field.
func SphereIntersection(field SignedDistanceField, center Vec3, radius float64) (bool, float64) {
        //1.- Sample the SDF at the sphere center and subtract the radius to compute clearance.
        separation := field.Sample(center) - radius
        return separation <= 0, separation
}
