package networking

import (
	"testing"

	pb "driftpursuit/broker/internal/proto/pb"
)

func TestTierManagerBucketsByDistance(t *testing.T) {
	manager := NewTierManager(DefaultTierConfig())

	observer := &pb.ObserverState{
		SchemaVersion: "0.2.0",
		ObserverId:    "observer-1",
		Position: &pb.Vector3{
			X: 0,
			Y: 0,
			Z: 0,
		},
		NearbyRangeM: 500,
		RadarRangeM:  2000,
	}
	manager.UpdateObserver("client-1", observer)

	near := &pb.EntitySnapshot{
		SchemaVersion: "0.2.0",
		EntityId:      "near",
		Active:        true,
		Position: &pb.Vector3{
			X: 100,
			Y: 0,
			Z: 0,
		},
	}
	manager.UpdateEntity(near)

	radar := &pb.EntitySnapshot{
		SchemaVersion: "0.2.0",
		EntityId:      "radar",
		Active:        true,
		Position: &pb.Vector3{
			X: 0,
			Y: 1600,
			Z: 0,
		},
	}
	manager.UpdateEntity(radar)

	far := &pb.EntitySnapshot{
		SchemaVersion: "0.2.0",
		EntityId:      "far",
		Active:        true,
		Position: &pb.Vector3{
			X: 0,
			Y: 0,
			Z: 6000,
		},
	}
	manager.UpdateEntity(far)

	buckets := manager.Buckets("client-1")
	if buckets == nil {
		t.Fatalf("expected buckets for observer")
	}

	if got := tierForEntity(buckets, "near"); got != pb.InterestTier_INTEREST_TIER_NEARBY {
		t.Fatalf("expected near entity to be NEARBY tier, got %v", got)
	}
	if got := tierForEntity(buckets, "radar"); got != pb.InterestTier_INTEREST_TIER_RADAR {
		t.Fatalf("expected radar entity to be RADAR tier, got %v", got)
	}
	if got := tierForEntity(buckets, "far"); got != pb.InterestTier_INTEREST_TIER_EXTENDED {
		t.Fatalf("expected far entity to be EXTENDED tier, got %v", got)
	}

	// Radar override should upgrade the far contact into the radar tier.
	frame := &pb.RadarFrame{
		SchemaVersion: "0.2.0",
		Contacts: []*pb.RadarContact{
			{
				SchemaVersion:  "0.2.0",
				SourceEntityId: "radar-1",
				Entries: []*pb.RadarContactEntry{
					{
						TargetEntityId: "far",
						SuggestedTier:  pb.InterestTier_INTEREST_TIER_RADAR,
					},
				},
			},
		},
	}
	manager.ApplyRadarFrame(frame)

	buckets = manager.Buckets("client-1")
	if got := tierForEntity(buckets, "far"); got != pb.InterestTier_INTEREST_TIER_RADAR {
		t.Fatalf("expected radar override to move far entity into RADAR tier, got %v", got)
	}

	// Inactive entities should fall back to PASSIVE.
	inactive := &pb.EntitySnapshot{
		SchemaVersion: "0.2.0",
		EntityId:      "near",
		Active:        false,
	}
	manager.UpdateEntity(inactive)

	buckets = manager.Buckets("client-1")
	if got := tierForEntity(buckets, "near"); got != pb.InterestTier_INTEREST_TIER_PASSIVE {
		t.Fatalf("expected inactive entity to be PASSIVE, got %v", got)
	}
}

func TestTierManagerRemoveObserver(t *testing.T) {
	manager := NewTierManager(DefaultTierConfig())
	manager.UpdateObserver("client-2", &pb.ObserverState{SchemaVersion: "0.2.0", ObserverId: "observer-2"})
	manager.UpdateEntity(&pb.EntitySnapshot{SchemaVersion: "0.2.0", EntityId: "foo", Active: true})

	if buckets := manager.Buckets("client-2"); buckets == nil {
		t.Fatalf("expected buckets before removal")
	}

	manager.RemoveObserver("client-2")
	if buckets := manager.Buckets("client-2"); buckets != nil {
		t.Fatalf("expected nil buckets after removal")
	}
}

func tierForEntity(buckets TierBuckets, entityID string) pb.InterestTier {
	if buckets == nil {
		return pb.InterestTier_INTEREST_TIER_UNSPECIFIED
	}
	for tier, entities := range buckets {
		for _, entity := range entities {
			if entity.GetEntityId() == entityID {
				return tier
			}
		}
	}
	return pb.InterestTier_INTEREST_TIER_UNSPECIFIED
}
