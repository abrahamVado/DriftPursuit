package httpapi

import (
	"testing"
	"time"
)

func TestSlidingWindowLimiter(t *testing.T) {
	now := time.Date(2024, time.January, 1, 0, 0, 0, 0, time.UTC)
	limiter := NewSlidingWindowLimiter(time.Minute, 2, func() time.Time { return now })

	if !limiter.Allow() || !limiter.Allow() {
		t.Fatal("expected first two calls to be allowed")
	}
	if limiter.Allow() {
		t.Fatal("expected third call to be denied")
	}

	now = now.Add(30 * time.Second)
	if limiter.Allow() {
		t.Fatal("expected call within window to still be denied")
	}

	now = now.Add(31 * time.Second)
	if !limiter.Allow() {
		t.Fatal("expected limiter to permit call after window passes")
	}
}

func TestSlidingWindowLimiterDisabled(t *testing.T) {
	if !NewSlidingWindowLimiter(0, 0, nil).Allow() {
		t.Fatal("limiter with zero configuration should allow")
	}
}
