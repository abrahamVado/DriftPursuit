package networking

import (
	"testing"

	pb "driftpursuit/broker/internal/proto/pb"
)

func TestSnapshotMetricsObserveAndForget(t *testing.T) {
	metrics := NewSnapshotMetrics()
	dropped := map[pb.InterestTier]int{pb.InterestTier_INTEREST_TIER_RADAR: 2}
	metrics.Observe("client-1", 128, dropped)

	bytes := metrics.BytesPerClient()
	if bytes["client-1"] != 128 {
		t.Fatalf("unexpected bytes recorded: %+v", bytes)
	}

	counts := metrics.DropCounts()
	if counts[pb.InterestTier_INTEREST_TIER_RADAR] != 2 {
		t.Fatalf("unexpected drop counts: %+v", counts)
	}

	metrics.ForgetClient("client-1")
	if remaining := metrics.BytesPerClient(); len(remaining) != 0 {
		t.Fatalf("expected client removal, got %+v", remaining)
	}
}
