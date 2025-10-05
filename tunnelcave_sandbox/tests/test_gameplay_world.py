"""Integration-style tests for the gameplay world loop."""
from __future__ import annotations

from dataclasses import replace

from tunnelcave_sandbox.src.gameplay.flight import ControlMode, FlightInput
from tunnelcave_sandbox.src.gameplay.world import GameplayWorld, TelemetryClient


class RecordingTelemetry(TelemetryClient):
    def __init__(self) -> None:
        super().__init__(base_url=None)
        self.events: list[tuple[str, dict[str, object]]] = []

    def post_event(self, event_type: str, payload: dict[str, object]) -> None:  # type: ignore[override]
        self.events.append((event_type, payload))


def test_world_crash_resets_and_reports() -> None:
    telemetry = RecordingTelemetry()
    world = GameplayWorld(seed=12, telemetry=telemetry)
    sample = world.sampler.sample(0.0, 0.0)
    crash_state = replace(
        world.flight_state,
        position=(0.0, sample.ground_height + 1.0, 0.0),
        velocity=(0.0, -90.0, 0.0),
    )
    world.flight_state = crash_state
    world.update(FlightInput(mode=ControlMode.DIRECT), dt=0.1)
    assert any(event for event in telemetry.events if event[0] == "crash")
    assert world.flight_state.position[1] > sample.ground_height + 50.0
