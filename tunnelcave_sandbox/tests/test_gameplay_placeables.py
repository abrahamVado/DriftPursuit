"""Tests validating deterministic scattering for gameplay placeables."""
from __future__ import annotations

import math

from tunnelcave_sandbox.src.gameplay.placeables import PlaceableField
from tunnelcave_sandbox.src.gameplay.terrain import TerrainSampler


def _horizontal_distance(a, b):
    return math.sqrt((a[0] - b[0]) ** 2 + (a[2] - b[2]) ** 2)


def test_placeables_deterministic_by_seed() -> None:
    sampler = TerrainSampler(99)
    field_a = PlaceableField(sampler, seed=77)
    field_b = PlaceableField(sampler, seed=77)
    chunk_a = field_a.chunk(0, 0)
    chunk_b = field_b.chunk(0, 0)
    assert chunk_a == chunk_b


def test_placeables_respect_poisson_spacing() -> None:
    sampler = TerrainSampler(21)
    field = PlaceableField(sampler, seed=21)
    chunk = field.chunk(1, -2)
    for rock in chunk.rocks:
        for other in chunk.rocks:
            if rock is other:
                continue
            assert _horizontal_distance(rock.center, other.center) >= 6.0
    for tree in chunk.trees:
        for other in chunk.trees:
            if tree is other:
                continue
            assert _horizontal_distance(tree.base_center, other.base_center) >= 8.0
