package state

import (
	"fmt"
	"sync"
	"testing"
	"time"

	pb "driftpursuit/broker/internal/proto/pb"
)

func TestVehicleStoreUpsertAndDiff(t *testing.T) {
	store := NewVehicleStore()
	vehicle := &pb.VehicleState{VehicleId: "veh-1", Position: &pb.Vector3{}, Velocity: &pb.Vector3{X: 10}}

	store.Upsert(vehicle)
	diff := store.ConsumeDiff()
	if len(diff.Updated) != 1 {
		t.Fatalf("expected 1 updated vehicle, got %d", len(diff.Updated))
	}
	if diff.Updated[0].VehicleId != "veh-1" {
		t.Fatalf("unexpected vehicle id %q", diff.Updated[0].VehicleId)
	}

	if len(store.ConsumeDiff().Updated) != 0 {
		t.Fatalf("expected diff to be empty after consume")
	}
}

func TestVehicleStoreAdvanceMarksDirty(t *testing.T) {
	store := NewVehicleStore()
	store.Upsert(&pb.VehicleState{VehicleId: "veh-2", Position: &pb.Vector3{}, Velocity: &pb.Vector3{Y: 5}})
	store.ConsumeDiff()

	store.Advance(0.5)
	diff := store.ConsumeDiff()
	if len(diff.Updated) != 1 {
		t.Fatalf("expected 1 updated vehicle after advance, got %d", len(diff.Updated))
	}
	if diff.Updated[0].Position.Y != 2.5 {
		t.Fatalf("unexpected Y position %.2f", diff.Updated[0].Position.Y)
	}
}

func TestVehicleStoreConcurrentAccess(t *testing.T) {
	store := NewVehicleStore()
	wg := sync.WaitGroup{}
	for i := 0; i < 32; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			store.Upsert(&pb.VehicleState{VehicleId: fmt.Sprintf("veh-%d", idx)})
		}(i)
	}
	wg.Wait()
	if len(store.Snapshot()) != 32 {
		t.Fatalf("snapshot mismatch")
	}
}

func TestVehicleStoreGetClones(t *testing.T) {
	store := NewVehicleStore()
	store.Upsert(&pb.VehicleState{VehicleId: "veh-3", Position: &pb.Vector3{X: 1}})
	got := store.Get("veh-3")
	if got == nil {
		t.Fatalf("expected vehicle state")
	}
	got.Position.X = 999
	if store.Get("veh-3").Position.X == 999 {
		t.Fatalf("store should not reflect external mutation")
	}
}

func TestWorldStateAdvanceTick(t *testing.T) {
	world := NewWorldState()
	world.Vehicles.Upsert(&pb.VehicleState{VehicleId: "veh-4", Position: &pb.Vector3{}, Velocity: &pb.Vector3{Z: 2}})
	diff := world.AdvanceTick(500 * time.Millisecond)
	if len(diff.Vehicles.Updated) != 1 {
		t.Fatalf("expected vehicle diff")
	}
	if diff.Vehicles.Updated[0].Position.Z != 1 {
		t.Fatalf("unexpected Z position %.2f", diff.Vehicles.Updated[0].Position.Z)
	}
}
