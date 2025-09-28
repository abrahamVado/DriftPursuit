"""High-level navigation helpers for the demo simulation client.

The viewer received new manual acceleration controls, but the background
simulation also benefits from a predictable autopilot.  This module introduces
small, well documented helpers that compute heading and velocity updates for the
Python telemetry generator.  It keeps the logic close to plain math so that the
code remains dependency free and easy to tweak.
"""

from __future__ import annotations

import ast
import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, List, Sequence

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


def _parse_yaml_like(content: str, source: Path) -> Any:
    entries: List[Any] = []
    current_map: dict[str, Any] | None = None

    for raw_line in content.splitlines():
        stripped = raw_line.strip()
        if not stripped or stripped.startswith("#"):
            continue

        if stripped.startswith("- "):
            payload = stripped[2:].strip()
            if payload.startswith("["):
                try:
                    entries.append(ast.literal_eval(payload))
                except (SyntaxError, ValueError) as exc:
                    raise ValueError(
                        f"Failed to parse list waypoint in '{source}': {payload!r}"
                    ) from exc
                current_map = None
                continue

            if ":" not in payload:
                raise ValueError(
                    f"Unsupported YAML entry in '{source}': {raw_line.strip()}"
                )
            key, value = payload.split(":", 1)
            current_map = {}
            entries.append(current_map)
            current_map[key.strip()] = _parse_yaml_scalar(value.strip())
            continue

        if current_map is None:
            raise ValueError(
                f"Unexpected line in '{source}': {raw_line.strip()}"
            )
        if ":" not in stripped:
            raise ValueError(
                f"Expected key/value pair in '{source}' but found: {raw_line.strip()}"
            )
        key, value = stripped.split(":", 1)
        current_map[key.strip()] = _parse_yaml_scalar(value.strip())

    return entries


def _parse_yaml_scalar(value: str) -> Any:
    if not value:
        return ""
    if value.startswith("#"):
        return ""
    if " #" in value:
        value = value.split(" #", 1)[0].rstrip()
    try:
        return ast.literal_eval(value)
    except (SyntaxError, ValueError):
        return value


def _load_raw_waypoints(path: Path) -> Any:
    suffix = path.suffix.lower()
    if suffix == ".json":
        return json.loads(path.read_text())
    if suffix in {".yaml", ".yml"}:
        return _parse_yaml_like(path.read_text(), path)
    raise ValueError(
        f"Unsupported waypoint file extension '{path.suffix}'. "
        "Use .json, .yaml, or .yml."
    )


def _coerce_waypoint(entry: Any, index: int, source: Path) -> Waypoint:
    def _ensure_finite(value: Any, label: str) -> float:
        try:
            number = float(value)
        except (TypeError, ValueError):
            raise ValueError(
                f"Waypoint {index} in '{source}' has a non-numeric {label}: {value!r}"
            ) from None
        if not math.isfinite(number):
            raise ValueError(
                f"Waypoint {index} in '{source}' has a non-finite {label}: {value!r}"
            )
        return number

    if isinstance(entry, dict):
        try:
            x = _ensure_finite(entry["x"], "x")
            y = _ensure_finite(entry["y"], "y")
            z = _ensure_finite(entry["z"], "z")
        except KeyError as missing:
            raise ValueError(
                f"Waypoint {index} in '{source}' is missing coordinate '{missing.args[0]}'"
            ) from None
        return Waypoint(x, y, z)

    if isinstance(entry, (list, tuple)):
        if len(entry) != 3:
            raise ValueError(
                f"Waypoint {index} in '{source}' must contain exactly 3 coordinates"
            )
        x = _ensure_finite(entry[0], "x")
        y = _ensure_finite(entry[1], "y")
        z = _ensure_finite(entry[2], "z")
        return Waypoint(x, y, z)

    raise ValueError(
        f"Waypoint {index} in '{source}' must be an object with x/y/z keys or "
        "a sequence of three numbers"
    )


def load_waypoints_from_file(path_like: Any) -> List[Waypoint]:
    """Load waypoints from a JSON or YAML file.

    The helper accepts either a mapping with explicit ``x``/``y``/``z`` keys or a
    simple list of 3-number sequences.  Values are coerced to ``float`` and
    validated to be finite.
    """

    path = Path(path_like)
    if not path.exists():
        raise FileNotFoundError(f"Waypoint file '{path}' does not exist")

    raw = _load_raw_waypoints(path)
    if raw is None:
        raise ValueError(f"Waypoint file '{path}' is empty")
    if not isinstance(raw, list):
        raise ValueError(
            f"Waypoint file '{path}' must contain a list of waypoints, got {type(raw).__name__}"
        )

    waypoints: List[Waypoint] = []
    for idx, entry in enumerate(raw):
        waypoints.append(_coerce_waypoint(entry, idx, path))

    if not waypoints:
        raise ValueError(f"Waypoint file '{path}' must define at least one waypoint")

    return waypoints


__all__ = [
    "Waypoint",
    "FlightPathPlanner",
    "CruiseController",
    "build_default_waypoints",
    "load_waypoints_from_file",
]
