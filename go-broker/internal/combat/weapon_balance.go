package combat

import (
	"encoding/json"
	"sync"

	_ "embed"
)

// WeaponArchetype enumerates the supported weapon behaviour families.
type WeaponArchetype string

const (
	WeaponArchetypeShell   WeaponArchetype = "shell"
	WeaponArchetypeMissile WeaponArchetype = "missile"
	WeaponArchetypeLaser   WeaponArchetype = "laser"
)

// WeaponArchetypeConfig defines the baseline balance values for an archetype.
type WeaponArchetypeConfig struct {
	CooldownSeconds           float64 `json:"cooldownSeconds"`
	ProjectileSpeed           float64 `json:"projectileSpeed,omitempty"`
	ProjectileLifetimeSeconds float64 `json:"projectileLifetimeSeconds,omitempty"`
	BeamDurationSeconds       float64 `json:"beamDurationSeconds,omitempty"`
	Damage                    float64 `json:"damage"`
	MuzzleEffect              string  `json:"muzzleEffect,omitempty"`
	ImpactEffect              string  `json:"impactEffect,omitempty"`
	TrailEffect               string  `json:"trailEffect,omitempty"`
	BeamEffect                string  `json:"beamEffect,omitempty"`
	DecoyBreakProbability     float64 `json:"decoyBreakProbability,omitempty"`
}

// WeaponVariantConfig customises an archetype for a specific weapon identifier.
type WeaponVariantConfig struct {
	Archetype                 WeaponArchetype `json:"archetype"`
	CooldownSeconds           *float64        `json:"cooldownSeconds,omitempty"`
	ProjectileSpeed           *float64        `json:"projectileSpeed,omitempty"`
	ProjectileLifetimeSeconds *float64        `json:"projectileLifetimeSeconds,omitempty"`
	BeamDurationSeconds       *float64        `json:"beamDurationSeconds,omitempty"`
	Damage                    *float64        `json:"damage,omitempty"`
	MuzzleEffect              string          `json:"muzzleEffect,omitempty"`
	ImpactEffect              string          `json:"impactEffect,omitempty"`
	TrailEffect               string          `json:"trailEffect,omitempty"`
	BeamEffect                string          `json:"beamEffect,omitempty"`
	DecoyBreakProbability     *float64        `json:"decoyBreakProbability,omitempty"`
}

// DecoyBalanceConfig captures the shared ECM balance values.
type DecoyBalanceConfig struct {
	ActivationDurationSeconds float64 `json:"activationDurationSeconds"`
	BreakProbability          float64 `json:"breakProbability"`
}

// WeaponBalanceCatalog mirrors the structure of weapon_balance.json.
type WeaponBalanceCatalog struct {
	Archetypes map[string]WeaponArchetypeConfig `json:"archetypes"`
	Weapons    map[string]WeaponVariantConfig   `json:"weapons"`
	Decoy      DecoyBalanceConfig               `json:"decoy"`
}

// Clone produces a defensive copy to protect the cached catalog from mutation.
func (c WeaponBalanceCatalog) Clone() WeaponBalanceCatalog {
	clones := WeaponBalanceCatalog{
		Archetypes: make(map[string]WeaponArchetypeConfig, len(c.Archetypes)),
		Weapons:    make(map[string]WeaponVariantConfig, len(c.Weapons)),
		Decoy:      c.Decoy,
	}
	for key, value := range c.Archetypes {
		clones.Archetypes[key] = value
	}
	for key, value := range c.Weapons {
		clones.Weapons[key] = value
	}
	return clones
}

var (
	weaponBalanceOnce sync.Once
	weaponBalanceData WeaponBalanceCatalog
	weaponBalanceErr  error
)

//go:embed weapon_balance.json
var weaponBalancePayload []byte

// WeaponBalance exposes the parsed weapon balance catalog shared across runtimes.
func WeaponBalance() WeaponBalanceCatalog {
	weaponBalanceOnce.Do(func() {
		//1.- Parse the embedded JSON payload once so concurrent callers share the same data.
		weaponBalanceErr = json.Unmarshal(weaponBalancePayload, &weaponBalanceData)
	})
	//2.- Surface configuration errors immediately to keep combat deterministic and debuggable.
	if weaponBalanceErr != nil {
		panic(weaponBalanceErr)
	}
	//3.- Return a clone so tests cannot accidentally mutate the cached catalog.
	return weaponBalanceData.Clone()
}

// DecoyBalance returns the decoy balance block.
func DecoyBalance() DecoyBalanceConfig {
	//1.- Delegate to WeaponBalance to benefit from lazy parsing and defensive copies.
	catalog := WeaponBalance()
	return catalog.Decoy
}
