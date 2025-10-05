"""High-level gameplay world loop stitching terrain, physics, and telemetry."""
from __future__ import annotations

import json
import math
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Dict, Optional

from .collision import Capsule, CollisionResult, CollisionSystem
from .flight import ControlMode, FlightInput, FlightParameters, VehicleState, integrate_flight, spawn_state
from .placeables import PlaceableField
from .terrain import TerrainSampler
from .vector import Vector3, add, scale


# //1.- Lightweight telemetry client that posts events to the Go backend when configured.
class TelemetryClient:
    def __init__(self, base_url: Optional[str] = None) -> None:
        self._base_url = base_url.rstrip("/") if base_url else None

    def post_event(self, event_type: str, payload: Dict[str, object]) -> None:
        if not self._base_url:
            return
        url = f"{self._base_url}/events/{event_type}"
        body = json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"}, method="POST")
        try:
            urllib.request.urlopen(request, timeout=2.0)
        except urllib.error.URLError:
            pass


# //2.- Aggregate match statistics for telemetry reporting.
@dataclass
class MatchStats:
    time_alive: float = 0.0
    distance: float = 0.0
    max_speed: float = 0.0
    collisions: int = 0

    def as_payload(self, seed: int) -> Dict[str, object]:
        return {
            "seed": seed,
            "time_alive": self.time_alive,
            "distance": self.distance,
            "max_speed": self.max_speed,
            "collisions": self.collisions,
        }


# //3.- Orchestrate the gameplay simulation and crash handling.
class GameplayWorld:
    def __init__(
        self,
        seed: int,
        telemetry: Optional[TelemetryClient] = None,
        parameters: Optional[FlightParameters] = None,
    ) -> None:
        self.seed = int(seed)
        self.telemetry = telemetry or TelemetryClient()
        self.parameters = parameters or FlightParameters()
        self.sampler = TerrainSampler(self.seed)
        self.placeables = PlaceableField(self.sampler, self.seed)
        self.collision = CollisionSystem(self.sampler, self.placeables)
        self.stats = MatchStats()
        self._match_active = False
        self.flight_state = spawn_state(self._spawn_position())
        self.previous_state = self.flight_state
        self._send_start_event()

    def _spawn_position(self) -> Vector3:
        sample = self.sampler.sample(0.0, 0.0)
        return (0.0, sample.ground_height + 120.0, 0.0)

    def _send_start_event(self) -> None:
        self.stats = MatchStats()
        self.flight_state = spawn_state(self._spawn_position())
        self.previous_state = self.flight_state
        self.telemetry.post_event(
            "start",
            {
                "seed": self.seed,
                "position": self.flight_state.position,
                "velocity": self.flight_state.velocity,
            },
        )
        self._match_active = True

    def reset(self) -> None:
        self._send_start_event()

    def _capsule_for_state(self, state: VehicleState) -> Capsule:
        nose, tail = state.capsule_points(self.parameters)
        return Capsule(nose=nose, tail=tail, radius=self.parameters.body_radius)

    def _apply_collision(self, state: VehicleState, result: CollisionResult) -> VehicleState:
        adjusted_position = add(state.position, scale(result.contact_normal, max(0.0, result.penetration_depth)))
        damage = min(1.0, state.damage + result.damage)
        return VehicleState(
            position=adjusted_position,
            velocity=result.new_velocity,
            angular_velocity=state.angular_velocity,
            orientation=state.orientation,
            throttle=state.throttle,
            boost_timer=state.boost_timer,
            boost_cooldown=state.boost_cooldown,
            damage=damage,
            altitude_agl=state.altitude_agl,
            bank_angle=state.bank_angle,
            stall_level=state.stall_level,
            buffet_intensity=state.buffet_intensity,
        )

    def _should_crash(self, state: VehicleState, result: CollisionResult, vertical_speed: float) -> bool:
        if result.kill:
            return True
        if abs(state.bank_angle) > math.radians(80):
            return True
        if result.penetration_depth > 2.5:
            return True
        if vertical_speed < -35.0:
            return True
        return False

    def _record_crash(self, result: CollisionResult) -> None:
        payload = self.stats.as_payload(self.seed)
        payload.update(
            {
                "hazard": result.hazard,
                "position": self.flight_state.position,
                "velocity": self.flight_state.velocity,
                "loss": True,
                "score": payload["distance"],
            }
        )
        self.telemetry.post_event("crash", payload)
        self._match_active = False

    def update(self, inputs: FlightInput, dt: float) -> VehicleState:
        if not self._match_active:
            self.reset()
        current_inputs = inputs
        if inputs.mode is ControlMode.ARCADE and inputs.aim_direction == (0.0, 0.0, 1.0):
            current_inputs = FlightInput(
                mode=ControlMode.ARCADE,
                aim_direction=self.flight_state.orientation.forward,
                pitch=inputs.pitch,
                roll=inputs.roll,
                yaw=inputs.yaw,
                throttle_delta=inputs.throttle_delta,
                boost=inputs.boost,
                airbrake=inputs.airbrake,
            )
        next_state = integrate_flight(self.flight_state, current_inputs, self.sampler, self.parameters, dt)
        previous_capsule = self._capsule_for_state(self.flight_state)
        current_capsule = self._capsule_for_state(next_state)
        vertical_speed = next_state.velocity[1]
        speed = math.sqrt(sum(component * component for component in next_state.velocity))
        result = self.collision.sweep(previous_capsule, current_capsule, self.flight_state.velocity, speed)
        if result:
            self.stats.collisions += 1
            next_state = self._apply_collision(next_state, result)
            if self._should_crash(next_state, result, vertical_speed):
                self._record_crash(result)
                self.reset()
                return self.flight_state
        self.stats.time_alive += dt
        self.stats.distance += speed * dt
        self.stats.max_speed = max(self.stats.max_speed, speed)
        self.previous_state = self.flight_state
        self.flight_state = next_state
        return self.flight_state

    def checkpoint(self, label: str, score: float) -> None:
        payload = self.stats.as_payload(self.seed)
        payload.update({"checkpoint": label, "score": score})
        self.telemetry.post_event("checkpoint", payload)

    def finish(self, score: float) -> None:
        payload = self.stats.as_payload(self.seed)
        payload.update({"score": score})
        self.telemetry.post_event("finish", payload)
        self._match_active = False
