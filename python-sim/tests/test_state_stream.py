"""Unit tests for the gRPC diff receiver pipeline."""

from __future__ import annotations

import json
import time
from typing import List, Tuple

from driftpursuit_proto.generated.driftpursuit.broker.v0 import streaming_pb2

from bot_sdk.state_stream import CodecRegistry, StateStreamReceiver


def make_frame(tick: int, payload: dict, encoding: str = "identity") -> streaming_pb2.StateDiffFrame:
    """Helper to construct frames with serialised payloads."""

    # //1.- Encode the payload once so the tests stay focused on ordering logic.
    return streaming_pb2.StateDiffFrame(tick=tick, encoding=encoding, payload=json.dumps(payload).encode("utf-8"))


def test_receiver_applies_diffs_in_tick_order() -> None:
    receiver = StateStreamReceiver(start_tick=1)
    applied: List[Tuple[int, dict]] = []

    # //2.- Feed frames out of order to ensure buffering waits for missing ticks.
    frames = [
        make_frame(2, {"value": "b"}),
        make_frame(1, {"value": "a"}),
        make_frame(3, {"value": "c"}),
    ]

    for frame in frames:
        receiver.handle_frame(frame, lambda tick, diff: applied.append((tick, diff)))

    assert [tick for tick, _ in applied] == [1, 2, 3]
    assert [diff["value"] for _, diff in applied] == ["a", "b", "c"]


def test_receiver_records_decompression_latency() -> None:
    delay = 0.01

    # //3.- Register a slow codec that simulates heavy decompression workloads.
    registry = CodecRegistry.default()

    def slow_decode(data: bytes) -> bytes:
        time.sleep(delay)
        return data

    registry.register("slow", slow_decode)
    receiver = StateStreamReceiver(start_tick=5, codec_registry=registry)

    applied: List[int] = []
    frame = make_frame(5, {"value": 42}, encoding="slow")
    receiver.handle_frame(frame, lambda tick, _: applied.append(tick))

    assert applied == [5]
    samples = receiver.latency_samples
    assert len(samples) == 1
    # //4.- Decompression timing should include the artificial delay.
    assert samples[0] >= delay
