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
			SchemaVersion: source.GetSchemaVersion(),
			CapturedAtMs:  source.GetCapturedAtMs(),
		},
		BytesByTier: make(map[pb.InterestTier]int),
		Dropped:     make(map[pb.InterestTier]int),
	}
	if p == nil || result.Snapshot == nil {
		return result
	}

	//2.- Compute the base payload size contributed by snapshot metadata.
	baseSize := proto.Size(result.Snapshot)
	result.BytesUsed = baseSize

	//3.- Track entities already included to guard against duplicates.
	included := make(map[string]struct{})

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
			entitySize := proto.Size(entity)
			assignmentSize := proto.Size(assignment)
			nextSize := result.BytesUsed + entitySize + assignmentSize
			_, mustInclude := p.essential[tier]
			if nextSize > p.maxBytes && !mustInclude {
				result.Dropped[tier]++
				result.Exhausted = true
				continue
			}
			result.Snapshot.Entities = append(result.Snapshot.Entities, proto.Clone(entity).(*pb.EntitySnapshot))
			result.Snapshot.Assignments = append(result.Snapshot.Assignments, assignment)
			included[entity.GetEntityId()] = struct{}{}
			result.BytesUsed = nextSize
			result.BytesByTier[tier] += entitySize + assignmentSize
		}
	}

	if result.BytesUsed > p.maxBytes {
		result.Exhausted = true
	}
	return result
}
