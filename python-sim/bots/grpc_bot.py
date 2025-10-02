"""Sample gRPC bot showcasing diff subscription and intent publishing."""

"""Sample gRPC bot showcasing diff subscription and intent publishing."""

import gzip
import json
from typing import Iterable, Iterator, List, Mapping

import grpc

from driftpursuit_proto.generated.driftpursuit.broker.v0 import streaming_pb2
from driftpursuit_proto.generated.driftpursuit.broker.v0 import streaming_pb2_grpc


class GRPCBot:
    """Simple gRPC client that mirrors the websocket behaviour for bots."""

    def __init__(self, address: str, client_id: str):
        # //1.- Establish the gRPC channel and typed stub once during construction.
        self._address = address
        self._client_id = client_id
        self._channel = grpc.insecure_channel(address)
        self._stub = streaming_pb2_grpc.BrokerStreamServiceStub(self._channel)

    def close(self) -> None:
        """Close the underlying channel when the bot shuts down."""

        # //2.- Explicitly close the gRPC channel to release sockets promptly.
        self._channel.close()

    def stream_diffs(self) -> Iterator[Mapping[str, object]]:
        """Yield decompressed world diffs from the broker."""

        # //3.- Subscribe to the diff stream using the generated stub.
        request = streaming_pb2.StreamStateDiffsRequest(client_id=self._client_id)
        for frame in self._stub.StreamStateDiffs(request):
            if frame.encoding != "gzip":
                raise ValueError(f"unsupported encoding {frame.encoding!r}")
            # //4.- Decompress the JSON payload and decode it into a dictionary.
            payload = gzip.decompress(frame.payload).decode("utf-8")
            yield json.loads(payload)

    def publish_intents(self, intents: Iterable[Mapping[str, object]]) -> streaming_pb2.IntentStreamAck:
        """Compress and publish a sequence of intent payloads."""

        # //5.- Wrap the iterable in a generator so gRPC can lazily consume frames.
        def frame_iterator() -> Iterator[streaming_pb2.IntentFrame]:
            for intent in intents:
                raw = json.dumps(intent).encode("utf-8")
                compressed = gzip.compress(raw)
                # //6.- Yield each compressed frame with metadata for the broker.
                yield streaming_pb2.IntentFrame(
                    client_id=self._client_id,
                    encoding="gzip",
                    payload=compressed,
                )

        # //7.- Send the streaming RPC and wait for the aggregated acknowledgement.
        return self._stub.PublishIntents(frame_iterator())

    @staticmethod
    def decode_diff(frame: streaming_pb2.StateDiffFrame) -> Mapping[str, object]:
        """Helper that mirrors the streaming logic for unit tests."""

        if frame.encoding != "gzip":
            raise ValueError(f"unsupported encoding {frame.encoding!r}")
        payload = gzip.decompress(frame.payload).decode("utf-8")
        return json.loads(payload)


def build_intent(client_id: str, sequence: int, throttle: float = 0.0) -> Mapping[str, object]:
    """Construct an intent payload compatible with the broker's schema."""

    # //8.- Provide a convenience builder for tests and demonstrations.
    return {
        "schema_version": "1",
        "controller_id": client_id,
        "sequence_id": sequence,
        "throttle": throttle,
        "brake": 0.0,
        "steer": 0.0,
        "handbrake": False,
        "gear": 1,
        "boost": False,
    }


__all__: List[str] = ["GRPCBot", "build_intent"]
