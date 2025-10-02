package simulation

import (
        "math"
        "testing"
)

func TestSphereFieldSamplingMatchesAnalytic(t *testing.T) {
        field := SphereField{Center: Vec3{}, Radius: 2}
        cases := []struct {
                point    Vec3
                expected float64
        }{
                {point: Vec3{}, expected: -2},
                {point: Vec3{X: 2}, expected: 0},
                {point: Vec3{Y: 3}, expected: 1},
                {point: Vec3{X: 1, Y: 2, Z: 2}, expected: math.Sqrt(9) - 2},
        }
        for _, tc := range cases {
                //1.- Compare analytic distance with SDF sampling results.
                if got := field.Sample(tc.point); math.Abs(got-tc.expected) > 1e-7 {
                        t.Fatalf("expected %f, got %f", tc.expected, got)
                }
        }
}

func TestRaycastHitsSphereSurface(t *testing.T) {
        field := SphereField{Center: Vec3{}, Radius: 2}
        hit, distance, position := Raycast(field, Vec3{Z: 5}, Vec3{Z: -1}, 100, 128, 1e-3)
        //1.- Ray should intersect three units along the negative Z axis.
        if !hit {
                t.Fatal("expected ray to hit sphere")
        }
        if math.Abs(distance-3) > 1e-3 {
                t.Fatalf("expected distance 3, got %f", distance)
        }
        if math.Abs(position.Z-2) > 1e-3 {
                t.Fatalf("expected hit at z=2, got %f", position.Z)
        }
}

func TestSphereIntersectionDetectsPlanePenetration(t *testing.T) {
        plane := NewPlaneField(Vec3{}, Vec3{Y: 1})
        hit, separation := SphereIntersection(plane, Vec3{Y: 0.5}, 1)
        //1.- Sphere should intersect the plane with half unit penetration.
        if !hit {
                t.Fatal("expected intersection")
        }
        if math.Abs(separation+0.5) > 1e-7 {
                t.Fatalf("expected separation -0.5, got %f", separation)
        }
}

func TestSphereIntersectionHonoursClearance(t *testing.T) {
        plane := NewPlaneField(Vec3{}, Vec3{Y: 1})
        hit, separation := SphereIntersection(plane, Vec3{Y: 2.5}, 1)
        //1.- Clearance should equal signed distance minus radius.
        if hit {
                t.Fatal("expected no intersection")
        }
        if math.Abs(separation-1.5) > 1e-7 {
                t.Fatalf("expected separation 1.5, got %f", separation)
        }
}
