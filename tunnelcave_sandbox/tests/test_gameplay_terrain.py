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


def test_sampler_ground_hugs_planet_shell() -> None:
    sampler = TerrainSampler(9)
    x, z = 320.0, -240.0
    sample = sampler.sample(x, z)
    center = sampler.planet_center
    # //1.- Compute the analytical shell height to confirm the sampler tracks the spherical planet.
    dx = x - center[0]
    dz = z - center[2]
    shell_height = center[1] + math.sqrt(max(sampler.planet_radius ** 2 - dx * dx - dz * dz, 0.0))
    deviation = abs(sample.ground_height - shell_height)
    # //2.- Allow for procedural noise while requiring the deviation to stay within mountain amplitude.
    assert deviation <= 70.0


def test_sampler_normal_points_outward_from_planet_center() -> None:
    sampler = TerrainSampler(21)
    x, z = -180.0, 410.0
    sample = sampler.sample(x, z)
    center = sampler.planet_center
    # //1.- Build the radial direction from the planet center to the surface point.
    radial = (
        x - center[0],
        sample.ground_height - center[1],
        z - center[2],
    )
    length = math.sqrt(sum(component * component for component in radial))
    assert length > 0.0
    radial_normal = tuple(component / length for component in radial)
    alignment = sum(a * b for a, b in zip(sample.surface_normal, radial_normal))
    # //2.- Require normals to closely align with the radial vector for a convincing spherical planet.
    assert alignment > 0.9
