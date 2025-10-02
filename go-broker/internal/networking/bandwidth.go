package networking

import (
	"math"
	"sync"
	"time"
)

const (
	// DefaultBandwidthLimitBytesPerSecond caps per-client throughput at 48 kbps (decimal).
	DefaultBandwidthLimitBytesPerSecond = 48000.0 / 8.0
)

// BandwidthUsage captures the throttling state for a single client.
type BandwidthUsage struct {
	ClientID             string
	AvailableBytes       float64
	BytesPerSecond       float64
	ObservedSeconds      float64
	DeniedDeliveries     int64
	LastUpdatedTimestamp time.Time
}

type bandwidthBucket struct {
	tokens float64
	last   time.Time
	window time.Time
	sent   int64
	denied int64
}

// BandwidthRegulator enforces a token-bucket budget per client so long form sessions
// maintain the target throughput.
type BandwidthRegulator struct {
	mu       sync.Mutex
	buckets  map[string]*bandwidthBucket
	capacity float64
	refill   float64
	now      func() time.Time
}

// NewBandwidthRegulator constructs a regulator enforcing the supplied byte rate.
func NewBandwidthRegulator(targetBytesPerSecond float64, clock func() time.Time) *BandwidthRegulator {
	//1.- Normalise the configuration so downstream logic operates with sane defaults.
	if targetBytesPerSecond <= 0 {
		targetBytesPerSecond = DefaultBandwidthLimitBytesPerSecond
	}
	if clock == nil {
		clock = time.Now
	}
	return &BandwidthRegulator{
		buckets:  make(map[string]*bandwidthBucket),
		capacity: targetBytesPerSecond,
		refill:   targetBytesPerSecond,
		now:      clock,
	}
}

func (r *BandwidthRegulator) replenish(bucket *bandwidthBucket, now time.Time) {
	if bucket == nil {
		return
	}
	//1.- Skip negative intervals to protect against clock skew.
	if now.Before(bucket.last) {
		return
	}
	elapsed := now.Sub(bucket.last).Seconds()
	if elapsed <= 0 {
		bucket.last = now
		return
	}
	//2.- Accumulate fresh tokens using the configured refill rate.
	bucket.tokens += elapsed * r.refill
	if bucket.tokens > r.capacity {
		bucket.tokens = r.capacity
	}
	bucket.last = now
}

// Allow charges the requested payload size against the client's bandwidth budget.
func (r *BandwidthRegulator) Allow(clientID string, payloadBytes int) bool {
	if r == nil || clientID == "" || payloadBytes <= 0 {
		return true
	}
	r.mu.Lock()
	defer r.mu.Unlock()

	bucket := r.buckets[clientID]
	now := r.now()
	if bucket == nil {
		//1.- Seed new clients with a full bucket so they can burst immediately.
		bucket = &bandwidthBucket{tokens: r.capacity, last: now, window: now}
		r.buckets[clientID] = bucket
	}
	r.replenish(bucket, now)

	request := float64(payloadBytes)
	if request > bucket.tokens {
		//2.- Record the refusal so monitoring can surface sustained throttling.
		bucket.denied++
		return false
	}

	//3.- Deduct the approved payload and track throughput statistics.
	bucket.tokens -= request
	bucket.sent += int64(payloadBytes)
	if bucket.window.IsZero() {
		bucket.window = now
	}
	return true
}

// Forget removes the token bucket for a disconnected client.
func (r *BandwidthRegulator) Forget(clientID string) {
	if r == nil || clientID == "" {
		return
	}
	//1.- Drop the bucket so future SnapshotUsage calls do not emit stale metrics.
	r.mu.Lock()
	delete(r.buckets, clientID)
	r.mu.Unlock()
}

// SnapshotUsage reports the most recent throttling statistics per client.
func (r *BandwidthRegulator) SnapshotUsage() map[string]BandwidthUsage {
	if r == nil {
		return nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()

	if len(r.buckets) == 0 {
		return nil
	}

	//1.- Materialise a consistent view of every bucket by applying a refresh using the shared clock.
	now := r.now()
	snapshot := make(map[string]BandwidthUsage, len(r.buckets))
	for clientID, bucket := range r.buckets {
		if bucket == nil {
			continue
		}
		r.replenish(bucket, now)

		//2.- Compute the observed window and derive the sustained throughput sample.
		observed := now.Sub(bucket.window).Seconds()
		if observed <= 0 {
			observed = 0
		}
		rate := 0.0
		if observed > 0 {
			rate = float64(bucket.sent) / observed
		}

		//3.- Export the usage so Prometheus collectors and tests can inspect throttle health.
		snapshot[clientID] = BandwidthUsage{
			ClientID:             clientID,
			AvailableBytes:       math.Max(bucket.tokens, 0),
			BytesPerSecond:       rate,
			ObservedSeconds:      observed,
			DeniedDeliveries:     bucket.denied,
			LastUpdatedTimestamp: bucket.last,
		}
	}
	if len(snapshot) == 0 {
		return nil
	}
	return snapshot
}
