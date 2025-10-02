package match

import (
	"testing"
	"time"

	pb "driftpursuit/broker/internal/proto/pb"
)

func TestRespawnDelayEnforced(t *testing.T) {
	//1.- Install a deterministic clock that advances manually between assertions.
	current := time.Unix(0, 0)
	flow := NewFlow(nil, WithClock(func() time.Time { return current }))
	//2.- Register an elimination and ensure the full three second delay remains.
	flow.RegisterElimination("alpha")
	if eta := flow.RespawnETA("alpha"); eta != 3*time.Second {
		t.Fatalf("expected 3s ETA, got %v", eta)
	}
	//3.- Advance the clock past the delay and verify the timer expires.
	current = current.Add(3500 * time.Millisecond)
	if eta := flow.RespawnETA("alpha"); eta != 0 {
		t.Fatalf("expected respawn readiness, got %v", eta)
	}
}

func TestSelectSafeRingAhead(t *testing.T) {
	//1.- Prepare safe rings positioned both ahead of and behind the vehicle.
	rings := []SafeRing{
		{ID: "behind", Position: &pb.Vector3{X: -2}},
		{ID: "ahead_near", Position: &pb.Vector3{X: 4, Y: 0.5}},
		{ID: "ahead_far", Position: &pb.Vector3{X: 9}},
	}
	flow := NewFlow(rings)
	position := &pb.Vector3{X: 0, Y: 0, Z: 0}
	forward := &pb.Vector3{X: 1, Y: 0, Z: 0}
	//2.- Request a respawn ring and confirm the nearest forward option is chosen.
	ring, err := flow.SelectSafeRing(position, forward)
	if err != nil {
		t.Fatalf("unexpected error selecting ring: %v", err)
	}
	if ring.ID != "ahead_near" {
		t.Fatalf("expected ahead_near ring, got %q", ring.ID)
	}
}

func TestSelectSafeRingFallbackNearest(t *testing.T) {
	//1.- Provide rings while omitting the forward vector to trigger the fallback path.
	rings := []SafeRing{
		{ID: "north", Position: &pb.Vector3{Y: 3}},
		{ID: "east", Position: &pb.Vector3{X: 1}},
	}
	flow := NewFlow(rings)
	//2.- Select the ring with a zero forward vector and ensure the nearest location wins.
	ring, err := flow.SelectSafeRing(&pb.Vector3{}, nil)
	if err != nil {
		t.Fatalf("unexpected error selecting fallback ring: %v", err)
	}
	if ring.ID != "east" {
		t.Fatalf("expected east ring, got %q", ring.ID)
	}
}
