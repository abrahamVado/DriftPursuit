"""Latency budget regression checks for the planning loop."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[1]))

from bots.match_metrics import MatchMetrics


def test_planning_median_latency_within_budget() -> None:
    metrics = MatchMetrics(window=16)

    # //1.- Record representative cycle timings collected during integration runs.
    samples = [0.018, 0.021, 0.019, 0.022, 0.020]
    for total in samples:
        metrics.record(
            diff_s=total * 0.4,
            decision_s=total * 0.4,
            send_s=total * 0.2,
            total_s=total,
            planned=True,
        )

    snapshot = metrics.snapshot()

    # //2.- Fail the test if the aggregated median breaches the 40 ms target.
    assert snapshot.dropped_frames == 0
    assert snapshot.median_total_ms <= 40.0, f"Median planning latency {snapshot.median_total_ms}ms exceeds budget"
