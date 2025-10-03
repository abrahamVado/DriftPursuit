"""Deterministic receiver pipeline for broker state diff streams."""

from __future__ import annotations

import json
import time
from collections import deque
from heapq import heappop, heappush
from typing import Callable, Deque, Dict, Mapping, MutableMapping, Optional, Tuple

import gzip

from driftpursuit_proto.generated.driftpursuit.broker.v0 import streaming_pb2

# //1.- Define type aliases so call sites remain concise and typed.
DiffPayload = Mapping[str, object]
ApplyCallback = Callable[[int, DiffPayload], None]


class CodecRegistry:
    """Registry that maps encoding identifiers to decompress functions."""

    def __init__(self) -> None:
        # //2.- Maintain a normalised map so lookups remain case-insensitive.
        self._codecs: Dict[str, Callable[[bytes], bytes]] = {}

    def register(self, name: str, decoder: Callable[[bytes], bytes]) -> None:
        """Register a decompressor for the provided encoding name."""

        # //3.- Validate inputs eagerly so misconfigurations surface during setup.
        if not name:
            raise ValueError("codec name must be provided")
        if decoder is None:
            raise ValueError("decoder must be callable")
        key = name.lower()
        self._codecs[key] = decoder

    def decompress(self, name: str, payload: bytes) -> bytes:
        """Resolve the codec for *name* and return the decoded payload."""

        # //4.- Enforce known encodings to avoid silent corruption.
        decoder = self._codecs.get((name or "").lower())
        if decoder is None:
            raise ValueError(f"unsupported encoding {name!r}")
        return decoder(payload)

    @classmethod
    def default(cls) -> "CodecRegistry":
        """Construct a registry seeded with codecs supported by grpc Python."""

        # //5.- Provide gzip (grpc built-in) and identity for raw payloads.
        registry = cls()
        registry.register("gzip", gzip.decompress)
        registry.register("identity", lambda data: data)
        return registry


class StateStreamReceiver:
    """Decode, buffer, and apply world diffs from the gRPC stream."""

    def __init__(
        self,
        *,
        start_tick: Optional[int] = None,
        codec_registry: Optional[CodecRegistry] = None,
        latency_window: int = 64,
    ) -> None:
        # //6.- Allow callers to override codecs for custom compression schemes.
        self._codecs = codec_registry or CodecRegistry.default()
        # //7.- Track pending diffs by tick for deterministic application order.
        self._pending: MutableMapping[int, DiffPayload] = {}
        self._heap: list[int] = []
        self._expected_tick = start_tick
        # //8.- Preserve recent decompression latency samples for monitoring.
        self._latencies: Deque[float] = deque(maxlen=max(1, latency_window))

    def handle_frame(self, frame: streaming_pb2.StateDiffFrame, apply_diff: ApplyCallback) -> None:
        """Decode *frame* and synchronously apply eligible diffs via *apply_diff*."""

        # //9.- Store the decoded diff and drain in-order ticks after buffering.
        payload = self._decode_frame(frame)
        if frame.tick < 0:
            raise ValueError("tick must be non-negative")
        self._pending[frame.tick] = payload
        heappush(self._heap, frame.tick)
        self._drain_ready(apply_diff)

    def _decode_frame(self, frame: streaming_pb2.StateDiffFrame) -> DiffPayload:
        """Decompress and deserialize the diff payload."""

        # //10.- Time the decompression so callers can inspect latency trends.
        start = time.perf_counter()
        raw = self._codecs.decompress(frame.encoding or "identity", bytes(frame.payload))
        duration = time.perf_counter() - start
        self._latencies.append(duration)

        try:
            # //11.- Parse the JSON payload into a mapping for downstream use.
            return json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError("failed to decode diff payload") from exc

    def _drain_ready(self, apply_diff: ApplyCallback) -> None:
        """Apply buffered diffs once the expected tick is available."""

        # //12.- Initialise the expected tick when the first diff arrives.
        if self._expected_tick is None and self._heap:
            self._expected_tick = self._heap[0]

        while self._heap and self._expected_tick is not None:
            # //13.- Discard stale ticks that were already applied.
            while self._heap and self._heap[0] < self._expected_tick:
                heappop(self._heap)
            if not self._heap:
                break

            next_tick = self._heap[0]
            if next_tick != self._expected_tick:
                # //14.- Wait until the contiguous sequence is complete.
                break

            heappop(self._heap)
            payload = self._pending.pop(next_tick, None)
            if payload is None:
                continue
            apply_diff(next_tick, payload)
            # //15.- Advance the cursor so subsequent ticks follow sequentially.
            self._expected_tick = next_tick + 1

    @property
    def latency_samples(self) -> Tuple[float, ...]:
        """Expose recent decompression durations for diagnostics."""

        # //16.- Return an immutable snapshot so callers cannot mutate internals.
        return tuple(self._latencies)


__all__ = ["CodecRegistry", "StateStreamReceiver", "DiffPayload", "ApplyCallback"]
