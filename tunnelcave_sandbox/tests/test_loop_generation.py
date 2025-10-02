"""Tests verifying loop generation enforces configuration constraints."""
from __future__ import annotations

from tunnelcave_sandbox.src.generation import (
    DivergenceFreeField,
    GenerationSeeds,
    generate_loop_tube,
    load_generator_settings,
)


# //1.- Loop generation should respect configured radius limits and produce rooms.
def test_generate_loop_tube_respects_constraints():
    settings = load_generator_settings()
    seeds = GenerationSeeds(divergence_seed=1, path_seed=2)
    field = DivergenceFreeField.from_seeds(seeds, harmonic_count=3)
    result = generate_loop_tube(field, seeds=seeds, settings=settings)
    assert min(result.profile.radii) >= settings.clearance.min_radius_m
    assert max(result.profile.radii) <= settings.clearance.max_radius_m
    assert result.profile.room_indices


# //2.- Loop generation should close the path to form a loop structure.
def test_generate_loop_tube_produces_closed_path():
    settings = load_generator_settings()
    seeds = GenerationSeeds(divergence_seed=3, path_seed=4)
    field = DivergenceFreeField.from_seeds(seeds, harmonic_count=2)
    result = generate_loop_tube(field, seeds=seeds, settings=settings)
    assert result.tube.segments[0].start == result.tube.segments[-1].end
