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

	baseSize := proto.Size(&pb.WorldSnapshot{SchemaVersion: source.GetSchemaVersion(), CapturedAtMs: source.GetCapturedAtMs(), ComponentPriorities: defaultComponentPriorities()})
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

func TestBudgetPlannerPreservesReconciliationMetadata(t *testing.T) {
	//1.- Prepare a world snapshot carrying reconciliation metadata at both the envelope and entity layers.
	alpha := &pb.EntitySnapshot{SchemaVersion: "1.0.0", EntityId: "alpha", Active: true, TickId: 77, Keyframe: true}
	bravo := &pb.EntitySnapshot{SchemaVersion: "1.0.0", EntityId: "bravo", Active: true, TickId: 76, Keyframe: false}
	source := &pb.WorldSnapshot{SchemaVersion: "1.0.0", CapturedAtMs: 321, TickId: 77, Keyframe: true, Entities: []*pb.EntitySnapshot{alpha, bravo}}

	buckets := TierBuckets{
		pb.InterestTier_INTEREST_TIER_SELF:   {alpha},
		pb.InterestTier_INTEREST_TIER_NEARBY: {bravo},
	}

	//2.- Execute the planner with an ample budget so every entity survives filtering.
	planner := NewBudgetPlanner(0)
	result := planner.Plan("observer", source, buckets)

	//3.- Assert that the world-level metadata flows through untouched for client reconciliation buffers.
	if result.Snapshot.GetTickId() != source.GetTickId() {
		t.Fatalf("tick id mismatch: got %d, want %d", result.Snapshot.GetTickId(), source.GetTickId())
	}
	if result.Snapshot.GetKeyframe() != source.GetKeyframe() {
		t.Fatalf("keyframe flag mismatch: got %v, want %v", result.Snapshot.GetKeyframe(), source.GetKeyframe())
	}

	//4.- Validate that per-entity reconciliation metadata persists after cloning and budgeting.
	preserved := map[string]*pb.EntitySnapshot{}
	for _, entity := range result.Snapshot.GetEntities() {
		preserved[entity.GetEntityId()] = entity
	}
	if entity := preserved[alpha.GetEntityId()]; entity == nil || entity.GetTickId() != alpha.GetTickId() || entity.GetKeyframe() != alpha.GetKeyframe() {
		t.Fatalf("alpha reconciliation metadata lost: %+v", entity)
	}
	if entity := preserved[bravo.GetEntityId()]; entity == nil || entity.GetTickId() != bravo.GetTickId() || entity.GetKeyframe() != bravo.GetKeyframe() {
		t.Fatalf("bravo reconciliation metadata lost: %+v", entity)
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

func TestBudgetPlannerAnnotatesComponentPriorities(t *testing.T) {
	source := &pb.WorldSnapshot{SchemaVersion: "1.0.0", CapturedAtMs: 99}
	planner := NewBudgetPlanner(512)

	result := planner.Plan("observer", source, nil)
	priorities := result.Snapshot.GetComponentPriorities()
	if len(priorities) != len(componentPriorityOrder) {
		t.Fatalf("expected %d component priorities, got %d", len(componentPriorityOrder), len(priorities))
	}
	for idx, priority := range priorities {
		expected := componentPriorityOrder[idx]
		if priority.GetComponent() != expected.component {
			t.Fatalf("priority %d expected component %v, got %v", idx, expected.component, priority.GetComponent())
		}
		if priority.GetPriority() != expected.priority {
			t.Fatalf("priority %d expected value %d, got %d", idx, expected.priority, priority.GetPriority())
		}
	}
}

func TestBudgetPlannerShedsComponentsInPriorityOrder(t *testing.T) {
	source := &pb.WorldSnapshot{SchemaVersion: "1.0.0", CapturedAtMs: 1234}
	self := &pb.EntitySnapshot{
		SchemaVersion:     "1.0.0",
		EntityId:          "self",
		Active:            true,
		Position:          &pb.Vector3{X: 1, Y: 2, Z: 3},
		Velocity:          &pb.Vector3{X: 10, Y: 0, Z: 0},
		Orientation:       &pb.Orientation{YawDeg: 90, PitchDeg: 0, RollDeg: 0},
		SpeedMps:          42,
		EntityType:        "fighter",
		RadarCrossSection: 5.5,
		CapturedAtMs:      111,
	}
	near := &pb.EntitySnapshot{
		SchemaVersion:     "1.0.0",
		EntityId:          "near",
		Active:            true,
		Position:          &pb.Vector3{X: 4, Y: 5, Z: 6},
		Velocity:          &pb.Vector3{X: -5, Y: 3, Z: 0},
		Orientation:       &pb.Orientation{YawDeg: 45, PitchDeg: 5, RollDeg: 1},
		SpeedMps:          55,
		EntityType:        "bogey",
		RadarCrossSection: 3.2,
		CapturedAtMs:      222,
	}
	radar := &pb.EntitySnapshot{
		SchemaVersion: "1.0.0",
		EntityId:      "radar",
		Active:        true,
		Position:      &pb.Vector3{X: 7, Y: 8, Z: 9},
		CapturedAtMs:  333,
	}

	buckets := TierBuckets{
		pb.InterestTier_INTEREST_TIER_SELF:   {self},
		pb.InterestTier_INTEREST_TIER_NEARBY: {near},
		pb.InterestTier_INTEREST_TIER_RADAR:  {radar},
	}

	baseSnapshot := &pb.WorldSnapshot{
		SchemaVersion:       source.GetSchemaVersion(),
		CapturedAtMs:        source.GetCapturedAtMs(),
		ComponentPriorities: defaultComponentPriorities(),
	}
	baseSize := proto.Size(baseSnapshot)

	assignSelf := &pb.TierAssignment{SchemaVersion: self.GetSchemaVersion(), ObserverId: "observer", EntityId: self.GetEntityId(), Tier: pb.InterestTier_INTEREST_TIER_SELF, ComputedAtMs: self.GetCapturedAtMs()}
	assignNear := &pb.TierAssignment{SchemaVersion: near.GetSchemaVersion(), ObserverId: "observer", EntityId: near.GetEntityId(), Tier: pb.InterestTier_INTEREST_TIER_NEARBY, ComputedAtMs: near.GetCapturedAtMs()}
	assignRadar := &pb.TierAssignment{SchemaVersion: radar.GetSchemaVersion(), ObserverId: "observer", EntityId: radar.GetEntityId(), Tier: pb.InterestTier_INTEREST_TIER_RADAR, ComputedAtMs: radar.GetCapturedAtMs()}

	nearNoCosmetics := proto.Clone(near).(*pb.EntitySnapshot)
	nearNoCosmetics.EntityType = ""
	nearNoCosmetics.RadarCrossSection = 0
	nearNoOrientation := proto.Clone(nearNoCosmetics).(*pb.EntitySnapshot)
	nearNoOrientation.Orientation = nil
	nearNoVelocity := proto.Clone(nearNoOrientation).(*pb.EntitySnapshot)
	nearNoVelocity.Velocity = nil
	nearNoVelocity.SpeedMps = 0

	fullSize := baseSize + proto.Size(self) + proto.Size(assignSelf) + proto.Size(near) + proto.Size(assignNear) + proto.Size(radar) + proto.Size(assignRadar)
	radarContribution := proto.Size(radar) + proto.Size(assignRadar)
	cosmeticsSavings := proto.Size(near) - proto.Size(nearNoCosmetics)
	orientationSavings := proto.Size(nearNoCosmetics) - proto.Size(nearNoOrientation)
	velocitySavings := proto.Size(nearNoOrientation) - proto.Size(nearNoVelocity)
	nearbyContribution := proto.Size(nearNoVelocity) + proto.Size(assignNear)

	type testCase struct {
		name   string
		budget int
		check  func(t *testing.T, result BudgetResult)
	}

	cases := []testCase{
		{
			name:   "drops radar first",
			budget: fullSize - radarContribution,
			check: func(t *testing.T, result BudgetResult) {
				if result.Dropped[pb.InterestTier_INTEREST_TIER_RADAR] != 1 {
					t.Fatalf("expected radar tier drop, got %d", result.Dropped[pb.InterestTier_INTEREST_TIER_RADAR])
				}
				if entity := findEntity(result.Snapshot.Entities, "near"); entity == nil || entity.GetEntityType() == "" {
					t.Fatalf("expected near entity cosmetics intact after radar drop")
				}
			},
		},
		{
			name:   "strips cosmetics",
			budget: fullSize - radarContribution - cosmeticsSavings,
			check: func(t *testing.T, result BudgetResult) {
				nearEntity := findEntity(result.Snapshot.Entities, "near")
				if nearEntity == nil {
					t.Fatalf("expected near entity present")
				}
				if nearEntity.GetEntityType() != "" || nearEntity.GetRadarCrossSection() != 0 {
					t.Fatalf("expected cosmetics removed, got %+v", nearEntity)
				}
				if nearEntity.GetOrientation() == nil {
					t.Fatalf("expected orientation intact at cosmetics stage")
				}
			},
		},
		{
			name:   "strips orientation",
			budget: fullSize - radarContribution - cosmeticsSavings - orientationSavings,
			check: func(t *testing.T, result BudgetResult) {
				nearEntity := findEntity(result.Snapshot.Entities, "near")
				if nearEntity == nil {
					t.Fatalf("expected near entity present")
				}
				if nearEntity.GetOrientation() != nil {
					t.Fatalf("expected orientation removed")
				}
				if nearEntity.GetVelocity() == nil {
					t.Fatalf("velocity should still be present before velocity stripping")
				}
			},
		},
		{
			name:   "strips velocity",
			budget: fullSize - radarContribution - cosmeticsSavings - orientationSavings - velocitySavings,
			check: func(t *testing.T, result BudgetResult) {
				nearEntity := findEntity(result.Snapshot.Entities, "near")
				if nearEntity == nil {
					t.Fatalf("expected near entity present")
				}
				if nearEntity.GetVelocity() != nil || nearEntity.GetSpeedMps() != 0 {
					t.Fatalf("expected velocity removed, got %+v", nearEntity)
				}
			},
		},
		{
			name:   "drops nearby last",
			budget: fullSize - radarContribution - cosmeticsSavings - orientationSavings - velocitySavings - nearbyContribution,
			check: func(t *testing.T, result BudgetResult) {
				if findEntity(result.Snapshot.Entities, "near") != nil {
					t.Fatalf("expected near entity dropped last")
				}
				if result.Dropped[pb.InterestTier_INTEREST_TIER_NEARBY] == 0 {
					t.Fatalf("expected nearby tier drop recorded")
				}
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			planner := NewBudgetPlanner(tc.budget)
			result := planner.Plan("observer", source, buckets)
			if result.BytesUsed > planner.maxBytes {
				t.Fatalf("bytes used %d exceeds budget %d", result.BytesUsed, planner.maxBytes)
			}
			tc.check(t, result)
		})
	}
}

func findEntity(entities []*pb.EntitySnapshot, id string) *pb.EntitySnapshot {
	for _, entity := range entities {
		if entity.GetEntityId() == id {
			return entity
		}
	}
	return nil
}
