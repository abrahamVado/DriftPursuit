"""Data structures describing the generated tunnel geometry."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Sequence, Tuple

from .frame import OrthonormalFrame
from .vector import Vector3


@dataclass(frozen=True)
class RingSample:
    """A single ring along the tunnel center line."""

    frame: OrthonormalFrame
    radius: float
    roughness_profile: Tuple[float, ...]

    @property
    def center(self) -> Vector3:
        return self.frame.origin

    @property
    def forward(self) -> Vector3:
        return self.frame.forward

    def radius_at_angle(self, angle_index: float) -> float:
        sides = len(self.roughness_profile)
        base_index = int(angle_index) % sides
        next_index = (base_index + 1) % sides
        t = angle_index - int(angle_index)
        return self.roughness_profile[base_index] * (1.0 - t) + self.roughness_profile[next_index] * t

    @property
    def max_radius(self) -> float:
        return max(self.roughness_profile)

    @property
    def min_radius(self) -> float:
        return min(self.roughness_profile)
      
    def diameter_stats(self) -> Tuple[float, float, float]:
        values = list(self.roughness_profile)
        mean = sum(values) * 2.0 / len(values)
        min_val = min(values) * 2.0
        variance = sum((v - mean * 0.5) ** 2 for v in values) / len(values)
        return min_val, mean, variance


@dataclass
class MeshChunk:
    vertices: List[Vector3]
    indices: List[int]


@dataclass
class SDFChunk:
    ring_indexes: Tuple[int, ...]
    radii: Tuple[float, ...]


@dataclass
class ChunkGeometry:
    """Combined geometry information for a single chunk."""

    chunk_index: int
    rings: Tuple[RingSample, ...]
    mesh: MeshChunk | None = None
    sdf: SDFChunk | None = None
    aabb_min: Vector3 = field(default_factory=Vector3.zero)
    aabb_max: Vector3 = field(default_factory=Vector3.zero)
    widest_ring_index: int = 0
    min_radius: float = 0.0
    max_radius: float = 0.0

    def update_bounds(self) -> None:
        mins = [float("inf"), float("inf"), float("inf")]
        maxs = [float("-inf"), float("-inf"), float("-inf")]
        for ring in self.rings:
            max_radius = ring.max_radius
            for axis in (ring.frame.right, ring.frame.up):
                for s in (-1.0, 1.0):
                    point = ring.center + axis * (max_radius * s)
                    mins[0] = min(mins[0], point.x)
                    mins[1] = min(mins[1], point.y)
                    mins[2] = min(mins[2], point.z)
                    maxs[0] = max(maxs[0], point.x)
                    maxs[1] = max(maxs[1], point.y)
                    maxs[2] = max(maxs[2], point.z)
        self.aabb_min = Vector3.from_iter(mins)
        self.aabb_max = Vector3.from_iter(maxs)

    def summary(self) -> str:
        return (
            f"Chunk {self.chunk_index}: rings={len(self.rings)}, "
            f"radius range=({self.min_radius:.2f}, {self.max_radius:.2f}), "
            f"widest ring={self.widest_ring_index}"
        )
