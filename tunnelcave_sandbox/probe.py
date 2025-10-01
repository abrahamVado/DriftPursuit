"""Ring probing utilities for spawn placement."""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Iterable, Sequence, Tuple

from .geometry import RingSample
from .vector import Vector3


@dataclass(frozen=True)
class ProbeSample:
    axis: Vector3
    distances: Tuple[float, float]


class RingProbe:
    """Provides clearance estimates for a ring by sampling diameters."""

    def __init__(self, ring: RingSample) -> None:
        self._ring = ring

    def clearance_along(self, axis: Vector3) -> Tuple[float, float, float]:
        axis_plane = self._project_to_plane(axis)
        if axis_plane.length() < 1e-6:
            raise ValueError("Axis must not be parallel to the forward vector")
        axis_plane = axis_plane.normalized()
        angle = math.atan2(axis_plane.dot(self._ring.frame.up), axis_plane.dot(self._ring.frame.right))
        sides = len(self._ring.roughness_profile)
        angle_index = (angle / math.tau) * sides
        radius_pos = self._ring.radius_at_angle(angle_index % sides)
        radius_neg = self._ring.radius_at_angle((angle_index + sides / 2) % sides)
        return radius_pos, radius_neg, radius_pos + radius_neg

    def min_mean_variance(self, sample_count: int = 8) -> Tuple[float, float, float]:
        values = []
        for i in range(sample_count):
            angle = (i / sample_count) * math.tau
            axis = self._ring.frame.right * math.cos(angle) + self._ring.frame.up * math.sin(angle)
            _, _, diameter = self.clearance_along(axis)
            values.append(diameter)
        mean = sum(values) / len(values)
        min_val = min(values)
        variance = sum((v - mean) ** 2 for v in values) / len(values)
        return min_val, mean, variance

    def _project_to_plane(self, vector: Vector3) -> Vector3:
        forward = self._ring.forward
        return vector - forward * vector.dot(forward)
