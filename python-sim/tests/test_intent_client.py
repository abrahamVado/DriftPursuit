import gzip
import json
import pathlib
import sys
from typing import Iterator, List

import pytest

root_dir = pathlib.Path(__file__).resolve().parents[1]
sys.path.append(str(root_dir))
sys.path.append(str(root_dir / "driftpursuit_proto" / "generated"))

from bot_sdk.intent_client import IntentClient
from driftpursuit_proto.generated.driftpursuit.broker.v0 import streaming_pb2


class FakeClock:
    def __init__(self) -> None:
        self.now = 0.0
        self.sleeps: List[float] = []

    def monotonic(self) -> float:
        return self.now

    def sleep(self, duration: float) -> None:
        self.sleeps.append(duration)
        self.now += duration


class FakeStub:
    def __init__(self, clock: FakeClock) -> None:
        self.clock = clock
        self.frames: List[streaming_pb2.IntentFrame] = []

    def PublishIntents(self, iterator: Iterator[streaming_pb2.IntentFrame]) -> streaming_pb2.IntentStreamAck:  # noqa: N802
        for frame in iterator:
            self.frames.append(frame)
        return streaming_pb2.IntentStreamAck(accepted=len(self.frames), rejected=0)


@pytest.fixture()
def fake_clock() -> FakeClock:
    return FakeClock()


def build_intent(sequence: int) -> dict[str, object]:
    return {
        "schema_version": "1",
        "controller_id": "car-1",
        "sequence_id": sequence,
        "throttle": 0.5,
        "brake": 0.0,
        "steer": 0.1,
        "handbrake": False,
        "gear": 1,
        "boost": False,
    }


def test_intent_client_streams_at_rate(fake_clock: FakeClock) -> None:
    stub = FakeStub(fake_clock)
    client = IntentClient(
        "unused:0",
        "car-1",
        rate_hz=10.0,
        stub=stub,
        time_source=fake_clock.monotonic,
        sleeper=fake_clock.sleep,
    )

    client.start()
    for seq in range(1, 4):
        client.send_intent(build_intent(seq))
    ack = client.stop()

    assert ack.accepted == 3
    assert len(stub.frames) == 3

    decoded = [json.loads(gzip.decompress(frame.payload).decode("utf-8")) for frame in stub.frames]
    for index, payload in enumerate(decoded, start=1):
        assert payload["sequence_id"] == index

    metrics = client.loop_metrics()
    assert metrics.interval_samples == 2
    assert pytest.approx(metrics.average_interval, rel=1e-6) == 0.1
    assert pytest.approx(metrics.average_frequency_hz, rel=1e-6) == 10.0

def test_intent_client_rejects_out_of_range_rate() -> None:
    with pytest.raises(ValueError):
        IntentClient("unused:0", "car-1", rate_hz=25.0)
