package httpapi

import (
	"sync"
	"time"
)

// SlidingWindowLimiter enforces a maximum number of events within a time window.
type SlidingWindowLimiter struct {
	window time.Duration
	limit  int
	now    func() time.Time

	mu     sync.Mutex
	events []time.Time
}

// NewSlidingWindowLimiter constructs a limiter allowing up to limit events per window.
func NewSlidingWindowLimiter(window time.Duration, limit int, timeSource func() time.Time) *SlidingWindowLimiter {
	if window <= 0 || limit <= 0 {
		return &SlidingWindowLimiter{window: window, limit: limit}
	}
	if timeSource == nil {
		timeSource = time.Now
	}
	return &SlidingWindowLimiter{
		window: window,
		limit:  limit,
		now:    timeSource,
	}
}

// Allow reports whether the caller may proceed under the current rate limits.
func (l *SlidingWindowLimiter) Allow() bool {
	if l == nil || l.limit <= 0 || l.window <= 0 {
		return true
	}
	l.mu.Lock()
	defer l.mu.Unlock()

	now := l.now()
	cutoff := now.Add(-l.window)
	kept := l.events[:0]
	for _, ts := range l.events {
		if ts.After(cutoff) {
			kept = append(kept, ts)
		}
	}
	l.events = kept
	if len(l.events) >= l.limit {
		return false
	}
	l.events = append(l.events, now)
	return true
}
