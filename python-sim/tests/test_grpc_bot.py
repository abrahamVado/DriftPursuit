import gzip
import json

from driftpursuit_proto.generated.driftpursuit.broker.v0 import streaming_pb2

from bots.grpc_bot import GRPCBot, build_intent


class StubbedService:
    def __init__(self, diff_frames=None):
        self.diff_frames = diff_frames or []
        self.intents = []
        self.last_request = None

    def StreamStateDiffs(self, request):
        self.last_request = request
        return iter(self.diff_frames)

    def PublishIntents(self, iterator):
        for frame in iterator:
            self.intents.append(frame)
        return streaming_pb2.IntentStreamAck(accepted=len(self.intents), rejected=0)


def make_bot(stub):
    bot = GRPCBot.__new__(GRPCBot)
    bot._client_id = "bot-test"
    bot._stub = stub
    bot._channel = type("_Ch", (), {"close": lambda self: None})()
    return bot


def test_stream_diffs_decodes_payload():
    payload = json.dumps({"tick": 12}).encode("utf-8")
    frame = streaming_pb2.StateDiffFrame(tick=12, encoding="gzip", payload=gzip.compress(payload))
    stub = StubbedService(diff_frames=[frame])
    bot = make_bot(stub)

    diffs = list(bot.stream_diffs())

    assert stub.last_request.client_id == "bot-test"
    assert diffs == [{"tick": 12}]


def test_publish_intents_compresses_payloads():
    stub = StubbedService()
    bot = make_bot(stub)
    intents = [build_intent("bot-test", 1, throttle=0.5)]

    ack = bot.publish_intents(intents)

    assert ack.accepted == 1
    assert len(stub.intents) == 1
    frame = stub.intents[0]
    assert frame.encoding == "gzip"
    decoded = json.loads(gzip.decompress(frame.payload).decode("utf-8"))
    assert decoded["throttle"] == 0.5
    assert decoded["sequence_id"] == 1
