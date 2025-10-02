package networking

import (
	"google.golang.org/protobuf/encoding/protojson"

	pb "driftpursuit/broker/internal/proto/pb"
)

// SnapshotPublisher applies budgeting rules and encodes world snapshots per client.
type SnapshotPublisher struct {
	planner *BudgetPlanner
	encoder protojson.MarshalOptions
}

// ClientSnapshot represents the encoded payload and budget accounting for a client.
type ClientSnapshot struct {
	Payload []byte
	Result  BudgetResult
}

// NewSnapshotPublisher constructs a publisher enforcing the provided byte budget.
func NewSnapshotPublisher(maxBytes int) *SnapshotPublisher {
	return &SnapshotPublisher{
		planner: NewBudgetPlanner(maxBytes),
		encoder: protojson.MarshalOptions{EmitUnpopulated: false, UseEnumNumbers: false},
	}
}

// Build prepares a filtered world snapshot for the supplied observer.
func (p *SnapshotPublisher) Build(observerID string, source *pb.WorldSnapshot, buckets TierBuckets) (ClientSnapshot, error) {
	//1.- Guard against nil inputs so callers can fail gracefully.
	if p == nil || source == nil {
		return ClientSnapshot{}, nil
	}

	//2.- Delegate to the budget planner to select entities for the client.
	plan := p.planner.Plan(observerID, source, buckets)

	//3.- Marshal the tailored snapshot using the configured encoder.
	payload, err := p.encoder.Marshal(plan.Snapshot)
	if err != nil {
		return ClientSnapshot{}, err
	}
	return ClientSnapshot{Payload: payload, Result: plan}, nil
}
