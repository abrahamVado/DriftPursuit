"""Utility helpers for constructing Drift Pursuit intent payloads."""

from __future__ import annotations

from typing import MutableMapping

IntentDict = MutableMapping[str, object]


def build_intent(
    sequence: int,
    *,
    controller_id: str,
    throttle: float = 0.0,
    steer: float = 0.0,
    brake: float = 0.0,
    boost: bool = False,
    handbrake: bool = False,
    gear: int = 1,
) -> IntentDict:
    """Create a minimal intent payload for broker submission."""

    # //1.- Clamp the floating point inputs to the expected control ranges.
    throttle = max(0.0, min(1.0, throttle))
    brake = max(0.0, min(1.0, brake))
    steer = max(-1.0, min(1.0, steer))
    # //2.- Normalise the gear selection to keep it within plausible limits.
    if gear < -1:
        gear = -1
    if gear > 6:
        gear = 6
    # //3.- Assemble the payload so bots only expose supported schema fields.
    return {
        "schema_version": "1",
        "controller_id": controller_id,
        "sequence_id": sequence,
        "throttle": throttle,
        "brake": brake,
        "steer": steer,
        "handbrake": handbrake,
        "gear": gear,
        "boost": boost,
    }


__all__ = ["IntentDict", "build_intent"]
