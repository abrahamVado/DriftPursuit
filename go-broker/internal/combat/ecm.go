package combat

import (
	"crypto/sha256"
	"encoding/binary"
	"math"
	"math/rand"
)

// SeedForOutcome derives a deterministic RNG seed for ECM interactions.
func SeedForOutcome(matchSeed, missileID, targetID string) int64 {
	//1.- Hash the inputs with separators so each identifier influences the result independently.
	digest := sha256.Sum256([]byte("combat.ecm\x00" + matchSeed + "\x00" + missileID + "\x00" + targetID))
	//2.- Convert the first eight bytes into a signed integer seed for math/rand.
	seed := int64(binary.LittleEndian.Uint64(digest[0:8]))
	if seed == 0 {
		seed = int64(binary.LittleEndian.Uint64(digest[8:16]))
	}
	if seed == 0 {
		seed = 1
	}
	return seed
}

// newECMRand builds a deterministic PRNG bound to the provided ECM tuple.
func newECMRand(matchSeed, missileID, targetID string) *rand.Rand {
	//1.- Use the stable seed so that every replay reproduces the same random stream.
	seed := SeedForOutcome(matchSeed, missileID, targetID)
	//2.- Create a new PRNG instance to avoid cross-talk between concurrent rolls.
	return rand.New(rand.NewSource(seed))
}

// ShouldDecoyBreak resolves whether a decoy spoofs the missile guidance.
func ShouldDecoyBreak(matchSeed, missileID, targetID string, breakProbability float64) bool {
	//1.- Clamp invalid probabilities so deterministic replays never panic or misbehave.
	if math.IsNaN(breakProbability) {
		return false
	}
	if breakProbability < 0 {
		breakProbability = 0
	} else if breakProbability > 1 {
		breakProbability = 1
	}
	if breakProbability == 0 {
		return false
	}
	if breakProbability == 1 {
		return true
	}
	//2.- Pull a deterministic roll from the seeded PRNG and compare to the threshold.
	rng := newECMRand(matchSeed, missileID, targetID)
	roll := rng.Float64()
	return roll < breakProbability
}
