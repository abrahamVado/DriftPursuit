"""Tests for divergence-free noise utilities."""
from __future__ import annotations

import pytest

from tunnelcave_sandbox.src.generation import (
    DivergenceFreeField,
    GenerationSeeds,
    finite_difference_divergence,
)


def test_divergence_is_near_zero():
    seeds = GenerationSeeds(divergence_seed=123, path_seed=999)
    field = DivergenceFreeField.from_seeds(seeds, harmonic_count=4)
    samples = []
    for step in range(5):
        offset = -0.5 + step * 0.25
        point = (0.2 + offset, -0.1 + 0.5 * offset, 0.3 - 0.2 * offset)
        samples.append(abs(finite_difference_divergence(field, point)))
    assert max(samples) < 1e-3


def test_seeded_fields_are_reproducible():
    seeds = GenerationSeeds(divergence_seed=77, path_seed=12)
    field_a = DivergenceFreeField.from_seeds(seeds, harmonic_count=5)
    field_b = DivergenceFreeField.from_seeds(seeds, harmonic_count=5)
    point = (0.25, -0.4, 0.75)
    assert field_a.sample(point) == pytest.approx(field_b.sample(point))
