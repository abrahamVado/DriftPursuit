package networking

import (
	"testing"

	pb "driftpursuit/broker/internal/proto/pb"
	"google.golang.org/protobuf/proto"
)

func TestBudgetPlannerKeepsEssentialTiers(t *testing.T) {
	source := &pb.WorldSnapshot{SchemaVersion: "1.0.0", CapturedAtMs: 1234}
	self := &pb.EntitySnapshot{SchemaVersion: "1.0.0", EntityId: "self", Active: true}
	near := &pb.EntitySnapshot{SchemaVersion: "1.0.0", EntityId: "near", Active: true}
	radar := &pb.EntitySnapshot{SchemaVersion: "1.0.0", EntityId: "radar", Active: true}
	extended := &pb.EntitySnapshot{SchemaVersion: "1.0.0", EntityId: "extended", Active: true}

	buckets := TierBuckets{
		pb.InterestTier_INTEREST_TIER_SELF:     {self},
		pb.InterestTier_INTEREST_TIER_NEARBY:   {near},
		pb.InterestTier_INTEREST_TIER_RADAR:    {radar},
		pb.InterestTier_INTEREST_TIER_EXTENDED: {extended},
	}

	baseSize := proto.Size(&pb.WorldSnapshot{SchemaVersion: source.GetSchemaVersion(), CapturedAtMs: source.GetCapturedAtMs()})
	essential := proto.Size(self) + proto.Size(&pb.TierAssignment{SchemaVersion: self.GetSchemaVersion(), ObserverId: "observer", EntityId: self.GetEntityId(), Tier: pb.InterestTier_INTEREST_TIER_SELF})
	essential += proto.Size(near) + proto.Size(&pb.TierAssignment{SchemaVersion: near.GetSchemaVersion(), ObserverId: "observer", EntityId: near.GetEntityId(), Tier: pb.InterestTier_INTEREST_TIER_NEARBY})
	planner := NewBudgetPlanner(baseSize + essential + 1)

	result := planner.Plan("observer", source, buckets)

	if len(result.Snapshot.GetEntities()) != 2 {
		t.Fatalf("expected only essential entities, got %d", len(result.Snapshot.GetEntities()))
	}
	ids := []string{result.Snapshot.Entities[0].GetEntityId(), result.Snapshot.Entities[1].GetEntityId()}
	if !(contains(ids, "self") && contains(ids, "near")) {
		t.Fatalf("unexpected entity ids: %v", ids)
	}
	if result.Dropped[pb.InterestTier_INTEREST_TIER_RADAR] == 0 {
		t.Fatalf("expected radar tier to be dropped")
	}
	if !result.Exhausted {
		t.Fatalf("expected planner to report exhausted budget")
	}
}

func TestBudgetPlannerUnlimitedBudgetIncludesAll(t *testing.T) {
	source := &pb.WorldSnapshot{SchemaVersion: "1.0.0", CapturedAtMs: 42}
	buckets := TierBuckets{
		pb.InterestTier_INTEREST_TIER_SELF: {
			&pb.EntitySnapshot{SchemaVersion: "1.0.0", EntityId: "self", Active: true},
		},
		pb.InterestTier_INTEREST_TIER_PASSIVE: {
			&pb.EntitySnapshot{SchemaVersion: "1.0.0", EntityId: "passive", Active: false},
		},
	}

	planner := NewBudgetPlanner(0)
	result := planner.Plan("observer", source, buckets)

	if len(result.Snapshot.GetEntities()) != 2 {
		t.Fatalf("expected all entities to be included, got %d", len(result.Snapshot.GetEntities()))
	}
	if result.Exhausted {
		t.Fatalf("did not expect budget exhaustion")
	}
}

func contains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
