"""Procedural placement of rocks, trees, and lakes for the gameplay world."""
from __future__ import annotations

import math
import random
from dataclasses import dataclass
from typing import List, Tuple

from .terrain import TerrainSampler
from .vector import Vector3, add, length


# //1.- Represent basic geometric proxies for obstacle queries.
@dataclass(frozen=True)
class RockInstance:
    center: Vector3
    radius: float


# //2.- Model a tree using a capsule trunk and spherical canopy.
@dataclass(frozen=True)
class TreeInstance:
    base_center: Vector3
    trunk_height: float
    crown_radius: float


# //3.- Describe a lake surface and the associated water volume marker.
@dataclass(frozen=True)
class LakeInstance:
    center: Vector3
    radius: float
    water_height: float


# //4.- Bundle the generated props for a chunk to avoid recomputation.
@dataclass(frozen=True)
class PlaceableChunk:
    rocks: Tuple[RockInstance, ...]
    trees: Tuple[TreeInstance, ...]
    lakes: Tuple[LakeInstance, ...]


# //5.- Deterministically scatter points using a Poisson disk approximation.
def _poisson_disk_points(
    rng: random.Random,
    origin: Vector3,
    count: int,
    radius: float,
    sampler: TerrainSampler,
) -> List[Vector3]:
    accepted: List[Vector3] = []
    attempts = 0
    while len(accepted) < count and attempts < count * 20:
        attempts += 1
        offset = (rng.random(), 0.0, rng.random())
        candidate = (
            origin[0] + offset[0],
            0.0,
            origin[2] + offset[2],
        )
        ground = sampler.sample(candidate[0], candidate[2]).ground_height
        candidate = (candidate[0], ground, candidate[2])
        if all(length((candidate[0] - p[0], 0.0, candidate[2] - p[2])) >= radius for p in accepted):
            accepted.append(candidate)
    return accepted


# //6.- Placeable field orchestrating prop distribution per chunk.
class PlaceableField:
    def __init__(self, sampler: TerrainSampler, seed: int, chunk_size: float = 200.0) -> None:
        self._sampler = sampler
        self._seed = int(seed)
        self._chunk_size = float(chunk_size)
        self._cache: dict[Tuple[int, int], PlaceableChunk] = {}

    @property
    def chunk_size(self) -> float:
        return self._chunk_size

    def _rng_for_chunk(self, chunk_x: int, chunk_z: int) -> random.Random:
        value = (self._seed * 91815541 + chunk_x * 19349663 + chunk_z * 83492791) & 0xFFFFFFFF
        return random.Random(value)

    def _chunk_origin(self, chunk_x: int, chunk_z: int) -> Vector3:
        return (chunk_x * self._chunk_size, 0.0, chunk_z * self._chunk_size)

    def _spawn_rocks(self, rng: random.Random, origin: Vector3) -> Tuple[RockInstance, ...]:
        points = _poisson_disk_points(rng, origin, 12, 8.0, self._sampler)
        rocks: List[RockInstance] = []
        for point in points:
            size = 3.0 + rng.random() * 6.0
            rocks.append(RockInstance(center=add(point, (0.0, size * 0.3, 0.0)), radius=size))
        return tuple(rocks)

    def _spawn_trees(self, rng: random.Random, origin: Vector3) -> Tuple[TreeInstance, ...]:
        points = _poisson_disk_points(rng, origin, 15, 12.0, self._sampler)
        trees: List[TreeInstance] = []
        for point in points:
            sample = self._sampler.sample(point[0], point[2])
            if sample.slope_radians > math.radians(35):
                continue
            trunk = 6.0 + rng.random() * 9.0
            crown = trunk * (0.6 + rng.random() * 0.2)
            trees.append(TreeInstance(base_center=point, trunk_height=trunk, crown_radius=crown))
        return tuple(trees)

    def _spawn_lakes(self, rng: random.Random, origin: Vector3) -> Tuple[LakeInstance, ...]:
        lakes: List[LakeInstance] = []
        for _ in range(3):
            sample_point = (
                origin[0] + rng.random() * self._chunk_size,
                0.0,
                origin[2] + rng.random() * self._chunk_size,
            )
            sample = self._sampler.sample(sample_point[0], sample_point[2])
            if sample.slope_radians > math.radians(10):
                continue
            if sample.ground_height > sample.water_height:
                continue
            radius = 25.0 + rng.random() * 20.0
            lakes.append(
                LakeInstance(
                    center=(sample_point[0], sample.water_height, sample_point[2]),
                    radius=radius,
                    water_height=sample.water_height,
                )
            )
        return tuple(lakes)

    def chunk(self, chunk_x: int, chunk_z: int) -> PlaceableChunk:
        key = (chunk_x, chunk_z)
        if key not in self._cache:
            rng = self._rng_for_chunk(chunk_x, chunk_z)
            origin = self._chunk_origin(chunk_x, chunk_z)
            rocks = self._spawn_rocks(rng, origin)
            trees = self._spawn_trees(rng, origin)
            lakes = self._spawn_lakes(rng, origin)
            self._cache[key] = PlaceableChunk(rocks=rocks, trees=trees, lakes=lakes)
        return self._cache[key]
