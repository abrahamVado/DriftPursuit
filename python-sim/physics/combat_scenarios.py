"""Utilities for scripting combat scenarios for regression testing."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Dict, Iterable, List


LOGGER = logging.getLogger("combat_scenarios")


@dataclass(frozen=True)
class WeaponSpec:
    """Specification for a combat weapon."""

    weapon_type: str
    base_damage: float
    accuracy: float
    armor_penetration: float = 0.0
    tracking: float = 0.0
    beam_coherence: float = 0.0


@dataclass(frozen=True)
class DefenseProfile:
    """Defensive characteristics of a target."""

    shield_strength: float
    armor_rating: float
    evasion: float


@dataclass(frozen=True)
class CombatScenario:
    """Complete description of a scripted combat encounter."""

    name: str
    weapon: WeaponSpec
    defense: DefenseProfile
    distance: float


@dataclass
class ReplaySnippet:
    """Short collection of facts that help debug regressions."""

    headline: str
    details: Dict[str, float]


@dataclass
class SimulationResult:
    """Result of a simulated combat scenario."""

    scenario: CombatScenario
    expected_damage: float
    hit_probability: float
    mitigation: float
    logs: List[str]
    replay_snippet: ReplaySnippet


def _clamp(value: float, minimum: float, maximum: float) -> float:
    """Clamp *value* to the inclusive range [minimum, maximum]."""

    # //1.- Ensure we never exceed physical probability bounds.
    return max(minimum, min(maximum, value))


def _simulate_missile(scenario: CombatScenario) -> SimulationResult:
    """Simulate a missile strike against the provided scenario."""

    # //1.- Calculate how guidance and target evasion influence hit chance.
    guidance_bonus = 1.0 + scenario.weapon.tracking * 0.5
    evasive_factor = 1.0 - scenario.defense.evasion
    hit_probability = _clamp(scenario.weapon.accuracy * guidance_bonus * evasive_factor, 0.0, 1.0)

    # //2.- Estimate how the shield and armor reduce incoming explosive force.
    shield_mitigation = scenario.defense.shield_strength / (
        scenario.defense.shield_strength + scenario.weapon.base_damage
    )
    shield_mitigation = _clamp(shield_mitigation, 0.0, 0.7)
    armor_response = 1.0 - scenario.defense.armor_rating * (1.0 - scenario.weapon.armor_penetration)
    armor_response = max(0.15, armor_response)
    mitigation = (1.0 - shield_mitigation) * armor_response

    # //3.- Apply range based falloff for missiles to reward close engagements.
    range_penalty = _clamp(1.0 - scenario.distance * 0.002, 0.6, 1.0)

    # //4.- Derive the final damage and capture detailed logs.
    raw_damage = scenario.weapon.base_damage * hit_probability * mitigation * range_penalty
    logs = [
        f"Missile guidance bonus: {guidance_bonus:.3f}",
        f"Missile hit probability: {hit_probability:.3f}",
        f"Missile mitigation factor: {mitigation:.3f}",
        f"Missile range penalty: {range_penalty:.3f}",
        f"Missile damage output: {raw_damage:.3f}",
    ]

    for entry in logs:
        LOGGER.info("%s - %s", scenario.name, entry)

    return SimulationResult(
        scenario=scenario,
        expected_damage=raw_damage,
        hit_probability=hit_probability,
        mitigation=mitigation,
        logs=logs,
        replay_snippet=ReplaySnippet(
            headline=f"Missile replay for {scenario.name}",
            details={
                "guidance_bonus": guidance_bonus,
                "hit_probability": hit_probability,
                "mitigation": mitigation,
                "range_penalty": range_penalty,
                "damage": raw_damage,
            },
        ),
    )


def _simulate_laser(scenario: CombatScenario) -> SimulationResult:
    """Simulate a laser barrage against the provided scenario."""

    # //1.- Evaluate the focusing quality of the beam after distance losses.
    coherence_bonus = 1.0 + scenario.weapon.beam_coherence * 0.8
    atmospheric_drag = _clamp(1.0 - scenario.distance * 0.0015, 0.65, 1.0)

    # //2.- Determine the probability of sustained contact on the target.
    focus_factor = _clamp(scenario.weapon.accuracy * (1.0 - scenario.defense.evasion * 0.5), 0.0, 1.0)

    # //3.- Model shield bleed-through when the beam stays on target.
    shield_bleed = 1.0 - _clamp(scenario.defense.shield_strength * 0.03, 0.0, 0.6)
    armor_weakening = 1.0 + scenario.weapon.armor_penetration * 0.4
    mitigation = shield_bleed * armor_weakening

    # //4.- Compute final energy transfer and assemble logs for debugging.
    raw_damage = scenario.weapon.base_damage * coherence_bonus * atmospheric_drag * focus_factor * mitigation
    logs = [
        f"Laser coherence bonus: {coherence_bonus:.3f}",
        f"Laser atmospheric drag: {atmospheric_drag:.3f}",
        f"Laser focus factor: {focus_factor:.3f}",
        f"Laser mitigation factor: {mitigation:.3f}",
        f"Laser damage output: {raw_damage:.3f}",
    ]

    for entry in logs:
        LOGGER.info("%s - %s", scenario.name, entry)

    return SimulationResult(
        scenario=scenario,
        expected_damage=raw_damage,
        hit_probability=focus_factor,
        mitigation=mitigation,
        logs=logs,
        replay_snippet=ReplaySnippet(
            headline=f"Laser replay for {scenario.name}",
            details={
                "coherence_bonus": coherence_bonus,
                "atmospheric_drag": atmospheric_drag,
                "focus_factor": focus_factor,
                "mitigation": mitigation,
                "damage": raw_damage,
            },
        ),
    )


def simulate_combat_scenarios(scenarios: Iterable[CombatScenario]) -> Dict[str, SimulationResult]:
    """Run combat simulations for every scenario in *scenarios*."""

    # //1.- Iterate over each scripted scenario and dispatch to the weapon specific handler.
    results: Dict[str, SimulationResult] = {}
    for scenario in scenarios:
        weapon_type = scenario.weapon.weapon_type.lower()
        if weapon_type == "missile":
            result = _simulate_missile(scenario)
        elif weapon_type == "laser":
            result = _simulate_laser(scenario)
        else:
            # //2.- Raise a helpful error to catch unsupported weapons early.
            raise ValueError(f"Unsupported weapon type: {scenario.weapon.weapon_type}")

        results[scenario.name] = result

    # //3.- Return all computed results so the caller can compare against tuning curves.
    return results

