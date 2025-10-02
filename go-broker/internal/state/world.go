package state

import "time"

// TickDiff collates all state deltas emitted for a simulation tick.
type TickDiff struct {
	Vehicles    VehicleDiff
	Projectiles ProjectileDiff
	Events      EventDiff
}

// HasChanges reports whether the diff contains any modifications worth broadcasting.
func (d TickDiff) HasChanges() bool {
	//1.- Check each sub diff for non-empty updates or removals.
	if len(d.Vehicles.Updated) > 0 || len(d.Vehicles.Removed) > 0 {
		return true
	}
	if len(d.Projectiles.Updated) > 0 || len(d.Projectiles.Removed) > 0 {
		return true
	}
	if len(d.Events.Events) > 0 {
		return true
	}
	return false
}

// WorldState holds the authoritative state containers for the simulation.
type WorldState struct {
	Vehicles    *VehicleStore
	Projectiles *ProjectileStore
	Events      *EventStore
}

// NewWorldState constructs the world containers with default implementations.
func NewWorldState() *WorldState {
	return &WorldState{
		Vehicles:    NewVehicleStore(),
		Projectiles: NewProjectileStore(),
		Events:      NewEventStore(),
	}
}

// AdvanceTick integrates motion for the provided step and collects the diff.
func (w *WorldState) AdvanceTick(step time.Duration) TickDiff {
	if w == nil {
		return TickDiff{}
	}

	//1.- Convert the duration to seconds for the integration helpers.
	stepSeconds := step.Seconds()
	//2.- Advance each store's state using the fixed timestep.
	w.Vehicles.Advance(stepSeconds)
	w.Projectiles.Advance(stepSeconds)
	//3.- Gather the diff from each store to broadcast downstream.
	return TickDiff{
		Vehicles:    w.Vehicles.ConsumeDiff(),
		Projectiles: w.Projectiles.ConsumeDiff(),
		Events:      w.Events.ConsumeDiff(),
	}
}

// Snapshot captures the entire world state for recovery or debugging.
func (w *WorldState) Snapshot() TickDiff {
	if w == nil {
		return TickDiff{}
	}

	//1.- Collect full snapshots from each store for a comprehensive diff.
	vehicles := w.Vehicles.Snapshot()
	projectiles := w.Projectiles.Snapshot()
	events := w.Events.ConsumeDiff()

	return TickDiff{
		Vehicles: VehicleDiff{
			Updated: vehicles,
		},
		Projectiles: ProjectileDiff{
			Updated: projectiles,
		},
		Events: events,
	}
}
