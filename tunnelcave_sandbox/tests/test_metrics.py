"""Tests validating generation metrics export workflow."""
from __future__ import annotations

import json

from tunnelcave_sandbox.src.generation import (
    GenerationSeeds,
    collect_generation_metrics,
    export_generation_metrics,
    load_generator_settings,
)


# //1.- Metrics collection should produce compliant summaries across seeds.
def test_collect_generation_metrics_and_export(tmp_path):
    settings = load_generator_settings()
    seeds = [
        GenerationSeeds(divergence_seed=5, path_seed=6),
        GenerationSeeds(divergence_seed=7, path_seed=8),
        GenerationSeeds(divergence_seed=9, path_seed=10),
    ]
    summary = collect_generation_metrics(seeds=seeds, settings=settings)
    assert summary.meets_radius_bounds
    assert summary.meets_clearance_targets
    assert summary.has_rooms

    output_path = tmp_path / "metrics.json"
    export_generation_metrics(summary, filepath=str(output_path))

    with output_path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    assert payload["meets_radius_bounds"] is True
    assert payload["metrics"]
    assert len(payload["metrics"]) == len(seeds)
