package combat

import "testing"

func TestSeedForOutcomeDeterministic(t *testing.T) {
	seedA := SeedForOutcome("match-123", "missile-9", "target-4")
	seedB := SeedForOutcome("match-123", "missile-9", "target-4")
	if seedA != seedB {
		t.Fatalf("expected identical seeds, got %d and %d", seedA, seedB)
	}
	seedC := SeedForOutcome("match-123", "missile-9", "target-5")
	if seedA == seedC {
		t.Fatalf("expected different target to alter the seed")
	}
}

func TestShouldDecoyBreakDeterministic(t *testing.T) {
	rollA := ShouldDecoyBreak("seed", "missile-1", "target-1", 0.5)
	rollB := ShouldDecoyBreak("seed", "missile-1", "target-1", 0.5)
	if rollA != rollB {
		t.Fatalf("expected deterministic outcome")
	}
}

func TestShouldDecoyBreakProbabilityBounds(t *testing.T) {
	if ShouldDecoyBreak("s", "m", "t", -1) {
		t.Fatalf("negative probability should not break")
	}
	if !ShouldDecoyBreak("s", "m", "t", 1.5) {
		t.Fatalf("probability >= 1 should always break")
	}
}
