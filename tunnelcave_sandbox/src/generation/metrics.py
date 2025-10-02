"""Metrics export for verifying generated loop statistics across seeds."""
from __future__ import annotations

import json
from dataclasses import dataclass
from statistics import mean
from typing import List, Sequence

from .config import GenerationSeeds
from .divergence_free import DivergenceFreeField
from .loop_generation import (
    LoopGenerationResult,
    generate_loop_tube,
    verify_loop_clearance,
)
from .settings import GeneratorSettings


# //1.- Encapsulate per-seed metrics derived from generated loops.
@dataclass(frozen=True)
class LoopMetrics:
    seed: GenerationSeeds
    min_radius: float
    max_radius: float
    min_clearance: float
    average_clearance: float
    room_count: int


# //2.- Aggregate statistics for a collection of seeds plus compliance summary.
@dataclass(frozen=True)
class MetricsSummary:
    metrics: Sequence[LoopMetrics]
    meets_radius_bounds: bool
    meets_clearance_targets: bool
    has_rooms: bool


# //3.- Compute metrics for a single generated loop instance.
def _compute_metrics_for_result(
    result: LoopGenerationResult,
    *,
    settings: GeneratorSettings,
    seeds: GenerationSeeds,
) -> LoopMetrics:
    min_clearance, average_clearance = verify_loop_clearance(result, settings=settings)
    min_radius = min(result.profile.radii)
    max_radius = max(result.profile.radii)
    room_count = len(result.profile.room_indices)
    return LoopMetrics(
        seed=seeds,
        min_radius=min_radius,
        max_radius=max_radius,
        min_clearance=min_clearance,
        average_clearance=average_clearance,
        room_count=room_count,
    )


# //4.- Evaluate compliance of the metric collection against configured targets.
def _evaluate_targets(metrics: Sequence[LoopMetrics], settings: GeneratorSettings) -> MetricsSummary:
    meets_radius = all(
        settings.clearance.min_radius_m <= metric.min_radius <= settings.clearance.max_radius_m
        and metric.max_radius <= settings.clearance.max_radius_m
        for metric in metrics
    )
    meets_clearance = (
        all(metric.min_clearance >= settings.clearance.min_clearance_m for metric in metrics)
        and mean(metric.average_clearance for metric in metrics) >= settings.clearance.target_average_clearance_m
    )
    has_rooms = any(metric.room_count > 0 for metric in metrics)
    return MetricsSummary(
        metrics=tuple(metrics),
        meets_radius_bounds=meets_radius,
        meets_clearance_targets=meets_clearance,
        has_rooms=has_rooms,
    )


# //5.- Orchestrate generation across multiple seeds collecting metrics.
def collect_generation_metrics(
    *,
    seeds: Sequence[GenerationSeeds],
    settings: GeneratorSettings,
) -> MetricsSummary:
    metrics: List[LoopMetrics] = []
    for seed in seeds:
        field = DivergenceFreeField.from_seeds(seed)
        result = generate_loop_tube(field, seeds=seed, settings=settings)
        metrics.append(_compute_metrics_for_result(result, settings=settings, seeds=seed))
    return _evaluate_targets(metrics, settings)


# //6.- Export metrics summary to JSON for CI validation or dashboards.
def export_generation_metrics(
    summary: MetricsSummary,
    *,
    filepath: str,
) -> None:
    payload = {
        "meets_radius_bounds": summary.meets_radius_bounds,
        "meets_clearance_targets": summary.meets_clearance_targets,
        "has_rooms": summary.has_rooms,
        "metrics": [
            {
                "divergence_seed": metric.seed.divergence_seed,
                "path_seed": metric.seed.path_seed,
                "min_radius": metric.min_radius,
                "max_radius": metric.max_radius,
                "min_clearance": metric.min_clearance,
                "average_clearance": metric.average_clearance,
                "room_count": metric.room_count,
            }
            for metric in summary.metrics
        ],
    }
    with open(filepath, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)
