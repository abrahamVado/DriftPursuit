from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Callable


def _clamp(value: float, minimum: float, maximum: float) -> float:
    # //1.- Limit analog inputs to the supported range and coerce NaN to the minimum.
    if value != value:  # NaN check without importing math
        return minimum
    return max(minimum, min(maximum, value))


def _clamp_gear(gear: float) -> int:
    # //2.- Bound gear selection and round to the nearest integer slot.
    if gear != gear or gear is None:
        return 0
    return int(round(_clamp(gear, -1, 9)))


@dataclass
class IntentControls:
    # //3.- Capture the control channels that build each intent frame.
    throttle: float
    brake: float
    steer: float
    handbrake: bool
    gear: int
    boost: bool


IntentSender = Callable[[str], None]


class IntentPublisher:
    def __init__(self, controller_id: str, sender: IntentSender, schema_version: str = "0.1.0") -> None:
        # //4.- Remember identity, transport, and schema information for every publisher.
        self._controller_id = controller_id
        self._sender = sender
        self._schema_version = schema_version
        self._sequence = 0

    def publish(self, controls: IntentControls) -> dict[str, object]:
        # //5.- Increment the sequence, normalize values, and emit the serialized frame.
        self._sequence += 1
        payload = {
            "type": "intent",
            "id": self._controller_id,
            "schema_version": self._schema_version,
            "controller_id": self._controller_id,
            "sequence_id": self._sequence,
            "throttle": _clamp(controls.throttle, -1.0, 1.0),
            "brake": _clamp(controls.brake, 0.0, 1.0),
            "steer": _clamp(controls.steer, -1.0, 1.0),
            "handbrake": bool(controls.handbrake),
            "gear": _clamp_gear(float(controls.gear)),
            "boost": bool(controls.boost),
        }
        message = json.dumps(payload)
        self._sender(message)
        return payload

    @property
    def sequence(self) -> int:
        # //6.- Expose the current sequence for monitoring and testing.
        return self._sequence
