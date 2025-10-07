package main

import (
	"strings"
	"sync"

	pb "driftpursuit/broker/internal/proto/pb"
)

const defaultWorldID = "world-1"

type vehicleOccupant struct {
	VehicleID   string  `json:"vehicle_id"`
	PlayerID    string  `json:"player_id"`
	PlayerName  string  `json:"player_name"`
	LifePct     float64 `json:"life_pct"`
	UpdatedAtMs int64   `json:"updated_at_ms"`
}

type occupantDiffEnvelope struct {
	Updated []*vehicleOccupant `json:"updated,omitempty"`
	Removed []string           `json:"removed,omitempty"`
}

type vehicleOccupantRegistry struct {
	mu             sync.RWMutex
	byVehicle      map[string]vehicleOccupant
	playerVehicles map[string]string
}

func newVehicleOccupantRegistry() *vehicleOccupantRegistry {
	return &vehicleOccupantRegistry{
		//1.- Initialise the vehicle lookup so occupancy diffing remains O(1).
		byVehicle: make(map[string]vehicleOccupant),
		//2.- Track the reverse mapping to cleanly evict vehicles when a pilot disconnects.
		playerVehicles: make(map[string]string),
	}
}

func (r *vehicleOccupantRegistry) Record(playerID, playerName, vehicleID string, lifePct float64, updatedAt int64) vehicleOccupant {
	if r == nil {
		return vehicleOccupant{}
	}
	//1.- Normalise identifiers so repeated updates consolidate on the same key.
	trimmedVehicle := strings.TrimSpace(vehicleID)
	trimmedPlayer := strings.TrimSpace(playerID)
	if trimmedVehicle == "" || trimmedPlayer == "" {
		return vehicleOccupant{}
	}
	//2.- Prefer the supplied display name but fall back to the identifier.
	name := strings.TrimSpace(playerName)
	if name == "" {
		name = trimmedPlayer
	}
	occupant := vehicleOccupant{
		VehicleID:   trimmedVehicle,
		PlayerID:    trimmedPlayer,
		PlayerName:  name,
		LifePct:     clampUnitInterval(lifePct),
		UpdatedAtMs: updatedAt,
	}
	r.mu.Lock()
	//3.- Persist both the forward and reverse mapping for later diffs and evictions.
	r.byVehicle[trimmedVehicle] = occupant
	r.playerVehicles[trimmedPlayer] = trimmedVehicle
	r.mu.Unlock()
	return occupant
}

func (r *vehicleOccupantRegistry) ForgetVehicles(vehicleIDs []string) []string {
	if r == nil || len(vehicleIDs) == 0 {
		return nil
	}
	removed := make([]string, 0, len(vehicleIDs))
	r.mu.Lock()
	for _, id := range vehicleIDs {
		//1.- Skip blank identifiers to avoid populating the removal diff with empty entries.
		trimmed := strings.TrimSpace(id)
		if trimmed == "" {
			continue
		}
		//2.- Remove the stored occupant and reverse mapping when present.
		occupant, ok := r.byVehicle[trimmed]
		if !ok {
			continue
		}
		delete(r.byVehicle, trimmed)
		delete(r.playerVehicles, occupant.PlayerID)
		removed = append(removed, trimmed)
	}
	r.mu.Unlock()
	if len(removed) == 0 {
		return nil
	}
	//3.- Return a defensive copy so callers cannot mutate registry internals.
	clone := append([]string(nil), removed...)
	return clone
}

func (r *vehicleOccupantRegistry) ForgetPlayer(playerID string) []string {
	if r == nil {
		return nil
	}
	//1.- Normalise the identifier before attempting lookups.
	trimmed := strings.TrimSpace(playerID)
	if trimmed == "" {
		return nil
	}
	r.mu.Lock()
	//2.- Resolve the associated vehicle so we can cleanly evict state entries.
	vehicleID, ok := r.playerVehicles[trimmed]
	if !ok {
		r.mu.Unlock()
		return nil
	}
	delete(r.playerVehicles, trimmed)
	if vehicleID != "" {
		delete(r.byVehicle, vehicleID)
	}
	r.mu.Unlock()
	if vehicleID == "" {
		return nil
	}
	//3.- Surface the affected vehicle so callers may emit removal diffs.
	return []string{vehicleID}
}

func (r *vehicleOccupantRegistry) SnapshotFor(states []*pb.VehicleState) []*vehicleOccupant {
	if r == nil || len(states) == 0 {
		return nil
	}
	results := make([]*vehicleOccupant, 0, len(states))
	r.mu.Lock()
	for _, state := range states {
		if state == nil {
			continue
		}
		//1.- Match stored occupants to the diff entries by identifier.
		id := strings.TrimSpace(state.GetVehicleId())
		if id == "" {
			continue
		}
		occupant, ok := r.byVehicle[id]
		if !ok {
			continue
		}
		//2.- Refresh the cached health and timestamp from the authoritative vehicle state.
		occupant.LifePct = clampUnitInterval(state.GetEnergyRemainingPct())
		if ts := state.GetUpdatedAtMs(); ts != 0 {
			occupant.UpdatedAtMs = ts
		}
		//3.- Persist and expose a defensive clone for serialization.
		r.byVehicle[id] = occupant
		clone := occupant
		results = append(results, &clone)
	}
	r.mu.Unlock()
	if len(results) == 0 {
		return nil
	}
	return results
}

func clampUnitInterval(value float64) float64 {
	if value < 0 {
		return 0
	}
	if value > 1 {
		return 1
	}
	return value
}
