package networking

import (
	"sync"

	pb "driftpursuit/broker/internal/proto/pb"
)

// SnapshotMetrics tracks size and drop counters for world snapshot publications.
type SnapshotMetrics struct {
	mu    sync.RWMutex
	bytes map[string]int64
	drops map[pb.InterestTier]int64
}

// NewSnapshotMetrics constructs an empty metrics tracker.
func NewSnapshotMetrics() *SnapshotMetrics {
	return &SnapshotMetrics{
		bytes: make(map[string]int64),
		drops: make(map[pb.InterestTier]int64),
	}
}

// Observe records the encoded payload size and tier drop counts for a client.
func (m *SnapshotMetrics) Observe(clientID string, payloadBytes int, dropped map[pb.InterestTier]int) {
	if m == nil {
		return
	}
	//1.- Promote the payload size to int64 for consistent accumulation.
	size := int64(payloadBytes)
	if size < 0 {
		size = 0
	}
	//2.- Update the gauges and counters while holding the mutex.
	m.mu.Lock()
	if clientID != "" {
		m.bytes[clientID] = size
	}
	for tier, count := range dropped {
		if count <= 0 {
			continue
		}
		m.drops[tier] += int64(count)
	}
	m.mu.Unlock()
}

// ForgetClient removes the tracked gauges for a disconnected client.
func (m *SnapshotMetrics) ForgetClient(clientID string) {
	if m == nil || clientID == "" {
		return
	}
	//1.- Delete the client entry to avoid exporting stale gauges.
	m.mu.Lock()
	delete(m.bytes, clientID)
	m.mu.Unlock()
}

// BytesPerClient returns a copy of the latest encoded payload size per client.
func (m *SnapshotMetrics) BytesPerClient() map[string]int64 {
	if m == nil {
		return nil
	}
	//1.- Copy the gauge map to shield callers from concurrent mutation.
	m.mu.RLock()
	defer m.mu.RUnlock()
	if len(m.bytes) == 0 {
		return nil
	}
	out := make(map[string]int64, len(m.bytes))
	for clientID, size := range m.bytes {
		out[clientID] = size
	}
	return out
}

// DropCounts returns the cumulative number of dropped entities per tier.
func (m *SnapshotMetrics) DropCounts() map[pb.InterestTier]int64 {
	if m == nil {
		return nil
	}
	//1.- Snapshot the drop counters so metrics handlers can iterate safely.
	m.mu.RLock()
	defer m.mu.RUnlock()
	if len(m.drops) == 0 {
		return nil
	}
	out := make(map[pb.InterestTier]int64, len(m.drops))
	for tier, count := range m.drops {
		out[tier] = count
	}
	return out
}
