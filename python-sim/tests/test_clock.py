"""Tests for the client-side clock synchronisation helpers."""

from __future__ import annotations

import math

from driftpursuit_proto.clock import ClockSynchronizer


def test_clock_clamps_large_offsets() -> None:
    clock = ClockSynchronizer()
    clock.ingest({"recommended_offset_ms": 120}, received_at_ms=1_000)
    assert math.isclose(clock.current_offset(), 50.0)
    clock.ingest({"recommended_offset_ms": 120}, received_at_ms=1_100)
    assert math.isclose(clock.current_offset(), 100.0)


def test_clock_smooths_small_offsets() -> None:
    clock = ClockSynchronizer()
    clock.ingest({"recommended_offset_ms": 30}, received_at_ms=2_000)
    offset = clock.current_offset()
    assert 0 < offset < 30


def test_clock_projects_server_time() -> None:
    clock = ClockSynchronizer()
    clock.ingest({"recommended_offset_ms": -40}, received_at_ms=3_000)
    projected = clock.now(10_000)
    assert math.isclose(projected, 10_000 + clock.current_offset(), rel_tol=0, abs_tol=1e-6)
    assert math.isclose(clock.last_update_timestamp(), 3_000.0)
