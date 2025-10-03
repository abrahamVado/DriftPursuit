package combat

import (
	"math"
	"reflect"
	"testing"
	"time"
)

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

func TestDefaultECMProbabilityWindowCurve(t *testing.T) {
	window := DefaultECMProbabilityWindow()
	//1.- Validate the plateau phase stays at 65% for the first half of the window.
	early := window.ProbabilityAt(500 * time.Millisecond)
	if math.Abs(early-defaultECMInitialProbability) > 1e-9 {
		t.Fatalf("expected early probability %.2f, got %.6f", defaultECMInitialProbability, early)
	}
	midpoint := window.ProbabilityAt(2250 * time.Millisecond)
	//2.- Midpoint should interpolate halfway between the initial and final probabilities.
	expectedMid := defaultECMInitialProbability + (defaultECMFinalProbability-defaultECMInitialProbability)/2
	if math.Abs(midpoint-expectedMid) > 1e-9 {
		t.Fatalf("expected midpoint probability %.6f, got %.6f", expectedMid, midpoint)
	}
	late := window.ProbabilityAt(4 * time.Second)
	//3.- After the decay window the probability stabilises at the final 20%% value.
	if math.Abs(late-defaultECMFinalProbability) > 1e-9 {
		t.Fatalf("expected late probability %.2f, got %.6f", defaultECMFinalProbability, late)
	}
}

func TestMissileECMTrackerDeterministicTimeline(t *testing.T) {
	tracker := NewMissileECMTracker()
	window := DefaultECMProbabilityWindow()
	matchSeed := "seed"
	missileID := "missile-7"
	targetID := "target-3"
	samples := []time.Duration{250 * time.Millisecond, 1500 * time.Millisecond, 2250 * time.Millisecond, 3600 * time.Millisecond}
	firstRun := make([]bool, len(samples))
	//1.- Capture the deterministic timeline for the missile across the probability window.
	for idx, elapsed := range samples {
		firstRun[idx] = tracker.Resolve(matchSeed, missileID, targetID, elapsed, window)
	}
	repeat := tracker.Resolve(matchSeed, missileID, targetID, samples[len(samples)-1], window)
	if repeat != firstRun[len(firstRun)-1] {
		t.Fatalf("expected repeated query to reuse cached outcome")
	}
	tracker.Reset()
	secondRun := make([]bool, len(samples))
	//2.- Resetting the tracker should reproduce the identical deterministic sequence.
	for idx, elapsed := range samples {
		secondRun[idx] = tracker.Resolve(matchSeed, missileID, targetID, elapsed, window)
	}
	if !reflect.DeepEqual(firstRun, secondRun) {
		t.Fatalf("expected identical outcomes after reset, got %v and %v", firstRun, secondRun)
	}
}

func TestMissileECMTrackerMultipleMissiles(t *testing.T) {
	tracker := NewMissileECMTracker()
	window := DefaultECMProbabilityWindow()
	//1.- Resolve two missiles to ensure their RNG streams remain isolated.
	missileA := []bool{
		tracker.Resolve("seed", "missile-A", "target-1", time.Second, window),
		tracker.Resolve("seed", "missile-A", "target-1", 2600*time.Millisecond, window),
	}
	missileB := []bool{
		tracker.Resolve("seed", "missile-B", "target-2", time.Second, window),
		tracker.Resolve("seed", "missile-B", "target-2", 2600*time.Millisecond, window),
	}
	tracker.Reset()
	missileARepeat := []bool{
		tracker.Resolve("seed", "missile-A", "target-1", time.Second, window),
		tracker.Resolve("seed", "missile-A", "target-1", 2600*time.Millisecond, window),
	}
	missileBRepeat := []bool{
		tracker.Resolve("seed", "missile-B", "target-2", time.Second, window),
		tracker.Resolve("seed", "missile-B", "target-2", 2600*time.Millisecond, window),
	}
	//2.- Each missile should reproduce the same deterministic sequence irrespective of others.
	if !reflect.DeepEqual(missileA, missileARepeat) {
		t.Fatalf("missile A sequence drifted: %v vs %v", missileA, missileARepeat)
	}
	if !reflect.DeepEqual(missileB, missileBRepeat) {
		t.Fatalf("missile B sequence drifted: %v vs %v", missileB, missileBRepeat)
	}
}

func TestMissileECMTrackerRepeatedEngagements(t *testing.T) {
	tracker := NewMissileECMTracker()
	window := DefaultECMProbabilityWindow()
	matchSeed := "seed"
	missileID := "missile-r"
	targetID := "target-x"
	//1.- Run the initial engagement timeline for the missile.
	initial := []bool{
		tracker.Resolve(matchSeed, missileID, targetID, time.Second, window),
		tracker.Resolve(matchSeed, missileID, targetID, 2800*time.Millisecond, window),
	}
	tracker.Release(matchSeed, missileID, targetID)
	//2.- A new engagement should restart from the original deterministic rolls.
	repeat := []bool{
		tracker.Resolve(matchSeed, missileID, targetID, time.Second, window),
		tracker.Resolve(matchSeed, missileID, targetID, 2800*time.Millisecond, window),
	}
	if !reflect.DeepEqual(initial, repeat) {
		t.Fatalf("expected identical outcomes after release, got %v and %v", initial, repeat)
	}
	//3.- Querying an earlier timestamp reuses the cached outcome from the latest evaluation.
	earlier := tracker.Resolve(matchSeed, missileID, targetID, time.Second, window)
	if earlier != repeat[0] {
		t.Fatalf("expected cached outcome %v, got %v", repeat[0], earlier)
	}
}
