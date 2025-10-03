"""Latency aggregation utilities for bot planning loops."""

from __future__ import annotations

import statistics
import threading
from collections import deque
from dataclasses import dataclass
from typing import Deque


@dataclass
class CycleSnapshot:
    """Immutable summary of recent receive→decide→send timings."""

    samples: int
    planned_samples: int
    median_total_ms: float
    median_decision_ms: float
    median_send_ms: float
    median_diff_ms: float
    average_total_ms: float

    @property
    def planned_ratio(self) -> float:
        """Return the fraction of cycles that triggered a fresh decision."""

        # //1.- Avoid division by zero when no samples have been recorded yet.
        if self.samples == 0:
            return 0.0
        return self.planned_samples / float(self.samples)


class MatchMetrics:
    """Thread-safe accumulator for receive→decide→send timings."""

    def __init__(self, window: int = 256) -> None:
        if window <= 0:
            raise ValueError("window must be positive")
        # //2.- Store each stage of the cycle in a bounded deque to bound memory usage.
        self._total: Deque[float] = deque(maxlen=window)
        self._decision: Deque[float] = deque(maxlen=window)
        self._send: Deque[float] = deque(maxlen=window)
        self._diff: Deque[float] = deque(maxlen=window)
        self._samples = 0
        self._planned = 0
        self._lock = threading.Lock()

    def record(
        self,
        *,
        diff_s: float,
        decision_s: float,
        send_s: float,
        total_s: float,
        planned: bool,
    ) -> None:
        """Store a new timing sample expressed in seconds."""

        diff_ms = max(diff_s, 0.0) * 1000.0
        decision_ms = max(decision_s, 0.0) * 1000.0
        send_ms = max(send_s, 0.0) * 1000.0
        total_ms = max(total_s, 0.0) * 1000.0
        with self._lock:
            # //3.- Append each stage so rolling statistics can be computed efficiently.
            self._diff.append(diff_ms)
            self._decision.append(decision_ms)
            self._send.append(send_ms)
            self._total.append(total_ms)
            self._samples += 1
            if planned:
                self._planned += 1

    def snapshot(self) -> CycleSnapshot:
        """Compute median and average timings over the recent window."""

        with self._lock:
            if not self._total:
                # //4.- Return a zeroed snapshot so callers can handle cold starts gracefully.
                return CycleSnapshot(0, 0, 0.0, 0.0, 0.0, 0.0, 0.0)
            total = list(self._total)
            decision = list(self._decision)
            send = list(self._send)
            diff = list(self._diff)
            samples = self._samples
            planned = self._planned
        # //5.- Compute statistics outside the lock to minimise contention.
        return CycleSnapshot(
            samples=samples,
            planned_samples=planned,
            median_total_ms=statistics.median(total),
            median_decision_ms=statistics.median(decision),
            median_send_ms=statistics.median(send),
            median_diff_ms=statistics.median(diff),
            average_total_ms=statistics.fmean(total),
        )

    def reset(self) -> None:
        """Discard accumulated samples and start a fresh window."""

        with self._lock:
            # //6.- Clear every deque atomically so concurrent readers never see partial state.
            self._total.clear()
            self._decision.clear()
            self._send.clear()
            self._diff.clear()
            self._samples = 0
            self._planned = 0


__all__ = ["CycleSnapshot", "MatchMetrics"]
