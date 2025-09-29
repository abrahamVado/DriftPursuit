"""Collision detection helpers for the Python simulator.

This module implements a light-weight collision system that watches the
simulated aircraft and keeps it from tunnelling through the ground or static
obstacles.  The simulator owns the authoritative plane state so we reset the
craft back to the most recent "safe" checkpoint whenever a high-energy impact
occurs.  Soft touches against the ground simply clamp the altitude so the
plane can taxi without being treated as a crash.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Callable, Optional, Sequence, Tuple

import numpy as np


@dataclass
class CollisionHit:
    """Information about a collision point."""

    point: np.ndarray
    normal: np.ndarray
    kind: str = "ground"
    object_id: Optional[str] = None


@dataclass
class _BoxCollider:
    name: str
    minimum: np.ndarray
    maximum: np.ndarray

    @property
    def center(self) -> np.ndarray:
        return (self.minimum + self.maximum) * 0.5


class CollisionSystem:
    """Detect collisions against the ground and static box obstacles."""

    def __init__(
        self,
        *,
        spawn_position: Optional[Sequence[float]] = None,
        spawn_orientation: Optional[Sequence[float]] = None,
        ground_margin: float = 1.5,
        capsule_radius: float = 6.0,
        capsule_half_height: float = 3.0,
        crash_speed_threshold: float = 80.0,
        crash_pitch_threshold: float = 0.65,
        descent_crash_speed: float = 45.0,
        safe_altitude_threshold: Optional[float] = None,
        safe_descent_rate: float = 35.0,
        grace_period: float = 0.3,
        ground_height_fn: Optional[Callable[[float, float], float]] = None,
        start_time: Optional[float] = None,
    ) -> None:
        self.ground_margin = float(ground_margin)
        self.capsule_radius = float(capsule_radius)
        self.capsule_half_height = float(capsule_half_height)
        self.crash_speed_threshold = float(crash_speed_threshold)
        self.crash_pitch_threshold = float(crash_pitch_threshold)
        self.descent_crash_speed = float(descent_crash_speed)
        self.safe_descent_rate = float(safe_descent_rate)
        self.safe_altitude_threshold = (
            float(safe_altitude_threshold)
            if safe_altitude_threshold is not None
            else self.ground_margin + self.capsule_half_height + 35.0
        )
        self.grace_period = float(grace_period)
        self._ground_fn = ground_height_fn or (lambda _x, _y: 0.0)
        self._obstacles: list[_BoxCollider] = []

        spawn_pos = (
            np.array(spawn_position, dtype=float)
            if spawn_position is not None
            else np.zeros(3, dtype=float)
        )
        self.spawn_position = spawn_pos
        self.spawn_orientation = (
            list(spawn_orientation) if spawn_orientation is not None else [0.0, 0.0, 0.0]
        )

        # Safe checkpoint mirrors the spawn until the aircraft accumulates
        # enough flight time to record a fresher location.
        self._last_safe_position = spawn_pos.copy()
        self._last_safe_velocity = np.zeros(3, dtype=float)
        self._last_safe_orientation = self.spawn_orientation[:]
        self._has_safe_state = spawn_position is not None

        reference_time = start_time if start_time is not None else time.time()
        self._cooldown_until = reference_time + self.grace_period
        self._last_position: Optional[np.ndarray] = None

    # ------------------------------------------------------------------
    # Public helpers
    # ------------------------------------------------------------------
    def add_box_obstacle(
        self,
        *,
        minimum: Sequence[float],
        maximum: Sequence[float],
        name: str = "obstacle",
    ) -> None:
        """Register an axis-aligned box collider."""

        min_corner = np.array(minimum, dtype=float)
        max_corner = np.array(maximum, dtype=float)
        self._obstacles.append(_BoxCollider(name=name, minimum=min_corner, maximum=max_corner))

    def sample_ground_height(self, x: float, y: float) -> float:
        """Return the ground elevation under the supplied coordinates."""

        return float(self._ground_fn(float(x), float(y)))

    # ------------------------------------------------------------------
    # Core step logic
    # ------------------------------------------------------------------
    def handle_step(
        self,
        plane,
        now: Optional[float] = None,
        ensure_tag_fn: Optional[Callable[[Sequence[str], str, bool], None]] = None,
    ) -> Tuple[Optional[CollisionHit], bool]:
        """Check the plane for collisions and apply resets when needed.

        Parameters
        ----------
        plane:
            The simulator plane instance.  It must expose ``pos`` and ``vel``
            ``numpy`` arrays, an ``ori`` list and a ``manual_override`` field
            with a ``disable`` method.
        now:
            Optional timestamp.  Defaults to ``time.time()``.
        ensure_tag_fn:
            Callable compatible with :func:`client.ensure_tag`.  When omitted a
            no-op implementation is used.

        Returns
        -------
        tuple
            ``(hit, crashed)`` where ``hit`` contains collision information (or
            ``None`` if no contact occurred) and ``crashed`` indicates whether
            the plane was reset to a checkpoint.
        """

        if ensure_tag_fn is None:
            ensure_tag_fn = lambda _tags, _value, _present: None  # type: ignore[assignment]

        timestamp = now if now is not None else time.time()
        hit = self._detect_collision(plane)

        if hit is None:
            self._record_safe_state(plane)
            self._last_position = plane.pos.copy()
            return None, False

        if timestamp < self._cooldown_until:
            # Early grace period after a reset – simply push the aircraft out of
            # penetrating geometry without flagging a crash.
            self._resolve_penetration(plane, hit)
            self._last_position = plane.pos.copy()
            return hit, False

        if self._should_crash(plane):
            self._apply_reset(plane, ensure_tag_fn)
            self._cooldown_until = timestamp + self.grace_period
            self._last_position = plane.pos.copy()
            return hit, True

        # Contact without a crash. Clamp the aircraft outside the collider so we
        # avoid sinking into the world geometry.
        self._resolve_penetration(plane, hit)
        self._last_position = plane.pos.copy()
        return hit, False

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------
    def _detect_collision(self, plane) -> Optional[CollisionHit]:
        ground_hit = self._check_ground(plane)
        if ground_hit is not None:
            return ground_hit

        for obstacle in self._obstacles:
            obstacle_hit = self._check_obstacle(plane, obstacle)
            if obstacle_hit is not None:
                return obstacle_hit

        return None

    def _check_ground(self, plane) -> Optional[CollisionHit]:
        ground_height = self.sample_ground_height(plane.pos[0], plane.pos[1])
        bottom = plane.pos[2] - self.capsule_half_height
        if bottom <= ground_height + self.ground_margin:
            point = np.array([plane.pos[0], plane.pos[1], ground_height], dtype=float)
            normal = np.array([0.0, 0.0, 1.0], dtype=float)
            return CollisionHit(point=point, normal=normal, kind="ground", object_id="ground")
        return None

    def _check_obstacle(self, plane, obstacle: _BoxCollider) -> Optional[CollisionHit]:
        # Model the aircraft as an axis-aligned bounding box expanded from its
        # capsule representation. This is conservative but fast and works well
        # for the relatively slow simulator tick rate.
        extents = np.array([
            self.capsule_radius,
            self.capsule_radius,
            self.capsule_half_height,
        ])
        plane_min = plane.pos - extents
        plane_max = plane.pos + extents

        if np.any(plane_max < obstacle.minimum) or np.any(plane_min > obstacle.maximum):
            return None

        overlap_min = np.maximum(plane_min, obstacle.minimum)
        overlap_max = np.minimum(plane_max, obstacle.maximum)
        penetration = overlap_max - overlap_min
        if np.any(penetration <= 0):
            return None

        axis = int(np.argmin(penetration))
        normal = np.zeros(3, dtype=float)
        center = obstacle.center
        normal[axis] = -1.0 if plane.pos[axis] >= center[axis] else 1.0

        point = plane.pos.copy()
        point[axis] = obstacle.maximum[axis] if normal[axis] < 0 else obstacle.minimum[axis]
        return CollisionHit(point=point, normal=normal, kind="obstacle", object_id=obstacle.name)

    def _record_safe_state(self, plane) -> None:
        ground_height = self.sample_ground_height(plane.pos[0], plane.pos[1])
        altitude = plane.pos[2] - ground_height
        vertical_speed = float(plane.vel[2])
        if altitude >= self.safe_altitude_threshold and vertical_speed >= -self.safe_descent_rate:
            self._last_safe_position = plane.pos.copy()
            self._last_safe_velocity = plane.vel.copy()
            self._last_safe_orientation = list(plane.ori) if plane.ori else [0.0, 0.0, 0.0]
            self._has_safe_state = True

    def _should_crash(self, plane) -> bool:
        speed = float(np.linalg.norm(plane.vel))
        if speed >= self.crash_speed_threshold:
            return True

        pitch = 0.0
        if plane.ori and len(plane.ori) > 1:
            try:
                pitch = float(plane.ori[1])
            except (TypeError, ValueError):
                pitch = 0.0
        if abs(pitch) >= self.crash_pitch_threshold:
            return True

        vertical_speed = float(plane.vel[2])
        if vertical_speed <= -self.descent_crash_speed:
            return True

        return False

    def _apply_reset(self, plane, ensure_tag_fn: Callable[[Sequence[str], str, bool], None]) -> None:
        target_position = self._last_safe_position if self._has_safe_state else self.spawn_position
        target_orientation = self._last_safe_orientation if self._has_safe_state else self.spawn_orientation

        plane.pos[:] = target_position
        plane.vel[:] = 0.0
        plane.ori = list(target_orientation)

        plane.manual_override.disable()
        ensure_tag_fn(plane.tags, "manual:override", False)

        # After a reset the checkpoint remains valid so a subsequent crash will
        # continue to respawn at the same location until a new safe state is
        # recorded.
        self._last_safe_position = target_position.copy()
        self._last_safe_velocity = np.zeros(3, dtype=float)
        self._last_safe_orientation = list(target_orientation)
        self._has_safe_state = True

    def _resolve_penetration(self, plane, hit: CollisionHit) -> None:
        if hit.kind == "ground":
            ground_height = self.sample_ground_height(plane.pos[0], plane.pos[1])
            target_bottom = ground_height + self.ground_margin
            plane.pos[2] = target_bottom + self.capsule_half_height
            if plane.vel[2] < 0.0:
                plane.vel[2] = 0.0
        else:
            # Move the plane just outside the obstacle along the surface normal
            # and damp the velocity component that penetrated the collider.
            displacement = hit.normal * (self.capsule_radius + 0.05)
            plane.pos[:] = plane.pos + displacement
            for axis, component in enumerate(hit.normal):
                if component == 0.0:
                    continue
                if component > 0 and plane.vel[axis] < 0:
                    plane.vel[axis] = 0.0
                elif component < 0 and plane.vel[axis] > 0:
                    plane.vel[axis] = 0.0

