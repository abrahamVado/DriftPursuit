package simulation

import (
	"sync"
	"time"
)

// TickMetricsSnapshot summarises observed server tick durations.
type TickMetricsSnapshot struct {
	Samples int
	Average time.Duration
	Max     time.Duration
	Last    time.Duration
}

// AverageFPS derives the frames-per-second equivalent of the sampled tick duration.
func (s TickMetricsSnapshot) AverageFPS() float64 {
	if s.Average <= 0 {
		return 0
	}
	return float64(time.Second) / float64(s.Average)
}

// TickMonitor accumulates timing statistics for the simulation loop.
type TickMonitor struct {
	mu      sync.Mutex
	samples int
	total   time.Duration
	max     time.Duration
	last    time.Duration
}

// NewTickMonitor constructs an empty monitor ready to collect samples.
func NewTickMonitor() *TickMonitor {
	return &TickMonitor{}
}

// Observe records the duration of a completed simulation tick.
func (m *TickMonitor) Observe(duration time.Duration) {
	if m == nil || duration <= 0 {
		return
	}
	m.mu.Lock()
	// //1.- Accumulate the sample count and aggregate duration for average calculations.
	m.samples++
	m.total += duration
	// //2.- Track the worst-case tick so operators can spot spikes quickly.
	if duration > m.max {
		m.max = duration
	}
	// //3.- Remember the latest tick for real-time dashboards.
	m.last = duration
	m.mu.Unlock()
}

// Snapshot returns a copy of the aggregated tick statistics.
func (m *TickMonitor) Snapshot() TickMetricsSnapshot {
	if m == nil {
		return TickMetricsSnapshot{}
	}
	m.mu.Lock()
	samples := m.samples
	total := m.total
	max := m.max
	last := m.last
	m.mu.Unlock()

	average := time.Duration(0)
	if samples > 0 {
		average = total / time.Duration(samples)
	}
	return TickMetricsSnapshot{Samples: samples, Average: average, Max: max, Last: last}
}

// Reset clears the accumulated statistics so a fresh match can begin cleanly.
func (m *TickMonitor) Reset() {
	if m == nil {
		return
	}
	m.mu.Lock()
	// //1.- Zero out all internal counters so subsequent snapshots start from scratch.
	m.samples = 0
	m.total = 0
	m.max = 0
	m.last = 0
	m.mu.Unlock()
}
