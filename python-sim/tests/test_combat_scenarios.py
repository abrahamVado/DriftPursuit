"""Regression tests for scripted combat scenario tuning curves."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Dict

import pytest

# //1.- Allow tests to import the physics package from the repository root.
sys.path.append(str(Path(__file__).resolve().parents[1]))

from physics.combat_scenarios import (
    CombatScenario,
    DefenseProfile,
    ReplaySnippet,
    SimulationResult,
    WeaponSpec,
    simulate_combat_scenarios,
)


CONFIG_PATH = Path(__file__).with_name("configs").joinpath("combat_tuning.json")


def _relative_delta(observed: float, expected: float) -> float:
    """Return the relative deviation between *observed* and *expected*."""

    # //1.- Guard against division by zero when expected curves are null damage.
    if expected == 0:
        return 0.0 if observed == 0 else float("inf")
    # //2.- Compute the absolute relative error for threshold comparisons.
    return abs(observed - expected) / expected


def _format_snippet(snippet: ReplaySnippet) -> str:
    """Create a deterministic string that can be attached to assertion messages."""

    # //1.- Join the ordered key/value pairs for quick human inspection.
    sorted_items = sorted(snippet.details.items())
    payload = ", ".join(f"{key}={value:.3f}" for key, value in sorted_items)
    # //2.- Return a compact replay string to aid debugging.
    return f"{snippet.headline}: {payload}"


def _load_tuning_config() -> Dict[str, Dict[str, float]]:
    """Load expected tuning values for each scripted scenario."""

    # //1.- Read the JSON payload from disk and expose nested structures directly.
    with CONFIG_PATH.open("r", encoding="utf-8") as handle:
        config = json.load(handle)
    return config


def test_combat_scenarios_match_tuning(caplog: pytest.LogCaptureFixture) -> None:
    """Validate missile and laser combat calculations against tuning curves."""

    # //1.- Arrange combat scenarios that the physics layer must support.
    config = _load_tuning_config()
    scenarios = [
        CombatScenario(
            name="missile_alpha_strike",
            weapon=WeaponSpec(
                weapon_type="missile",
                base_damage=220.0,
                accuracy=0.75,
                armor_penetration=0.35,
                tracking=0.4,
            ),
            defense=DefenseProfile(
                shield_strength=180.0,
                armor_rating=0.5,
                evasion=0.22,
            ),
            distance=250.0,
        ),
        CombatScenario(
            name="laser_lance_barrage",
            weapon=WeaponSpec(
                weapon_type="laser",
                base_damage=150.0,
                accuracy=0.88,
                armor_penetration=0.25,
                beam_coherence=0.6,
            ),
            defense=DefenseProfile(
                shield_strength=140.0,
                armor_rating=0.45,
                evasion=0.18,
            ),
            distance=320.0,
        ),
        CombatScenario(
            name="missile_close_intercept",
            weapon=WeaponSpec(
                weapon_type="missile",
                base_damage=160.0,
                accuracy=0.82,
                armor_penetration=0.25,
                tracking=0.55,
            ),
            defense=DefenseProfile(
                shield_strength=90.0,
                armor_rating=0.3,
                evasion=0.12,
            ),
            distance=90.0,
        ),
    ]

    # //2.- Act by running the scripted combat simulations with verbose logging.
    caplog.set_level("INFO")
    results = simulate_combat_scenarios(scenarios)

    # //3.- Assert the curves match expected tuning within the required tolerances.
    global_tolerance = config.get("global_tolerance", 0.05)
    for scenario in scenarios:
        result: SimulationResult = results[scenario.name]
        tuning_info = config["scenarios"][scenario.name]
        expected_damage = tuning_info["expected_damage"]
        tolerance = tuning_info.get("tolerance", global_tolerance)
        relative_delta = _relative_delta(result.expected_damage, expected_damage)

        if relative_delta > tolerance:
            formatted_snippet = _format_snippet(result.replay_snippet)
            pytest.fail(
                (
                    f"Scenario {scenario.name} damage deviation {relative_delta:.3f} "
                    f"exceeded tolerance {tolerance:.3f}. {formatted_snippet}"
                )
            )

        assert relative_delta <= tolerance

    # //4.- Confirm that outcome logging occurred for downstream replay tools.
    for scenario in scenarios:
        matching_logs = [
            record for record in caplog.records if record.message.startswith(scenario.name)
        ]
        assert matching_logs, f"Expected logs for scenario {scenario.name}"
