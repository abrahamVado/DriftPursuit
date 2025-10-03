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
		{ID: "behind", Position: &pb.Vector3{X: -2}, Volumes: []SafeVolume{{Center: &pb.Vector3{X: -2}}}},
		{ID: "ahead_near", Position: &pb.Vector3{X: 4, Y: 0.5}, Volumes: []SafeVolume{{Center: &pb.Vector3{X: 4}}}},
		{ID: "ahead_far", Position: &pb.Vector3{X: 9}, Volumes: []SafeVolume{{Center: &pb.Vector3{X: 9}}}},
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
		{ID: "north", Position: &pb.Vector3{Y: 3}, Volumes: []SafeVolume{{Center: &pb.Vector3{Y: 3}}}},
		{ID: "east", Position: &pb.Vector3{X: 1}, Volumes: []SafeVolume{{Center: &pb.Vector3{X: 1}}}},
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

func TestSelectSafeRingRequiresNearbyVolume(t *testing.T) {
	//1.- Configure rings where only one offers a safe volume within the probe distance.
	rings := []SafeRing{
		{ID: "distant", Position: &pb.Vector3{X: 6}, Volumes: []SafeVolume{{Center: &pb.Vector3{X: 950}}}},
		{ID: "candidate", Position: &pb.Vector3{X: 12}, Volumes: []SafeVolume{{Center: &pb.Vector3{X: 280}}}},
	}
	flow := NewFlow(rings)
	//2.- Query the selection using a forward vector aligned with the X axis.
	ring, err := flow.SelectSafeRing(&pb.Vector3{X: 0}, &pb.Vector3{X: 1})
	if err != nil {
		t.Fatalf("unexpected error selecting ring with volume probe: %v", err)
	}
	if ring.ID != "candidate" {
		t.Fatalf("expected candidate ring with safe volume, got %q", ring.ID)
	}
}

func TestSpawnShieldWindowExpires(t *testing.T) {
	//1.- Establish a flow with a deterministic clock to control shield expiration.
	current := time.Unix(0, 0)
	advance := func(d time.Duration) { current = current.Add(d) }
	flow := NewFlow(nil, WithClock(func() time.Time { return current }))

	//2.- Clearing a respawn activates the default spawn shield.
	flow.ClearRespawn("skiff")
	remaining := flow.SpawnShieldRemaining("skiff")
	if remaining != DefaultSpawnShieldDuration {
		t.Fatalf("expected %v shield remaining, got %v", DefaultSpawnShieldDuration, remaining)
	}

	//3.- Advance beyond the protection window and ensure the shield is removed.
	advance(DefaultSpawnShieldDuration + 100*time.Millisecond)
	if eta := flow.SpawnShieldRemaining("skiff"); eta != 0 {
		t.Fatalf("expected shield to expire, still have %v", eta)
	}
}

func TestRespawnLifecycleSelectsSafeRingAndShield(t *testing.T) {
	//1.- Configure a deterministic clock and rings arranged around the player.
	current := time.Unix(0, 0)
	rings := []SafeRing{
		{ID: "west", Position: &pb.Vector3{X: -500}, Volumes: []SafeVolume{{Center: &pb.Vector3{X: -520}}}},
		{ID: "forward", Position: &pb.Vector3{X: 300}, Volumes: []SafeVolume{{Center: &pb.Vector3{X: 320}}}},
	}
	flow := NewFlow(rings, WithClock(func() time.Time { return current }), WithRespawnDelay(2*time.Second))

	//2.- Record the elimination and confirm the respawn is delayed appropriately.
	flow.RegisterElimination("alpha")
	if eta := flow.RespawnETA("alpha"); eta != 2*time.Second {
		t.Fatalf("expected 2s respawn delay, got %v", eta)
	}

	//3.- Advance beyond the delay and request a safe ring using the forward vector.
	current = current.Add(2100 * time.Millisecond)
	if eta := flow.RespawnETA("alpha"); eta != 0 {
		t.Fatalf("expected respawn readiness, got %v", eta)
	}
	ring, err := flow.SelectSafeRing(&pb.Vector3{X: 0, Y: 0, Z: 0}, &pb.Vector3{X: 1})
	if err != nil {
		t.Fatalf("unexpected error selecting ring: %v", err)
	}
	if ring.ID != "forward" {
		t.Fatalf("expected forward ring for safe placement, got %q", ring.ID)
	}
	if len(ring.Volumes) == 0 {
		t.Fatal("expected safe volumes to guide placement")
	}

	//4.- Clear the respawn to simulate the player returning and validate the spawn shield.
	flow.ClearRespawn("alpha")
	remaining := flow.SpawnShieldRemaining("alpha")
	if remaining != DefaultSpawnShieldDuration {
		t.Fatalf("expected default shield duration, got %v", remaining)
	}
	t.Logf("QA_LOG_RESPAWN ring=%s shield=%v", ring.ID, remaining)
}
