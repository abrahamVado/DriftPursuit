"""Spawn selection logic for the tunnel sandbox."""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Iterable, List, Sequence

from .geometry import RingSample
from .probe import RingProbe
from .vector import Vector3


@dataclass(frozen=True)
class SpawnRequest:
    arc_window: tuple[int, int]
    craft_radius: float


@dataclass(frozen=True)
class SpawnResult:
    position: Vector3
    forward: Vector3
    right: Vector3
    up: Vector3


class SpawnPlanner:
    """Searches rings for a safe deterministic spawn pose."""

    def __init__(self, rings: Sequence[RingSample]) -> None:
        self._rings = rings

    def plan(self, request: SpawnRequest) -> SpawnResult:
        start, end = request.arc_window
        candidate_indexes = list(range(max(0, start), min(len(self._rings), end)))
        scored = []
        for index in candidate_indexes:
            ring = self._rings[index]
            probe = RingProbe(ring)
            min_d, mean_d, variance = probe.min_mean_variance(12)
            score = mean_d - variance - abs(mean_d - min_d)
            scored.append((score, index))
        scored.sort(reverse=True)
        for _, index in scored:
            result = self._try_ring(index, request.craft_radius)
            if result is not None:
                return result
        widest_index = max(range(len(self._rings)), key=lambda i: self._rings[i].radius)
        fallback = self._try_ring(widest_index, request.craft_radius)
        if fallback is None:
            raise RuntimeError("Failed to find safe spawn pose")
        return fallback

    def _try_ring(self, index: int, craft_radius: float) -> SpawnResult | None:
        ring = self._rings[index]
        probe = RingProbe(ring)
        best_axis = None
        best_margin = -float("inf")
        best_distances = (0.0, 0.0)
        for i in range(16):
            angle = (i / 16) * math.tau
            axis = ring.frame.right * math.cos(angle) + ring.frame.up * math.sin(angle)
            dist_pos, dist_neg, diameter = probe.clearance_along(axis)
            margin = min(dist_pos, dist_neg) - craft_radius
            if margin > best_margin:
                best_margin = margin
                best_axis = axis.normalized()
                best_distances = (dist_pos, dist_neg)
        if best_axis is None or best_margin <= 0.0:
            return None
        dist_pos, dist_neg = best_distances
        midpoint_shift = (dist_pos - dist_neg) * 0.5
        position = ring.center + best_axis * midpoint_shift
        forward = ring.forward
        right = best_axis
        up = forward.cross(right).normalized()
        return SpawnResult(position=position, forward=forward, right=right, up=up)
