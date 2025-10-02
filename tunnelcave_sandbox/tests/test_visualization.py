"""Tests validating visualization sampling utilities."""
from __future__ import annotations

from pathlib import Path

import pytest

from tunnelcave_sandbox.src.generation import (
    DivergenceFreeField,
    GenerationSeeds,
    export_continuity_csv,
    generate_seeded_tube,
    sample_tube_clearance,
)


def test_clearance_sampling_monotonic_arc_length(tmp_path: Path):
    seeds = GenerationSeeds(divergence_seed=8, path_seed=21)
    field = DivergenceFreeField.from_seeds(seeds, harmonic_count=3)
    tube = generate_seeded_tube(
        field,
        seed=(0.0, 0.0, 0.0),
        steps=12,
        step_size=0.25,
        base_radius=0.2,
        radius_variation=0.08,
    )
    offsets = [
        (0.2, 0.0, 0.0),
        (-0.2, 0.0, 0.0),
        (0.0, 0.2, 0.0),
    ]
    samples = list(sample_tube_clearance(tube, step=0.1, lateral_offsets=offsets))
    arc_lengths = [sample.arc_length for sample in samples]
    assert arc_lengths == sorted(arc_lengths)

    export_path = tmp_path / "continuity.csv"
    export_continuity_csv(samples, str(export_path))
    assert export_path.exists()
    assert export_path.stat().st_size > 0
