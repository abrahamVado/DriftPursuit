package gameplay

import (
	"encoding/json"
	"sync"

	_ "embed"
)

// VehicleStats captures the tunable physics parameters for a vehicle archetype.
type VehicleStats struct {
	MaxSpeedMps              float64 `json:"maxSpeedMps"`
	MaxAngularSpeedDegPerSec float64 `json:"maxAngularSpeedDegPerSec"`
	ForwardAccelerationMps2  float64 `json:"forwardAccelerationMps2"`
	ReverseAccelerationMps2  float64 `json:"reverseAccelerationMps2"`
	StrafeAccelerationMps2   float64 `json:"strafeAccelerationMps2"`
	VerticalAccelerationMps2 float64 `json:"verticalAccelerationMps2"`
	BoostAccelerationMps2    float64 `json:"boostAccelerationMps2"`
	BoostDurationSeconds     float64 `json:"boostDurationSeconds"`
	BoostCooldownSeconds     float64 `json:"boostCooldownSeconds"`
}

//go:embed skiff.json
var skiffPayload []byte

var (
	skiffOnce sync.Once
	skiffData VehicleStats
	skiffErr  error
)

// SkiffStats exposes the cached Skiff configuration to gameplay systems.
func SkiffStats() VehicleStats {
	skiffOnce.Do(func() {
		//1.- Parse the embedded JSON payload exactly once in a threadsafe manner.
		skiffErr = json.Unmarshal(skiffPayload, &skiffData)
	})
	//2.- Panic immediately when the configuration cannot be decoded to avoid silent divergence.
	if skiffErr != nil {
		panic(skiffErr)
	}
	//3.- Return a copy of the cached stats so callers cannot mutate shared state.
	return skiffData
}
