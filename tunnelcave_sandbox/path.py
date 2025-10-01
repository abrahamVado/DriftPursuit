"""Sampling helpers that expose the cave as a smooth parametric curve."""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Tuple

from .frame import OrthonormalFrame
from .terrain_generator import TunnelTerrainGenerator
from .vector import Vector3, orthonormalize


@dataclass(frozen=True)
class CurveSample:
    """Interpolated Frenet-style frame and radius data at parameter ``t``."""

    parameter: float
    frame: OrthonormalFrame
    radii: Tuple[float, ...]

    @property
    def min_radius(self) -> float:
        return min(self.radii)

    @property
    def max_radius(self) -> float:
        return max(self.radii)

    def radius_at(self, theta: float) -> float:
        """Return the tunnel radius along angle ``theta`` (radians)."""

        sides = len(self.radii)
        if sides == 0:
            return 0.0
        angle_index = (theta % math.tau) / math.tau * sides
        base_index = int(math.floor(angle_index)) % sides
        next_index = (base_index + 1) % sides
        t = angle_index - math.floor(angle_index)
        return self.radii[base_index] * (1.0 - t) + self.radii[next_index] * t

    def point_on_wall(self, theta: float, radius: float | None = None) -> Vector3:
        """Return a point on the cave wall."""

        frame = self.frame
        r = self.radius_at(theta) if radius is None else max(0.0, radius)
        axis = frame.right * math.cos(theta) + frame.up * math.sin(theta)
        return frame.origin + axis * r


class CavePath:
    """Utility exposing the generated tunnel as ``C(t)`` and ``P(θ, r, t)``."""

    def __init__(self, generator: TunnelTerrainGenerator) -> None:
        self._generator = generator

    def sample(self, t: float) -> CurveSample:
        if t < 0.0:
            raise ValueError("Parameter t must be non-negative")
        self._generator.ensure_arc_length(t)
        rings = self._generator.rings()
        if not rings:
            raise RuntimeError("TunnelTerrainGenerator produced no rings")
        arc_lengths = self._generator.arc_lengths()
        if len(rings) != len(arc_lengths):
            raise RuntimeError("Ring count does not match arc length count")

        if t >= arc_lengths[-1]:
            ring = rings[-1]
            return CurveSample(parameter=arc_lengths[-1], frame=ring.frame, radii=ring.roughness_profile)

        low = 0
        high = len(arc_lengths) - 1
        while low < high:
            mid = (low + high) // 2
            if arc_lengths[mid] <= t:
                low = mid + 1
            else:
                high = mid
        upper_index = max(1, low)
        lower_index = upper_index - 1

        lower_s = arc_lengths[lower_index]
        upper_s = arc_lengths[upper_index]
        denom = max(upper_s - lower_s, 1e-6)
        blend = (t - lower_s) / denom

        lower_ring = rings[lower_index]
        upper_ring = rings[upper_index]

        origin = lower_ring.center.lerp(upper_ring.center, blend)
        forward = lower_ring.forward.lerp(upper_ring.forward, blend).normalized()
        up_hint = lower_ring.frame.up.lerp(upper_ring.frame.up, blend)
        fwd, up, right = orthonormalize(forward, up_hint)
        frame = OrthonormalFrame(origin=origin, forward=fwd, right=right, up=up)

        radii = tuple(
            lower_ring.roughness_profile[i] * (1.0 - blend)
            + upper_ring.roughness_profile[i] * blend
            for i in range(len(lower_ring.roughness_profile))
        )

        return CurveSample(parameter=t, frame=frame, radii=radii)

    def centerline(self, t: float) -> Vector3:
        """Return the centerline point ``C(t)``."""

        return self.sample(t).frame.origin

    def wall_point(self, t: float, theta: float, radius: float | None = None) -> Vector3:
        """Evaluate ``P(θ, r, t)`` at the provided parameters."""

        return self.sample(t).point_on_wall(theta, radius)
