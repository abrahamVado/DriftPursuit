package state

import (
	"testing"

	pb "driftpursuit/broker/internal/proto/pb"
)

func TestProjectileStoreDiff(t *testing.T) {
	store := NewProjectileStore()
	store.Upsert(&ProjectileState{ID: "proj-1", Velocity: Vector3{X: 3}})
	diff := store.ConsumeDiff()
	if len(diff.Updated) != 1 {
		t.Fatalf("expected updated projectile")
	}
	store.ConsumeDiff()
	store.Advance(1)
	diff = store.ConsumeDiff()
	if diff.Updated[0].Position.X != 3 {
		t.Fatalf("unexpected position %.2f", diff.Updated[0].Position.X)
	}
}

func TestProjectileStoreRemove(t *testing.T) {
	store := NewProjectileStore()
	store.Upsert(&ProjectileState{ID: "proj-2"})
	store.Remove("proj-2")
	diff := store.ConsumeDiff()
	if len(diff.Removed) != 1 || diff.Removed[0] != "proj-2" {
		t.Fatalf("expected removal diff")
	}
}

func TestEventStoreConsume(t *testing.T) {
	store := NewEventStore()
	store.Add(&pb.GameEvent{EventId: "evt-1"})
	diff := store.ConsumeDiff()
	if len(diff.Events) != 1 {
		t.Fatalf("expected one event")
	}
	if diff.Events[0].EventId != "evt-1" {
		t.Fatalf("unexpected event id")
	}
	if len(store.ConsumeDiff().Events) != 0 {
		t.Fatalf("expected empty after consume")
	}
}
