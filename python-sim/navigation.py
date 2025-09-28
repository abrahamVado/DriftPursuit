"""High-level navigation helpers for the demo simulation client.

The viewer received new manual acceleration controls, but the background
simulation also benefits from a predictable autopilot.  This module introduces
small, well documented helpers that compute heading and velocity updates for the
Python telemetry generator.  It keeps the logic close to plain math so that the
code remains dependency free and easy to tweak.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Iterable, List, Optional, Sequence

import numpy as np


@dataclass
class Waypoint:
    """Simple container for a navigation waypoint.

    Attributes
    ----------
    x, y, z:
        Cartesian coordinates in the simulation space.  The viewer maps the
        values 1:1 with its logical space (centimetres are not important here).
    """

    x: float
    y: float
    z: float

    def as_array(self) -> np.ndarray:
        """Return the waypoint as a NumPy vector for quick math operations."""

        return np.array([self.x, self.y, self.z], dtype=float)


class FlightPathPlanner:
    """Utility that cycles through a list of waypoints.

    The planner computes the unit direction vector pointing from the current
    aircraft position to the active waypoint.  When the aircraft gets close
    enough to a waypoint the planner automatically advances to the next entry,
    optionally looping forever.
    """

    def __init__(
        self,
        waypoints: Sequence[Waypoint],
        *,
        loop: bool = True,
        arrival_tolerance: float = 60.0,
    ) -> None:
        if not waypoints:
            raise ValueError("waypoints must not be empty")
        self._waypoints: List[Waypoint] = list(waypoints)
        self._loop = loop
        self._arrival_tolerance = float(arrival_tolerance)
        self._index = 0

    def current_target(self) -> Waypoint:
        """Return the waypoint currently being tracked."""

        return self._waypoints[self._index]

    @property
    def loop(self) -> bool:
        """Whether the planner loops after reaching the last waypoint."""

        return self._loop

    @property
    def arrival_tolerance(self) -> float:
        """Distance threshold used to advance to the next waypoint."""

        return self._arrival_tolerance

    def reset_path(
        self,
        waypoints: Sequence[Waypoint],
        *,
        loop: Optional[bool] = None,
        arrival_tolerance: Optional[float] = None,
    ) -> None:
        """Replace the waypoint list and optionally tweak planner options.

        Parameters
        ----------
        waypoints:
            New set of waypoints for the autopilot to follow. At least one
            waypoint is required.
        loop:
            Optional flag to override whether the planner loops. ``None``
            keeps the previous behaviour.
        arrival_tolerance:
            Optional override for the distance threshold that triggers an
            advance to the next waypoint.
        """

        if not waypoints:
            raise ValueError("waypoints must not be empty")

        self._waypoints = list(waypoints)
        self._index = 0

        if loop is not None:
            self._loop = bool(loop)

        if arrival_tolerance is not None:
            self._arrival_tolerance = float(arrival_tolerance)

    def advance_if_needed(self, position: np.ndarray) -> None:
        """Advance the internal pointer if the aircraft is within tolerance."""

        target = self.current_target().as_array()
        if np.linalg.norm(target - position) <= self._arrival_tolerance:
            next_index = self._index + 1
            if next_index >= len(self._waypoints):
                if self._loop:
                    next_index = 0
                else:
                    next_index = len(self._waypoints) - 1
            self._index = next_index

    def desired_direction(self, position: np.ndarray) -> np.ndarray:
        """Compute the normalized direction vector towards the active waypoint."""

        target = self.current_target().as_array()
        delta = target - position
        norm = np.linalg.norm(delta)
        if norm == 0:
            return np.zeros(3, dtype=float)
        return delta / norm

    def tick(self, position: np.ndarray, dt: float) -> np.ndarray:
        """Advance the waypoint state and return the target direction."""

        self.advance_if_needed(position)
        # dt is currently not used but keeping the signature allows future
        # planners to account for time-based logic without changing the call
        # sites.  The explicit unused variable also documents the intent.
        _ = dt
        return self.desired_direction(position)


class CruiseController:
    """Applies smooth acceleration towards the direction selected by a planner."""

    def __init__(
        self,
        *,
        acceleration: float = 20.0,
        max_speed: float = 240.0,
        heading_lerp: float = 0.35,
        climb_lerp: float = 0.25,
    ) -> None:
        if heading_lerp <= 0 or heading_lerp > 1:
            raise ValueError("heading_lerp must be in (0, 1]")
        if climb_lerp <= 0 or climb_lerp > 1:
            raise ValueError("climb_lerp must be in (0, 1]")
        self.acceleration = float(acceleration)
        self.max_speed = float(max_speed)
        self.heading_lerp = float(heading_lerp)
        self.climb_lerp = float(climb_lerp)

    def apply(self, velocity: np.ndarray, desired_direction: np.ndarray, dt: float) -> np.ndarray:
        """Return an updated velocity vector.

        The method does not mutate the input arrays which keeps the calling
        code easy to reason about.  The caller can simply assign the result to
        its velocity field.
        """

        if np.linalg.norm(desired_direction) == 0:
            # No directional preference -> gently slow down to showcase the
            # acceleration button in the viewer.
            return velocity * 0.98

        desired_norm = desired_direction / np.linalg.norm(desired_direction)

        if np.linalg.norm(velocity) == 0:
            blended_direction = desired_norm
        else:
            current_norm = velocity / np.linalg.norm(velocity)
            planar = (1 - self.heading_lerp) * current_norm[:2] + self.heading_lerp * desired_norm[:2]
            climb = (1 - self.climb_lerp) * current_norm[2] + self.climb_lerp * desired_norm[2]
            blended_direction = np.array([planar[0], planar[1], climb])

        blended_direction = blended_direction / max(np.linalg.norm(blended_direction), 1e-6)

        target_speed = min(np.linalg.norm(velocity) + self.acceleration * dt, self.max_speed)
        return blended_direction * target_speed

    def update_parameters(
        self,
        *,
        acceleration: Optional[float] = None,
        max_speed: Optional[float] = None,
    ) -> None:
        """Update runtime tuning knobs for the cruise controller."""

        if acceleration is None and max_speed is None:
            raise ValueError("at least one parameter must be provided")

        if acceleration is not None:
            acceleration = float(acceleration)
            if acceleration <= 0:
                raise ValueError("acceleration must be positive")
            self.acceleration = acceleration

        if max_speed is not None:
            max_speed = float(max_speed)
            if max_speed <= 0:
                raise ValueError("max_speed must be positive")
            self.max_speed = max_speed

    @staticmethod
    def orientation_from_velocity(velocity: np.ndarray) -> Sequence[float]:
        """Compute yaw/pitch/roll from the velocity vector."""

        if np.linalg.norm(velocity) < 1e-5:
            return [0.0, 0.0, 0.0]

        yaw = math.atan2(velocity[1], velocity[0])
        planar_speed = math.hypot(velocity[0], velocity[1])
        pitch = math.atan2(velocity[2], planar_speed)
        roll = 0.0
        return [float(yaw), float(pitch), float(roll)]


def build_default_waypoints() -> Iterable[Waypoint]:
    """Deterministic set of waypoints that keeps the plane above the runway."""

    return [
        Waypoint(-800.0, -400.0, 1200.0),
        Waypoint(-200.0, 0.0, 1350.0),
        Waypoint(600.0, 420.0, 1200.0),
        Waypoint(200.0, -200.0, 1100.0),
    ]


__all__ = [
    "Waypoint",
    "FlightPathPlanner",
    "CruiseController",
    "build_default_waypoints",
]
