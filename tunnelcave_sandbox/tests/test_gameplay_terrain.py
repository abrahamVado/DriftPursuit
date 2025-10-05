"""Tests for gameplay terrain sampler determinism and structure."""
from __future__ import annotations

import math

from tunnelcave_sandbox.src.gameplay.terrain import TerrainSampler


def test_sampler_deterministic_across_instances() -> None:
    sampler_a = TerrainSampler(1337)
    sampler_b = TerrainSampler(1337)
    sample_a = sampler_a.sample(120.5, -42.25)
    sample_b = sampler_b.sample(120.5, -42.25)
    assert sample_a == sample_b


def test_sampler_produces_reasonable_normals() -> None:
    sampler = TerrainSampler(7)
    sample = sampler.sample(10.0, 10.0)
    length = math.sqrt(sum(component * component for component in sample.surface_normal))
    assert math.isclose(length, 1.0, rel_tol=1e-5)
    assert 0.0 <= sample.slope_radians <= math.pi / 2


def test_sampler_distinguishes_biomes_by_seed() -> None:
    sampler_a = TerrainSampler(1)
    sampler_b = TerrainSampler(2)
    sample_a = sampler_a.sample(500.0, 500.0)
    sample_b = sampler_b.sample(500.0, 500.0)
    assert sample_a.biome in {"plains", "forest", "alpine", "lakeshore"}
    # Seeds should decorrelate biomes for the same coordinates.
    assert sample_a.biome != sample_b.biome or sample_a.ground_height != sample_b.ground_height
