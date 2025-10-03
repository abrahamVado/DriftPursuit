"""Unit tests for the MatchMetrics latency aggregator."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[1]))

from bots.match_metrics import MatchMetrics


def test_match_metrics_snapshot_reports_medians() -> None:
    metrics = MatchMetrics(window=4)

    # //1.- Record a handful of samples to populate the rolling window.
    metrics.record(diff_s=0.001, decision_s=0.002, send_s=0.001, total_s=0.004, planned=True)
    metrics.record(diff_s=0.001, decision_s=0.001, send_s=0.001, total_s=0.003, planned=False)
    metrics.record(diff_s=0.002, decision_s=0.001, send_s=0.001, total_s=0.004, planned=True)

    snapshot = metrics.snapshot()

    assert snapshot.samples == 3
    assert snapshot.planned_samples == 2
    assert snapshot.dropped_frames == 1
    assert snapshot.median_total_ms == 4.0
    assert snapshot.median_decision_ms == 1.0
    assert snapshot.median_diff_ms == 1.0
    assert 3.0 <= snapshot.average_total_ms <= 4.0
    assert snapshot.planned_ratio == 2 / 3


def test_match_metrics_reset_clears_samples() -> None:
    metrics = MatchMetrics(window=2)
    metrics.record(diff_s=0.001, decision_s=0.001, send_s=0.001, total_s=0.003, planned=True)

    # //2.- Resetting empties the window and zeroes the counters.
    metrics.reset()
    snapshot = metrics.snapshot()
    assert snapshot.samples == 0
    assert snapshot.average_total_ms == 0.0
    assert snapshot.dropped_frames == 0
