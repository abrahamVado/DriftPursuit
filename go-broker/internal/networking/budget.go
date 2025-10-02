package networking

import (
	"math"

	pb "driftpursuit/broker/internal/proto/pb"
	"google.golang.org/protobuf/proto"
)

// BudgetPlanner ranks entities for a particular observer and enforces the byte
// budget for outbound world snapshots.
type BudgetPlanner struct {
	maxBytes  int
	tierOrder []pb.InterestTier
	essential map[pb.InterestTier]struct{}
}

// BudgetResult summarises the outcome of a planning pass for a single client.
type BudgetResult struct {
	Snapshot    *pb.WorldSnapshot
	BytesUsed   int
	BytesByTier map[pb.InterestTier]int
	Dropped     map[pb.InterestTier]int
	Exhausted   bool
}

type plannedEntity struct {
	tier       pb.InterestTier
	entity     *pb.EntitySnapshot
	assignment *pb.TierAssignment
	dropped    bool
}

var componentPriorityOrder = []struct {
	component pb.SnapshotComponent
	priority  uint32
}{
	{component: pb.SnapshotComponent_SNAPSHOT_COMPONENT_RADAR, priority: 1},
	{component: pb.SnapshotComponent_SNAPSHOT_COMPONENT_COSMETICS, priority: 2},
	{component: pb.SnapshotComponent_SNAPSHOT_COMPONENT_ORIENTATION, priority: 3},
	{component: pb.SnapshotComponent_SNAPSHOT_COMPONENT_VELOCITY, priority: 4},
	{component: pb.SnapshotComponent_SNAPSHOT_COMPONENT_NEARBY, priority: 5},
}

func defaultComponentPriorities() []*pb.SnapshotComponentPriority {
	//1.- Allocate an output slice matching the known component ordering.
	priorities := make([]*pb.SnapshotComponentPriority, 0, len(componentPriorityOrder))

	//2.- Clone the static table so each snapshot can mutate the list safely downstream.
	for _, entry := range componentPriorityOrder {
		priorities = append(priorities, &pb.SnapshotComponentPriority{
			Component: entry.component,
			Priority:  entry.priority,
		})
	}
	return priorities
}

// NewBudgetPlanner constructs a planner that honours the provided byte budget.
func NewBudgetPlanner(maxBytes int) *BudgetPlanner {
	if maxBytes <= 0 {
		maxBytes = math.MaxInt
	}
	return &BudgetPlanner{
		maxBytes: maxBytes,
		tierOrder: []pb.InterestTier{
			pb.InterestTier_INTEREST_TIER_SELF,
			pb.InterestTier_INTEREST_TIER_NEARBY,
			pb.InterestTier_INTEREST_TIER_RADAR,
			pb.InterestTier_INTEREST_TIER_EXTENDED,
			pb.InterestTier_INTEREST_TIER_PASSIVE,
		},
		essential: map[pb.InterestTier]struct{}{
			pb.InterestTier_INTEREST_TIER_SELF:   {},
			pb.InterestTier_INTEREST_TIER_NEARBY: {},
		},
	}
}

// Plan filters and orders entity snapshots so that the encoded payload remains
// within the configured budget.
func (p *BudgetPlanner) Plan(observerID string, source *pb.WorldSnapshot, buckets TierBuckets) BudgetResult {
	//1.- Seed the result with schema metadata copied from the source.
	result := BudgetResult{
		Snapshot: &pb.WorldSnapshot{
			SchemaVersion:       source.GetSchemaVersion(),
			CapturedAtMs:        source.GetCapturedAtMs(),
			TickId:              source.GetTickId(),
			Keyframe:            source.GetKeyframe(),
			ComponentPriorities: defaultComponentPriorities(),
		},
		BytesByTier: make(map[pb.InterestTier]int),
		Dropped:     make(map[pb.InterestTier]int),
	}
	if p == nil || result.Snapshot == nil {
		return result
	}

	//2.- Compute the base payload size contributed by snapshot metadata, including component priorities.
	result.BytesUsed = proto.Size(result.Snapshot)

	//3.- Track entities already included to guard against duplicates.
	included := make(map[string]struct{})
	planned := make([]*plannedEntity, 0)

	//4.- Iterate tiers from highest to lowest priority, enforcing the budget.
	for _, tier := range p.tierOrder {
		entities := buckets[tier]
		for _, entity := range entities {
			if entity == nil || entity.GetEntityId() == "" {
				continue
			}
			if _, exists := included[entity.GetEntityId()]; exists {
				continue
			}
			assignment := &pb.TierAssignment{
				SchemaVersion: entity.GetSchemaVersion(),
				ObserverId:    observerID,
				EntityId:      entity.GetEntityId(),
				Tier:          tier,
				ComputedAtMs:  entity.GetCapturedAtMs(),
			}
			clone := proto.Clone(entity).(*pb.EntitySnapshot)
			entitySize := proto.Size(clone)
			assignmentSize := proto.Size(assignment)
			nextSize := result.BytesUsed + entitySize + assignmentSize
			_, mustInclude := p.essential[tier]
			if nextSize > p.maxBytes && !mustInclude {
				result.Dropped[tier]++
				result.Exhausted = true
				continue
			}
			planned = append(planned, &plannedEntity{
				tier:       tier,
				entity:     clone,
				assignment: assignment,
			})
			included[entity.GetEntityId()] = struct{}{}
			result.BytesUsed = nextSize
			result.BytesByTier[tier] += entitySize + assignmentSize
		}
	}

	//5.- Shed lower priority payloads if the budget is still exceeded.
	if result.BytesUsed > p.maxBytes {
		result.Exhausted = true
		p.shedComponents(planned, &result)
	}

	//6.- Materialise the surviving entities into the snapshot envelope.
	for _, item := range planned {
		if item == nil || item.dropped {
			continue
		}
		result.Snapshot.Entities = append(result.Snapshot.Entities, item.entity)
		result.Snapshot.Assignments = append(result.Snapshot.Assignments, item.assignment)
	}

	if result.BytesUsed > p.maxBytes {
		result.Exhausted = true
	}
	return result
}

func (p *BudgetPlanner) shedComponents(plan []*plannedEntity, result *BudgetResult) {
	if p == nil || result == nil {
		return
	}

	//1.- Walk the ordered components and recover bytes until the budget is met.
	for _, spec := range componentPriorityOrder {
		if result.BytesUsed <= p.maxBytes {
			return
		}

		var saved int
		switch spec.component {
		case pb.SnapshotComponent_SNAPSHOT_COMPONENT_RADAR:
			saved = p.dropTier(plan, result, pb.InterestTier_INTEREST_TIER_RADAR)
		case pb.SnapshotComponent_SNAPSHOT_COMPONENT_COSMETICS,
			pb.SnapshotComponent_SNAPSHOT_COMPONENT_ORIENTATION,
			pb.SnapshotComponent_SNAPSHOT_COMPONENT_VELOCITY:
			saved = p.stripComponent(plan, result, spec.component)
		case pb.SnapshotComponent_SNAPSHOT_COMPONENT_NEARBY:
			saved = p.dropTier(plan, result, pb.InterestTier_INTEREST_TIER_NEARBY)
		}

		//2.- Apply the reclaimed bytes to the running total for the snapshot.
		if saved > 0 {
			result.BytesUsed -= saved
			if result.BytesUsed < 0 {
				result.BytesUsed = 0
			}
		}
	}
}

func (p *BudgetPlanner) dropTier(plan []*plannedEntity, result *BudgetResult, tier pb.InterestTier) int {
	if result == nil {
		return 0
	}

	//1.- Remove every planned entity assigned to the supplied tier.
	var saved int
	for _, item := range plan {
		if item == nil || item.dropped || item.tier != tier {
			continue
		}
		entitySize := proto.Size(item.entity)
		assignmentSize := proto.Size(item.assignment)
		saved += entitySize + assignmentSize
		item.dropped = true
		result.Dropped[tier]++
		result.BytesByTier[tier] -= entitySize + assignmentSize
		if result.BytesByTier[tier] < 0 {
			result.BytesByTier[tier] = 0
		}
	}

	//2.- Flag the outcome so callers know the plan was trimmed.
	if saved > 0 {
		result.Exhausted = true
	}
	return saved
}

func (p *BudgetPlanner) stripComponent(plan []*plannedEntity, result *BudgetResult, component pb.SnapshotComponent) int {
	if result == nil {
		return 0
	}

	//1.- Select the mutator matching the component being stripped.
	var transform func(*pb.EntitySnapshot) int
	switch component {
	case pb.SnapshotComponent_SNAPSHOT_COMPONENT_COSMETICS:
		transform = stripCosmetics
	case pb.SnapshotComponent_SNAPSHOT_COMPONENT_ORIENTATION:
		transform = stripOrientation
	case pb.SnapshotComponent_SNAPSHOT_COMPONENT_VELOCITY:
		transform = stripVelocity
	default:
		return 0
	}

	//2.- Apply the transformation across all non-self entities, tallying the bytes saved.
	var saved int
	for _, item := range plan {
		if item == nil || item.dropped || item.entity == nil {
			continue
		}
		if item.tier == pb.InterestTier_INTEREST_TIER_SELF {
			continue
		}
		reclaimed := transform(item.entity)
		if reclaimed <= 0 {
			continue
		}
		saved += reclaimed
		result.BytesByTier[item.tier] -= reclaimed
		if result.BytesByTier[item.tier] < 0 {
			result.BytesByTier[item.tier] = 0
		}
	}
	if saved > 0 {
		result.Exhausted = true
	}
	return saved
}

func stripCosmetics(entity *pb.EntitySnapshot) int {
	if entity == nil {
		return 0
	}

	//1.- Compute the original size so savings can be calculated.
	before := proto.Size(entity)

	//2.- Clear cosmetic fields that can be reconstituted lazily client-side.
	trimmed := false
	if entity.GetEntityType() != "" {
		entity.EntityType = ""
		trimmed = true
	}
	if entity.GetRadarCrossSection() != 0 {
		entity.RadarCrossSection = 0
		trimmed = true
	}

	if !trimmed {
		return 0
	}
	after := proto.Size(entity)
	if after > before {
		return 0
	}
	return before - after
}

func stripOrientation(entity *pb.EntitySnapshot) int {
	if entity == nil || entity.GetOrientation() == nil {
		return 0
	}

	//1.- Measure the original representation to establish the byte delta.
	before := proto.Size(entity)

	//2.- Drop the orientation payload and rely on default-aligned models instead.
	entity.Orientation = nil

	after := proto.Size(entity)
	if after > before {
		return 0
	}
	return before - after
}

func stripVelocity(entity *pb.EntitySnapshot) int {
	if entity == nil || (entity.GetVelocity() == nil && entity.GetSpeedMps() == 0) {
		return 0
	}

	//1.- Capture the original size for the savings calculation.
	before := proto.Size(entity)

	//2.- Reset velocity vectors so subscribers can fall back to positional extrapolation.
	entity.Velocity = nil
	entity.SpeedMps = 0

	after := proto.Size(entity)
	if after > before {
		return 0
	}
	return before - after
}
