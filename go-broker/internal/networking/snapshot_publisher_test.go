package networking

import (
	"testing"

	pb "driftpursuit/broker/internal/proto/pb"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

func TestSnapshotPublisherBudgeting(t *testing.T) {
	source := &pb.WorldSnapshot{SchemaVersion: "1.0.0", CapturedAtMs: 77}
	self := &pb.EntitySnapshot{SchemaVersion: "1.0.0", EntityId: "self", Active: true}
	radar := &pb.EntitySnapshot{SchemaVersion: "1.0.0", EntityId: "radar", Active: true}

	buckets := TierBuckets{
		pb.InterestTier_INTEREST_TIER_SELF:  {self},
		pb.InterestTier_INTEREST_TIER_RADAR: {radar},
	}

	baseSize := proto.Size(&pb.WorldSnapshot{SchemaVersion: source.GetSchemaVersion(), CapturedAtMs: source.GetCapturedAtMs()})
	essential := proto.Size(self) + proto.Size(&pb.TierAssignment{SchemaVersion: self.GetSchemaVersion(), ObserverId: "observer", EntityId: self.GetEntityId(), Tier: pb.InterestTier_INTEREST_TIER_SELF})
	publisher := NewSnapshotPublisher(baseSize + essential + 1)

	snapshot, err := publisher.Build("observer", source, buckets)
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	if len(snapshot.Payload) == 0 {
		t.Fatalf("expected payload bytes")
	}
	if snapshot.Result.Dropped[pb.InterestTier_INTEREST_TIER_RADAR] == 0 {
		t.Fatalf("expected radar tier drop tracking")
	}

	var decoded pb.WorldSnapshot
	if err := protojson.Unmarshal(snapshot.Payload, &decoded); err != nil {
		t.Fatalf("failed to decode payload: %v", err)
	}
	if len(decoded.GetEntities()) != 1 || decoded.Entities[0].GetEntityId() != "self" {
		t.Fatalf("unexpected entities in payload: %+v", decoded.Entities)
	}
}
