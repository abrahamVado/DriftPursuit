"""Tests verifying loop generation enforces configuration constraints."""
from __future__ import annotations

from dataclasses import replace
from math import isclose

from tunnelcave_sandbox.src.generation import (
    DivergenceFreeField,
    GenerationSeeds,
    WorldSettings,
    generate_loop_tube,
    load_generator_settings,
)
from tunnelcave_sandbox.src.world import SPAWN_TAG


# //1.- Loop generation should respect configured radius limits and produce rooms.
def test_generate_loop_tube_respects_constraints():
    settings = load_generator_settings()
    seeds = GenerationSeeds(divergence_seed=1, path_seed=2)
    field = DivergenceFreeField.from_seeds(seeds, harmonic_count=3)
    result = generate_loop_tube(field, seeds=seeds, settings=settings)
    assert min(result.profile.radii) >= settings.clearance.min_radius_m
    assert max(result.profile.radii) <= settings.clearance.max_radius_m
    assert result.profile.room_indices
    assert result.descriptor.tagged(SPAWN_TAG)


# //2.- Loop generation should close the path to form a loop structure.
def test_generate_loop_tube_produces_closed_path():
    settings = load_generator_settings()
    seeds = GenerationSeeds(divergence_seed=3, path_seed=4)
    field = DivergenceFreeField.from_seeds(seeds, harmonic_count=2)
    result = generate_loop_tube(field, seeds=seeds, settings=settings)
    assert result.tube.segments[0].start == result.tube.segments[-1].end


# //3.- Spherical geometry should wrap the generated path to a consistent radius.
def test_generate_loop_tube_projects_to_sphere():
    settings = load_generator_settings()
    spherical_settings = replace(settings, world=WorldSettings(geometry="sphere", radius_m=2500.0))
    seeds = GenerationSeeds(divergence_seed=5, path_seed=6)
    field = DivergenceFreeField.from_seeds(seeds, harmonic_count=3)
    result = generate_loop_tube(field, seeds=seeds, settings=spherical_settings)
    radii = [
        (segment.start, segment.end)
        for segment in result.tube.segments
    ]
    for start, end in radii:
        start_radius = (start[0] ** 2 + start[1] ** 2 + start[2] ** 2) ** 0.5
        end_radius = (end[0] ** 2 + end[1] ** 2 + end[2] ** 2) ** 0.5
        assert isclose(start_radius, spherical_settings.world.radius_m, rel_tol=1e-3)
        assert isclose(end_radius, spherical_settings.world.radius_m, rel_tol=1e-3)
