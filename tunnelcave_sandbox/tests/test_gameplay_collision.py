"""Collision system regression tests for gameplay."""
from __future__ import annotations

import math
from dataclasses import dataclass

from tunnelcave_sandbox.src.gameplay.collision import Capsule, CollisionSystem
from tunnelcave_sandbox.src.gameplay.placeables import PlaceableChunk, RockInstance, TreeInstance
from tunnelcave_sandbox.src.gameplay.terrain import TerrainSampler


@dataclass
class EmptyField:
    chunk_size: float = 200.0

    def chunk(self, chunk_x: int, chunk_z: int) -> PlaceableChunk:
        return PlaceableChunk(rocks=(), trees=(), lakes=())


def _dry_sample(sampler: TerrainSampler) -> tuple[float, float, float]:
    for x in range(-5, 6):
        for z in range(-5, 6):
            px = x * 40.0
            pz = z * 40.0
            sample = sampler.sample(px, pz)
            if not sample.is_water:
                return px, sample.ground_height, pz
    raise AssertionError("Expected at least one dry sample in search radius")


def test_collision_ground_slide() -> None:
    sampler = TerrainSampler(3)
    field = EmptyField()
    system = CollisionSystem(sampler, field)  # type: ignore[arg-type]
    px, ground, pz = _dry_sample(sampler)
    height = ground + 1.0
    previous = Capsule(nose=(px, height + 1.0, pz), tail=(px, height - 6.0, pz), radius=3.0)
    current = Capsule(nose=(px, height, pz), tail=(px, height - 7.0, pz), radius=3.0)
    velocity = (0.0, -15.0, 20.0)
    result = system.sweep(previous, current, velocity, math.sqrt(velocity[1] ** 2 + velocity[2] ** 2))
    assert result is not None
    assert result.hazard == "ground"
    assert not result.kill
    assert result.new_velocity[1] >= result.new_velocity[2] * -1.0


@dataclass
class HazardField:
    rock_center: tuple[float, float, float]
    tree_center: tuple[float, float, float]
    chunk_size: float = 200.0

    def chunk(self, chunk_x: int, chunk_z: int) -> PlaceableChunk:
        rock = RockInstance(center=self.rock_center, radius=5.0)
        tree = TreeInstance(base_center=self.tree_center, trunk_height=12.0, crown_radius=6.0)
        return PlaceableChunk(rocks=(rock,), trees=(tree,), lakes=())


def test_collision_rock_triggers_kill_at_speed() -> None:
    sampler = TerrainSampler(4)
    px, ground, pz = _dry_sample(sampler)
    rock_center = (px, ground + 5.0, pz + 20.0)
    tree_center = (px + 15.0, ground + 5.0, pz + 40.0)
    field = HazardField(rock_center=rock_center, tree_center=tree_center)
    system = CollisionSystem(sampler, field)  # type: ignore[arg-type]
    base = ground + 10.0
    previous = Capsule(nose=(px, base, pz), tail=(px, base - 7.0, pz - 15.0), radius=3.0)
    current = Capsule(nose=(px, base, pz + 28.0), tail=(px, base - 7.0, pz + 13.0), radius=3.0)
    velocity = (0.0, 0.0, 120.0)
    result = system.sweep(previous, current, velocity, 120.0)
    assert result is not None
    assert result.hazard == "rock"
    assert result.kill
