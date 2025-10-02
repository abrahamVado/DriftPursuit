package state

import "sync"

// ProjectileState tracks simplified projectile kinematics for broadcasting diffs.
type ProjectileState struct {
	ID        string  `json:"id"`
	Position  Vector3 `json:"position"`
	Velocity  Vector3 `json:"velocity"`
	Active    bool    `json:"active"`
	UpdatedAt int64   `json:"updated_at_ms"`
}

// Vector3 mirrors the protobuf vector definition for JSON serialization.
type Vector3 struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	Z float64 `json:"z"`
}

// ProjectileDiff aggregates updates and removals for projectiles.
type ProjectileDiff struct {
	Updated []*ProjectileState
	Removed []string
}

// ProjectileStore maintains projectile states with dirty tracking similar to vehicles.
type ProjectileStore struct {
	mu      sync.RWMutex
	states  map[string]*ProjectileState
	dirty   map[string]struct{}
	removed map[string]struct{}
}

// NewProjectileStore constructs a projectile container with initialized maps.
func NewProjectileStore() *ProjectileStore {
	return &ProjectileStore{
		states:  make(map[string]*ProjectileState),
		dirty:   make(map[string]struct{}),
		removed: make(map[string]struct{}),
	}
}

// Upsert records or updates a projectile state and schedules it for the next diff.
func (s *ProjectileStore) Upsert(state *ProjectileState) {
	if s == nil || state == nil || state.ID == "" {
		return
	}

	clone := *state

	s.mu.Lock()
	//1.- Store the cloned projectile and mark it dirty while clearing removal markers.
	s.states[clone.ID] = &clone
	delete(s.removed, clone.ID)
	s.dirty[clone.ID] = struct{}{}
	s.mu.Unlock()
}

// Remove deletes a projectile and queues its ID for removal broadcasting.
func (s *ProjectileStore) Remove(projectileID string) {
	if s == nil || projectileID == "" {
		return
	}

	s.mu.Lock()
	//1.- Remove any stored projectile, clear dirty flag, and track the removal.
	delete(s.states, projectileID)
	delete(s.dirty, projectileID)
	s.removed[projectileID] = struct{}{}
	s.mu.Unlock()
}

// Advance integrates projectile motion for a fixed timestep.
func (s *ProjectileStore) Advance(stepSeconds float64) {
	if s == nil || stepSeconds <= 0 {
		return
	}

	s.mu.Lock()
	//1.- Update projectile positions using simple Euler integration.
	for id, projectile := range s.states {
		if projectile == nil {
			continue
		}
		projectile.Position.X += projectile.Velocity.X * stepSeconds
		projectile.Position.Y += projectile.Velocity.Y * stepSeconds
		projectile.Position.Z += projectile.Velocity.Z * stepSeconds
		//2.- Mark projectile as dirty for diff emission.
		s.dirty[id] = struct{}{}
	}
	s.mu.Unlock()
}

// ConsumeDiff retrieves and clears pending projectile updates.
func (s *ProjectileStore) ConsumeDiff() ProjectileDiff {
	if s == nil {
		return ProjectileDiff{}
	}

	s.mu.Lock()
	//1.- Capture dirty IDs and removals before resetting trackers.
	dirtyIDs := make([]string, 0, len(s.dirty))
	for id := range s.dirty {
		dirtyIDs = append(dirtyIDs, id)
	}
	removedIDs := make([]string, 0, len(s.removed))
	for id := range s.removed {
		removedIDs = append(removedIDs, id)
	}

	s.dirty = make(map[string]struct{})
	s.removed = make(map[string]struct{})

	//2.- Clone the projectile states referenced by the dirty identifiers.
	updated := make([]*ProjectileState, 0, len(dirtyIDs))
	for _, id := range dirtyIDs {
		projectile, ok := s.states[id]
		if !ok || projectile == nil {
			continue
		}
		clone := *projectile
		updated = append(updated, &clone)
	}
	s.mu.Unlock()

	return ProjectileDiff{Updated: updated, Removed: removedIDs}
}

// Snapshot clones and returns every projectile state currently tracked.
func (s *ProjectileStore) Snapshot() []*ProjectileState {
	if s == nil {
		return nil
	}

	s.mu.RLock()
	//1.- Clone each projectile under the read lock to preserve isolation.
	snapshot := make([]*ProjectileState, 0, len(s.states))
	for _, projectile := range s.states {
		if projectile == nil {
			continue
		}
		clone := *projectile
		snapshot = append(snapshot, &clone)
	}
	s.mu.RUnlock()
	return snapshot
}
