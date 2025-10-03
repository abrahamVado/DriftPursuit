"""Client-side streaming helpers for publishing intents over gRPC."""

from __future__ import annotations

import gzip
import json
import threading
import time
from collections import deque
from dataclasses import dataclass
from queue import Empty, Queue
from typing import Any, Callable, Deque, Dict, Iterator, Mapping, MutableMapping, Optional, cast

try:  # pragma: no cover - import guard is exercised indirectly via tests
    import grpc
except ModuleNotFoundError as exc:  # pragma: no cover - fallback path for test environments
    grpc = cast(Any, None)  # type: ignore[assignment]
    _grpc_import_error = exc
else:  # pragma: no cover - normal runtime path
    _grpc_import_error = None

from driftpursuit_proto.generated.driftpursuit.broker.v0 import streaming_pb2
from driftpursuit_proto.generated.driftpursuit.broker.v0 import streaming_pb2_grpc


@dataclass
class LoopMetrics:
    """Summarised timing data for the intent publishing loop."""

    interval_samples: int
    last_interval: float
    average_interval: float

    @property
    def average_frequency_hz(self) -> float:
        """Convert the average interval to a sending frequency."""

        if self.average_interval <= 0:
            return 0.0
        return 1.0 / self.average_interval


class IntentClient:
    """Client-side streaming helper that publishes intents at a steady cadence."""

    _MIN_RATE_HZ = 10.0
    _MAX_RATE_HZ = 20.0

    def __init__(
        self,
        address: str,
        client_id: str,
        *,
        rate_hz: float = 10.0,
        channel: Optional[grpc.Channel] = None,
        stub: Optional[streaming_pb2_grpc.BrokerStreamServiceStub] = None,
        time_source: Callable[[], float] | None = None,
        sleeper: Callable[[float], None] | None = None,
    ) -> None:
        if rate_hz < self._MIN_RATE_HZ or rate_hz > self._MAX_RATE_HZ:
            raise ValueError(f"rate_hz must be between {self._MIN_RATE_HZ} and {self._MAX_RATE_HZ}")

        self._client_id = client_id
        self._interval = 1.0 / rate_hz
        self._time = time_source or time.monotonic
        self._sleep = sleeper or time.sleep
        self._queue: "Queue[Optional[MutableMapping[str, object]]]" = Queue()
        self._stop_event = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._ack: Optional[streaming_pb2.IntentStreamAck] = None
        self._ack_error: Optional[BaseException] = None
        self._channel: Optional[grpc.Channel] = channel
        if stub is not None:
            # //2.- Tests can inject a fake stub to avoid depending on the grpc package.
            self._stub = stub
            self._created_channel = False
        else:
            if grpc is None:
                raise ModuleNotFoundError("grpc is required when no stub is provided") from _grpc_import_error
            if self._channel is None:
                self._channel = grpc.insecure_channel(address)
                self._created_channel = True
            else:
                self._created_channel = False
            self._stub = streaming_pb2_grpc.BrokerStreamServiceStub(self._channel)
        self._metrics_lock = threading.Lock()
        self._last_send_ts: Optional[float] = None
        self._intervals: Deque[float] = deque(maxlen=256)

    def start(self) -> None:
        """Begin the background streaming loop if it is not already running."""

        if self._thread and self._thread.is_alive():
            # //1.- Avoid spawning duplicate workers when start() is called repeatedly.
            return
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run_stream, name="intent-stream", daemon=True)
        self._thread.start()

    def stop(self) -> streaming_pb2.IntentStreamAck:
        """Signal the streaming loop to finish and return the final acknowledgement."""

        self._stop_event.set()
        # //2.- Push a sentinel so the iterator can exit once the queue drains.
        self._queue.put(None)
        if self._thread:
            self._thread.join()
        if self._ack_error is not None:
            raise RuntimeError("intent stream failed") from self._ack_error
        if self._ack is None:
            raise RuntimeError("intent stream did not produce an acknowledgement")
        return self._ack

    def close(self) -> None:
        """Stop the stream (if needed) and dispose the underlying channel."""

        if self._thread and self._thread.is_alive():
            try:
                self.stop()
            except RuntimeError:
                # //3.- Ignore errors during shutdown because the caller is closing anyway.
                pass
        if self._created_channel and self._channel is not None:
            self._channel.close()

    def send_intent(self, intent: Mapping[str, object]) -> None:
        """Queue a new intent payload to be published on the gRPC stream."""

        # //1.- Copy into a mutable mapping so callers can reuse their dictionaries safely.
        payload: Dict[str, object] = dict(intent)
        self._queue.put(payload)

    def loop_metrics(self) -> LoopMetrics:
        """Return timing information about the most recent publishing intervals."""

        with self._metrics_lock:
            last_interval = self._intervals[-1] if self._intervals else 0.0
            avg = sum(self._intervals) / len(self._intervals) if self._intervals else 0.0
            samples = len(self._intervals)
        return LoopMetrics(interval_samples=samples, last_interval=last_interval, average_interval=avg)

    def _run_stream(self) -> None:
        try:
            # //4.- Drive the gRPC client-side streaming call until the server closes it.
            ack = self._stub.PublishIntents(self._frame_iterator())
            self._ack = ack
        except BaseException as exc:  # pylint: disable=broad-except
            # //5.- Surface any unexpected failure so stop() can re-raise it.
            self._ack_error = exc

    def _frame_iterator(self) -> Iterator[streaming_pb2.IntentFrame]:
        next_deadline = self._time()
        compressor_name = "gzip"
        while True:
            if self._stop_event.is_set() and self._queue.empty():
                # //1.- Drain gracefully once shutdown has been requested and the queue is empty.
                return
            try:
                # //2.- Wait briefly for new payloads so we can notice cancellation promptly.
                item = self._queue.get(timeout=0.1)
            except Empty:
                continue
            if item is None:
                return
            now = self._time()
            if now < next_deadline:
                # //3.- Align the send cadence by sleeping until the scheduled deadline.
                self._sleep(next_deadline - now)
                now = self._time()
            # //4.- Serialize the JSON payload once the cadence delay has elapsed.
            payload = json.dumps(item).encode("utf-8")
            compressed = gzip.compress(payload)
            frame = streaming_pb2.IntentFrame(client_id=self._client_id, encoding=compressor_name, payload=compressed)
            yield frame
            sent_at = self._time()
            self._record_interval(sent_at)
            # //5.- Advance the schedule so the next frame respects the requested frequency.
            next_deadline = max(next_deadline + self._interval, sent_at)

    def _record_interval(self, timestamp: float) -> None:
        with self._metrics_lock:
            if self._last_send_ts is not None:
                self._intervals.append(timestamp - self._last_send_ts)
            self._last_send_ts = timestamp


__all__ = ["IntentClient", "LoopMetrics"]
