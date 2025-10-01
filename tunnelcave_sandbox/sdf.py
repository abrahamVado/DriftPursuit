"""Signed distance utilities for the tunnel."""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Iterable, Sequence

from .geometry import RingSample
from .noise import noise3
from .vector import Vector3


def distance_to_segment(point: Vector3, a: Vector3, b: Vector3) -> float:
    ab = b - a
    ap = point - a
    ab_len_sq = ab.dot(ab)
    if ab_len_sq == 0.0:
        return ap.length()
    t = max(0.0, min(1.0, ap.dot(ab) / ab_len_sq))
    closest = a + ab * t
    return (point - closest).length()


@dataclass(frozen=True)
class SignedDistanceField:
    rings: Sequence[RingSample]
    noise_seed: int
    noise_amplitude: float

    def evaluate(self, point: Vector3) -> float:
        distances = []
        for ring in self.rings:
            distances.append(distance_to_segment(point, ring.center, ring.center + ring.forward))
        base_distance = min(distances) - max(r.max_radius for r in self.rings)
        detail = self.noise_amplitude * noise3(self.noise_seed, point.x, point.y, point.z)
        return base_distance + detail
