package input

import (
	"sync"
	"testing"
	"time"

	"driftpursuit/broker/internal/logging"
)

type fakeClock struct {
	mu  sync.Mutex
	now time.Time
}

// 1.- Now returns the configured timestamp for deterministic gate decisions.
func (f *fakeClock) Now() time.Time {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.now
}

// 2.- Advance moves the internal clock forward to simulate elapsed time.
func (f *fakeClock) Advance(d time.Duration) {
	f.mu.Lock()
	f.now = f.now.Add(d)
	f.mu.Unlock()
}

func TestGateRejectsNonMonotonicSequence(t *testing.T) {
	clock := &fakeClock{now: time.Unix(0, 0)}
	gate := NewGate(Config{MaxAge: 250 * time.Millisecond, MinInterval: time.Second / 60}, logging.NewTestLogger(), WithClock(clock))

	//1.- Accept the initial frame to seed client state.
	first := gate.Evaluate(Frame{ClientID: "conn-1", SequenceID: 1})
	if !first.Accepted {
		t.Fatalf("first frame unexpectedly rejected: %+v", first)
	}

	//2.- Replay the previous sequence which should be rejected as out-of-order.
	second := gate.Evaluate(Frame{ClientID: "conn-1", SequenceID: 1})
	if second.Accepted || second.Reason != DropReasonSequence {
		t.Fatalf("expected sequence drop, got %+v", second)
	}

	metrics := gate.Metrics()
	if metrics["conn-1"].Sequence != 1 {
		t.Fatalf("sequence drops = %d, want 1", metrics["conn-1"].Sequence)
	}
}

func TestGateRejectsStaleFrames(t *testing.T) {
	clock := &fakeClock{now: time.Unix(0, 0)}
	gate := NewGate(Config{MaxAge: 250 * time.Millisecond, MinInterval: time.Second / 60}, logging.NewTestLogger(), WithClock(clock))

	//1.- Accept an initial frame to establish the baseline sequence and timestamp.
	if decision := gate.Evaluate(Frame{ClientID: "pilot", SequenceID: 1}); !decision.Accepted {
		t.Fatalf("initial frame rejected: %+v", decision)
	}

	//2.- Simulate a delayed delivery well beyond the freshness budget.
	clock.Advance(600 * time.Millisecond)
	stale := gate.Evaluate(Frame{ClientID: "pilot", SequenceID: 2})
	if stale.Accepted || stale.Reason != DropReasonStale {
		t.Fatalf("expected stale drop, got %+v", stale)
	}

	if metrics := gate.Metrics()["pilot"]; metrics.Stale != 1 {
		t.Fatalf("stale drops = %d, want 1", metrics.Stale)
	}
}

func TestGateRateLimitsHighFrequencyFrames(t *testing.T) {
	clock := &fakeClock{now: time.Unix(0, 0)}
	gate := NewGate(Config{MaxAge: 250 * time.Millisecond, MinInterval: time.Second / 60}, logging.NewTestLogger(), WithClock(clock))

	//1.- First frame should pass through without restriction.
	if decision := gate.Evaluate(Frame{ClientID: "conn", SequenceID: 1}); !decision.Accepted {
		t.Fatalf("initial frame rejected: %+v", decision)
	}

	//2.- Advance less than the 60 Hz interval and verify rate limiting kicks in.
	clock.Advance(5 * time.Millisecond)
	burst := gate.Evaluate(Frame{ClientID: "conn", SequenceID: 2})
	if burst.Accepted || burst.Reason != DropReasonRateLimited {
		t.Fatalf("expected rate limit drop, got %+v", burst)
	}

	if metrics := gate.Metrics()["conn"]; metrics.RateLimited != 1 {
		t.Fatalf("rate limited drops = %d, want 1", metrics.RateLimited)
	}
}

func TestGateForgetClearsClientState(t *testing.T) {
	clock := &fakeClock{now: time.Unix(0, 0)}
	gate := NewGate(Config{MaxAge: 250 * time.Millisecond, MinInterval: time.Second / 60}, logging.NewTestLogger(), WithClock(clock))

	//1.- Accept an initial frame to populate client state and metrics.
	if decision := gate.Evaluate(Frame{ClientID: "conn", SequenceID: 1}); !decision.Accepted {
		t.Fatalf("initial frame rejected: %+v", decision)
	}
	gate.Evaluate(Frame{ClientID: "conn", SequenceID: 1}) // trigger sequence drop

	//2.- Forget the client and ensure a fresh sequence is permitted again.
	gate.Forget("conn")
	if metrics := gate.Metrics()["conn"]; metrics.Sequence != 0 {
		t.Fatalf("expected metrics reset after forget, got %+v", metrics)
	}
	clock.Advance(time.Second)
	if decision := gate.Evaluate(Frame{ClientID: "conn", SequenceID: 1}); !decision.Accepted {
		t.Fatalf("expected new session acceptance, got %+v", decision)
	}
}
