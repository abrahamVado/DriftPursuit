"""Tests for procedural planet generation utilities."""

from __future__ import annotations

import math
import sys
from pathlib import Path

import pytest

# //1.- Extend the module search path to import the in-repo physics package.
sys.path.append(str(Path(__file__).resolve().parents[1]))

from physics.planet import (
    CubedSphereTile,
    PlanetSDF,
    PlanetSpec,
    TileScatterer,
    TileStreamer,
)


@pytest.fixture
def sample_spec() -> PlanetSpec:
    # //1.- Provide a compact specification shared across test cases.
    return PlanetSpec.from_json(
        {
            "seed": 123,
            "radius": 6000.0,
            "atmosphere_height": 80.0,
            "sea_level": 0.0,
            "displacement_octaves": [
                {"frequency": 4.0, "amplitude": 120.0},
                {"frequency": 16.0, "amplitude": 20.0},
            ],
            "temperature_frequency": 1.0,
            "moisture_frequency": 1.5,
            "biome_blend": 0.25,
            "lod_distances": [6500.0, 7500.0, 8500.0],
            "scatter_seed": 987,
            "scatter_radius": 10.0,
            "scatter_density": 4.0,
            "river_resolution": 8,
            "river_threshold": 2.0,
            "river_carve": 15.0,
        }
    )


def test_planet_spec_from_json(sample_spec: PlanetSpec) -> None:
    # //1.- Validate that defaults and explicit values propagate correctly.
    assert sample_spec.radius == pytest.approx(6000.0)
    assert len(sample_spec.displacement_octaves) == 2
    assert sample_spec.lod_distances == (6500.0, 7500.0, 8500.0)
    assert sample_spec.scatter_seed == 987


def test_planet_sdf_consistency(sample_spec: PlanetSpec) -> None:
    # //1.- Ensure SDF responds smoothly along a radial direction.
    sdf = PlanetSDF(sample_spec)
    direction = (1.0, 1.0, 0.5)
    direction = tuple(component / math.sqrt(1.0 + 1.0 + 0.25) for component in direction)
    surface_distance = sample_spec.radius + 10.0
    outside_point = tuple(component * surface_distance for component in direction)
    inside_point = tuple(component * (sample_spec.radius - 10.0) for component in direction)
    assert sdf.sample(outside_point) > 0.0
    assert sdf.sample(inside_point) < 0.0
    # //2.- Confirm that the difference approximates the radial displacement.
    delta = sdf.sample(outside_point) - sdf.sample(inside_point)
    assert delta == pytest.approx(20.0, rel=0.05)


def test_tile_edge_consistency(sample_spec: PlanetSpec) -> None:
    # //1.- Sample two adjacent tiles and verify their shared edge matches.
    tile_a = CubedSphereTile(face=0, i=0, j=0, lod=2)
    tile_b = CubedSphereTile(face=0, i=1, j=0, lod=2)
    edge_a = tile_a.edge_signature("u", tile_a.resolution() - 1)
    edge_b = tile_b.edge_signature("u", 0)
    assert len(edge_a) == len(edge_b)
    for vertex_a, vertex_b in zip(edge_a, edge_b):
        assert vertex_a == pytest.approx(vertex_b)


def test_tile_streamer_counts(sample_spec: PlanetSpec) -> None:
    # //1.- Verify the streaming logic returns the expected number of tiles.
    streamer = TileStreamer(sample_spec)
    tiles_near = streamer.active_tiles(sample_spec.radius + 50.0)
    tiles_far = streamer.active_tiles(sample_spec.radius + 4000.0)
    assert len(tiles_near) == 6 * (2 ** 0) ** 2
    assert len(tiles_far) == 6 * (2 ** 3) ** 2


def test_scatterer_is_deterministic(sample_spec: PlanetSpec) -> None:
    # //1.- The scatterer should generate stable positions per tile.
    scatterer = TileScatterer(sample_spec)
    tile = CubedSphereTile(face=2, i=1, j=1, lod=2)
    first = scatterer.scatter(tile)
    second = scatterer.scatter(tile)
    assert first == second
    # //2.- Altering the seed must update the distribution.
    alternate = scatterer.scatter(tile, seed=sample_spec.scatter_seed + 1)
    assert first != alternate

