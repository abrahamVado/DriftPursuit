"""Lightweight visualization helpers for cave continuity analysis."""
from __future__ import annotations

import csv
from dataclasses import dataclass
from typing import Iterable, Sequence

from .swept_tube import SweptTube, _vec_add, _vec_norm


# //1.- Dataclass capturing sampled continuity information.
@dataclass
class ContinuitySample:
    arc_length: float
    clearance: float
    radius: float


# //2.- Sample clearance by querying SDF around the tube centerline.
def sample_tube_clearance(
    tube: SweptTube,
    *,
    step: float,
    lateral_offsets: Sequence[Sequence[float]],
) -> Iterable[ContinuitySample]:
    points = tube.sample_along_path(max(2, int(1.0 / max(step, 1e-6))))
    arc_length = 0.0
    previous = points[0]
    for center_point in points[1:]:
        segment_length = _vec_norm(
            (
                center_point[0] - previous[0],
                center_point[1] - previous[1],
                center_point[2] - previous[2],
            )
        )
        arc_length += segment_length
        previous = center_point
        distances = []
        for offset in lateral_offsets:
            query = _vec_add(center_point, offset)
            distances.append(tube.sdf(query))
        clearance = min(distances) if distances else tube.sdf(center_point)
        radius = -tube.sdf(center_point)
        yield ContinuitySample(arc_length=arc_length, clearance=clearance, radius=radius)


# //3.- Export sampled continuity profile to CSV for manual visualization.
def export_continuity_csv(
    samples: Iterable[ContinuitySample],
    filepath: str,
) -> None:
    with open(filepath, "w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["arc_length", "clearance", "radius"])
        for sample in samples:
            writer.writerow([sample.arc_length, sample.clearance, sample.radius])
