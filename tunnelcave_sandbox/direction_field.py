"""Direction field and jolt management for the tunnel path."""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Iterable

from .noise import curl_noise
from .vector import Vector3, rotate_towards


@dataclass(frozen=True)
class FieldParams:
    world_seed: int
    dir_freq: float
    dir_blend: float
    max_turn_per_step_rad: float
    jolt_every_meters: float
    jolt_strength: float


class DivergenceFreeField:
    """Produces smooth directions along the path using curl noise."""

    def __init__(self, params: FieldParams) -> None:
        self._params = params

    def next_direction(
        self,
        position: Vector3,
        previous_direction: Vector3,
        step_index: int,
        arc_length: float,
    ) -> Vector3:
        """Evaluate the field at ``position`` and apply smoothing & jolts."""

        raw_x, raw_y, raw_z = curl_noise(self._params.world_seed, (position.x, position.y, position.z), self._params.dir_freq)
        raw_dir = Vector3(raw_x, raw_y, raw_z)
        if raw_dir.length() < 1e-6:
            raw_dir = Vector3.unit_z()

        blended = previous_direction.lerp(raw_dir, self._params.dir_blend).normalized()
        jolted = self._apply_jolt(blended, step_index, arc_length)
        clamped = rotate_towards(previous_direction, jolted, self._params.max_turn_per_step_rad)
        return clamped.normalized()

    def _apply_jolt(self, direction: Vector3, step_index: int, arc_length: float) -> Vector3:
        params = self._params
        if params.jolt_every_meters <= 0.0 or params.jolt_strength <= 0.0:
            return direction

        # Each step decides deterministically whether a jolt happens by
        # hashing its global index and the chunk-scaled arc length.
        hashed = _hash64(params.world_seed, step_index)
        threshold = 1.0 - math.exp(-arc_length / max(1e-5, params.jolt_every_meters))
        if (hashed & 0xFFFFFFFF) / 0xFFFFFFFF > threshold:
            return direction

        unit = _pseudo_random_unit(hashed ^ 0xABCDEF)
        jolted = (direction + unit * params.jolt_strength).normalized()
        return jolted


def _hash64(seed: int, value: int) -> int:
    v = seed ^ (value + 0x9E3779B97F4A7C15)
    v = (v ^ (v >> 30)) * 0xBF58476D1CE4E5B9
    v = (v ^ (v >> 27)) * 0x94D049BB133111EB
    v = v ^ (v >> 31)
    return v & 0xFFFFFFFFFFFFFFFF


def _pseudo_random_unit(hash_value: int) -> Vector3:
    x = ((hash_value >> 0) & 0xFFFF) / 0xFFFF * 2.0 - 1.0
    y = ((hash_value >> 16) & 0xFFFF) / 0xFFFF * 2.0 - 1.0
    z = ((hash_value >> 32) & 0xFFFF) / 0xFFFF * 2.0 - 1.0
    vec = Vector3(x, y, z)
    length = vec.length()
    if length < 1e-5:
        return Vector3.unit_z()
    return vec / length
