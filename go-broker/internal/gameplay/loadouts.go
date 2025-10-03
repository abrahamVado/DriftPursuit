package gameplay

import (
	"encoding/json"
	"sync"

	_ "embed"
)

// WeaponConfig captures the weapon bundle shipped with a vehicle loadout.
type WeaponConfig struct {
	Type string `json:"type"`
	Ammo int    `json:"ammo"`
}

// PassiveModifiers describe gameplay modifiers applied on top of the base stats.
type PassiveModifiers struct {
	SpeedMultiplier    float64 `json:"speedMultiplier"`
	AgilityMultiplier  float64 `json:"agilityMultiplier"`
	DamageMultiplier   float64 `json:"damageMultiplier"`
	BoostCooldownScale float64 `json:"boostCooldownScale"`
}

// VehicleLoadoutConfig defines a selectable vehicle configuration.
type VehicleLoadoutConfig struct {
	ID               string           `json:"id"`
	DisplayName      string           `json:"displayName"`
	Description      string           `json:"description"`
	Icon             string           `json:"icon"`
	Selectable       bool             `json:"selectable"`
	Weapons          []WeaponConfig   `json:"weapons"`
	PassiveModifiers PassiveModifiers `json:"passiveModifiers"`
	RadarRangeMeters float64          `json:"radarRangeMeters"`
}

type skiffLoadoutFile struct {
	Loadouts []VehicleLoadoutConfig `json:"loadouts"`
}

//go:embed skiff_loadouts.json
var skiffLoadoutPayload []byte

var (
	loadoutOnce sync.Once
	loadoutData []VehicleLoadoutConfig
	loadoutErr  error
)

// SkiffLoadouts returns the immutable set of loadouts shared across runtimes.
func SkiffLoadouts() []VehicleLoadoutConfig {
	loadoutOnce.Do(func() {
		//1.- Parse the embedded JSON catalogue in a thread-safe manner.
		var decoded skiffLoadoutFile
		loadoutErr = json.Unmarshal(skiffLoadoutPayload, &decoded)
		if loadoutErr == nil {
			loadoutData = decoded.Loadouts
		}
	})
	//2.- Surface configuration errors eagerly to avoid divergent tuning tables.
	if loadoutErr != nil {
		panic(loadoutErr)
	}
	//3.- Return a defensive copy to protect the cached slice from external mutation.
	clones := make([]VehicleLoadoutConfig, len(loadoutData))
	copy(clones, loadoutData)
	return clones
}

// DeriveStatsWithModifiers applies the passive modifiers to the provided base stats.
func DeriveStatsWithModifiers(base VehicleStats, modifiers PassiveModifiers) VehicleStats {
	//1.- Start from a copy so the original stats remain untouched.
	adjusted := base
	//2.- Apply speed scaling guarded against non-positive configuration.
	speedMultiplier := modifiers.SpeedMultiplier
	if speedMultiplier <= 0 {
		speedMultiplier = 1
	}
	adjusted.MaxSpeedMps = base.MaxSpeedMps * speedMultiplier
	//3.- Apply agility scaling across angular speed and all accelerations.
	agilityMultiplier := modifiers.AgilityMultiplier
	if agilityMultiplier <= 0 {
		agilityMultiplier = 1
	}
	adjusted.MaxAngularSpeedDegPerSec = base.MaxAngularSpeedDegPerSec * agilityMultiplier
	adjusted.ForwardAccelerationMps2 = base.ForwardAccelerationMps2 * agilityMultiplier
	adjusted.ReverseAccelerationMps2 = base.ReverseAccelerationMps2 * agilityMultiplier
	adjusted.StrafeAccelerationMps2 = base.StrafeAccelerationMps2 * agilityMultiplier
	adjusted.VerticalAccelerationMps2 = base.VerticalAccelerationMps2 * agilityMultiplier
	adjusted.BoostAccelerationMps2 = base.BoostAccelerationMps2 * agilityMultiplier
	//4.- Multiply the boost cooldown while keeping duration fixed.
	cooldownScale := modifiers.BoostCooldownScale
	if cooldownScale <= 0 {
		cooldownScale = 1
	}
	adjusted.BoostCooldownSeconds = base.BoostCooldownSeconds * cooldownScale
	return adjusted
}

// LoadoutStats returns the stat block for the specified loadout identifier.
func LoadoutStats(loadoutID string) VehicleStats {
	//1.- Default to the base Skiff stats when the identifier is unknown.
	stats := SkiffStats()
	for _, loadout := range SkiffLoadouts() {
		if loadout.ID == loadoutID {
			return DeriveStatsWithModifiers(stats, loadout.PassiveModifiers)
		}
	}
	return stats
}

// LoadoutDamageMultiplier exposes the combat scalar associated with the loadout.
func LoadoutDamageMultiplier(loadoutID string) float64 {
	for _, loadout := range SkiffLoadouts() {
		if loadout.ID == loadoutID {
			if loadout.PassiveModifiers.DamageMultiplier > 0 {
				return loadout.PassiveModifiers.DamageMultiplier
			}
			return 1
		}
	}
	return 1
}

// LoadoutRadarRange returns the tuned radar detection radius for the requested loadout.
func LoadoutRadarRange(loadoutID string) float64 {
	const (
		minimumRange = 600.0
		maximumRange = 900.0
	)
	//1.- Clamp the configured range to the supported envelope so gameplay tuning remains safe.
	clamp := func(value float64) float64 {
		if value < minimumRange {
			return minimumRange
		}
		if value > maximumRange {
			return maximumRange
		}
		return value
	}
	for _, loadout := range SkiffLoadouts() {
		if loadout.ID == loadoutID {
			if loadout.RadarRangeMeters > 0 {
				return clamp(loadout.RadarRangeMeters)
			}
			break
		}
	}
	return minimumRange
}

// DefaultSkiffLoadoutID returns the first selectable loadout identifier.
func DefaultSkiffLoadoutID() string {
	for _, loadout := range SkiffLoadouts() {
		if loadout.Selectable {
			return loadout.ID
		}
	}
	return ""
}
