package state

import (
	"sync"

	pb "driftpursuit/broker/internal/proto/pb"
	"google.golang.org/protobuf/proto"
)

// VehicleDiff groups updated and removed vehicle identifiers for a tick.
type VehicleDiff struct {
	Updated []*pb.VehicleState
	Removed []string
}

// VehicleStore maintains the current authoritative vehicle states with dirty tracking.
type VehicleStore struct {
	mu      sync.RWMutex
	states  map[string]*pb.VehicleState
	dirty   map[string]struct{}
	removed map[string]struct{}
}

// NewVehicleStore constructs a thread-safe vehicle state container.
func NewVehicleStore() *VehicleStore {
	return &VehicleStore{
		states:  make(map[string]*pb.VehicleState),
		dirty:   make(map[string]struct{}),
		removed: make(map[string]struct{}),
	}
}

// Upsert records or updates the vehicle state and flags it for the next diff.
func (s *VehicleStore) Upsert(state *pb.VehicleState) {
	if s == nil || state == nil || state.VehicleId == "" {
		return
	}

	//1.- Clone the protobuf to avoid concurrent mutation from callers.
	clone, ok := proto.Clone(state).(*pb.VehicleState)
	if !ok {
		return
	}

	s.mu.Lock()
	//2.- Replace the stored state and mark it dirty for the diff collector.
	s.states[clone.VehicleId] = clone
	delete(s.removed, clone.VehicleId)
	s.dirty[clone.VehicleId] = struct{}{}
	s.mu.Unlock()
}

// Remove deletes the vehicle state and marks its identifier for removal in the diff.
func (s *VehicleStore) Remove(vehicleID string) {
	if s == nil || vehicleID == "" {
		return
	}

	s.mu.Lock()
	//1.- Delete any stored state and tag the identifier as removed.
	delete(s.states, vehicleID)
	delete(s.dirty, vehicleID)
	s.removed[vehicleID] = struct{}{}
	s.mu.Unlock()
}

// Get returns a defensive clone of the stored vehicle state if present.
func (s *VehicleStore) Get(vehicleID string) *pb.VehicleState {
	if s == nil || vehicleID == "" {
		return nil
	}

	s.mu.RLock()
	//1.- Retrieve the stored pointer while holding the read lock.
	state, ok := s.states[vehicleID]
	s.mu.RUnlock()
	if !ok {
		return nil
	}

	//2.- Clone the protobuf so callers cannot mutate the store directly.
	clone, ok := proto.Clone(state).(*pb.VehicleState)
	if !ok {
		return nil
	}
	return clone
}

// Advance integrates vehicle motion for the fixed timestep and marks them dirty.
func (s *VehicleStore) Advance(stepSeconds float64) {
	if s == nil || stepSeconds <= 0 {
		return
	}

	s.mu.Lock()
	//1.- Iterate over each vehicle and update positions using velocity * dt.
	for id, vehicle := range s.states {
		if vehicle == nil {
			continue
		}
		pos := vehicle.Position
		vel := vehicle.Velocity
		if pos == nil || vel == nil {
			continue
		}
		pos.X += vel.X * stepSeconds
		pos.Y += vel.Y * stepSeconds
		pos.Z += vel.Z * stepSeconds
		//2.- Mark the vehicle as dirty so the diff includes the new position.
		s.dirty[id] = struct{}{}
	}
	s.mu.Unlock()
}

// ConsumeDiff collects and clears the pending vehicle updates and removals.
func (s *VehicleStore) ConsumeDiff() VehicleDiff {
	if s == nil {
		return VehicleDiff{}
	}

	s.mu.Lock()
	//1.- Snapshot the dirty and removed identifiers under lock.
	dirtyIDs := make([]string, 0, len(s.dirty))
	for id := range s.dirty {
		dirtyIDs = append(dirtyIDs, id)
	}
	removedIDs := make([]string, 0, len(s.removed))
	for id := range s.removed {
		removedIDs = append(removedIDs, id)
	}

	//2.- Reset the dirty/removed trackers before releasing the lock.
	s.dirty = make(map[string]struct{})
	s.removed = make(map[string]struct{})

	//3.- Clone the vehicle states corresponding to the dirty identifiers.
	updated := make([]*pb.VehicleState, 0, len(dirtyIDs))
	for _, id := range dirtyIDs {
		vehicle, ok := s.states[id]
		if !ok {
			continue
		}
		clone, ok := proto.Clone(vehicle).(*pb.VehicleState)
		if !ok {
			continue
		}
		updated = append(updated, clone)
	}
	s.mu.Unlock()

	return VehicleDiff{Updated: updated, Removed: removedIDs}
}

// Snapshot returns all stored vehicles as defensive clones.
func (s *VehicleStore) Snapshot() []*pb.VehicleState {
	if s == nil {
		return nil
	}

	s.mu.RLock()
	//1.- Allocate the slice large enough for all vehicles under the read lock.
	snapshot := make([]*pb.VehicleState, 0, len(s.states))
	for _, vehicle := range s.states {
		if vehicle == nil {
			continue
		}
		clone, ok := proto.Clone(vehicle).(*pb.VehicleState)
		if !ok {
			continue
		}
		snapshot = append(snapshot, clone)
	}
	s.mu.RUnlock()
	return snapshot
}
