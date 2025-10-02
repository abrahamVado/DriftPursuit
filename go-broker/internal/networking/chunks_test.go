package networking

import (
	"testing"

	pb "driftpursuit/broker/internal/proto/pb"
)

func TestArcChunkIndexEntitiesNear(t *testing.T) {
	index := NewArcChunkIndex(45)

	//1.- Register entities across multiple quadrants to exercise wrap-around lookups.
	index.Update("east", &pb.Vector3{X: 100, Y: 0})
	index.Update("north", &pb.Vector3{X: 0, Y: 100})
	index.Update("west", &pb.Vector3{X: -100, Y: 0})
	index.Update("global", nil)

	candidates := index.EntitiesNear(&pb.Vector3{X: 10, Y: 0}, 3)
	expected := map[string]bool{"east": true, "north": true, "global": true}
	//2.- Verify that the west entity is excluded because it falls outside the ±3 chunk window.
	for _, id := range candidates {
		if !expected[id] {
			t.Fatalf("unexpected entity %q in candidates", id)
		}
		delete(expected, id)
	}
	if len(expected) != 0 {
		t.Fatalf("missing expected entities: %v", expected)
	}

	//3.- Moving the observer to the southern quadrant should include the west entity.
	candidates = index.EntitiesNear(&pb.Vector3{X: 0, Y: -100}, 3)
	foundWest := false
	for _, id := range candidates {
		if id == "west" {
			foundWest = true
			break
		}
	}
	if !foundWest {
		t.Fatalf("expected west entity to appear after moving observer south, candidates=%v", candidates)
	}
}

func TestArcChunkIndexRemove(t *testing.T) {
	index := NewArcChunkIndex(30)

	//1.- Register and then remove an entity to ensure the slot is cleared.
	index.Update("alpha", &pb.Vector3{X: 50, Y: 0})
	index.Remove("alpha")

	candidates := index.EntitiesNear(&pb.Vector3{X: 50, Y: 0}, 3)
	for _, id := range candidates {
		if id == "alpha" {
			t.Fatalf("expected alpha to be removed from candidates")
		}
	}
}
