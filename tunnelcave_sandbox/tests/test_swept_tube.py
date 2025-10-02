"""Tests for swept tube generation and analytic SDF."""
from __future__ import annotations

import pytest

from tunnelcave_sandbox.src.generation import (
    DivergenceFreeField,
    GenerationSeeds,
    generate_seeded_tube,
)


def test_seeded_tube_produces_reasonable_sdf():
    seeds = GenerationSeeds(divergence_seed=5, path_seed=10)
    field = DivergenceFreeField.from_seeds(seeds, harmonic_count=3)
    tube = generate_seeded_tube(
        field,
        seed=(0.0, 0.0, 0.0),
        steps=15,
        step_size=0.3,
        base_radius=0.25,
        radius_variation=0.1,
    )
    centerline = tube.sample_along_path(5)
    for point in centerline:
        clearance = -tube.sdf(point)
        assert clearance >= 0
        assert 0.15 <= clearance <= 0.35
    outside_point = (
        centerline[len(centerline) // 2][0] + 1.0,
        centerline[len(centerline) // 2][1],
        centerline[len(centerline) // 2][2],
    )
    assert tube.sdf(outside_point) > 0.5


def test_sdf_is_consistent_with_analytic_callable():
    seeds = GenerationSeeds(divergence_seed=7, path_seed=2)
    field = DivergenceFreeField.from_seeds(seeds, harmonic_count=4)
    tube = generate_seeded_tube(
        field,
        seed=(0.0, 0.0, 0.0),
        steps=10,
        step_size=0.2,
        base_radius=0.2,
        radius_variation=0.05,
    )
    sdf_func = tube.analytic_sdf()
    sample_point = (0.5, 0.2, -0.1)
    assert sdf_func(sample_point) == pytest.approx(tube.sdf(sample_point))
