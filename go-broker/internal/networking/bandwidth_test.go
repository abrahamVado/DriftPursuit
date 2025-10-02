package networking

import (
	"math"
	"testing"
	"time"
)

func TestBandwidthRegulatorEnforcesRate(t *testing.T) {
	current := time.Unix(0, 0)
	clock := func() time.Time { return current }
	regulator := NewBandwidthRegulator(100, clock)

	if !regulator.Allow("client-1", 60) {
		t.Fatalf("expected initial burst to be allowed")
	}
	if regulator.Allow("client-1", 50) {
		t.Fatalf("expected payload to be throttled while tokens depleted")
	}

	current = current.Add(500 * time.Millisecond)
	if !regulator.Allow("client-1", 50) {
		t.Fatalf("expected payload to pass after partial refill")
	}

	current = current.Add(time.Second)
	usage := regulator.SnapshotUsage()
	sample, ok := usage["client-1"]
	if !ok {
		t.Fatalf("missing usage sample for client")
	}
	if sample.DeniedDeliveries != 1 {
		t.Fatalf("expected one denied delivery, got %d", sample.DeniedDeliveries)
	}
	if sample.AvailableBytes <= 0 {
		t.Fatalf("expected available bytes to be positive, got %f", sample.AvailableBytes)
	}
	if sample.ObservedSeconds <= 0 {
		t.Fatalf("expected observed window to be positive")
	}
	if sample.BytesPerSecond <= 0 {
		t.Fatalf("expected non-zero throughput sample")
	}
	expectedRate := float64(110) / sample.ObservedSeconds
	if math.Abs(sample.BytesPerSecond-expectedRate) > 1e-6 {
		t.Fatalf("unexpected throughput: got %.6f want %.6f", sample.BytesPerSecond, expectedRate)
	}

	regulator.Forget("client-1")
	current = current.Add(time.Second)
	usage = regulator.SnapshotUsage()
	if len(usage) != 0 {
		t.Fatalf("expected usage map cleared after forget, got %d entries", len(usage))
	}
}
