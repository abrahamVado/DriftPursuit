"""Tests for the bot-side reliable event stream helper."""

from __future__ import annotations

import json
from typing import List

from bots.event_stream import EventEnvelope, EventStreamClient, EventStreamState, MemoryEventStore


class StubTransport:
    """Capture outbound acknowledgements for assertions."""

    def __init__(self) -> None:
        self.sent: List[str] = []

    def send(self, payload: str) -> None:
        self.sent.append(payload)


def test_acknowledgement_flow() -> None:
    """Events should be acknowledged sequentially."""

    #1.- Build the client with an empty store and inject two events.
    transport = StubTransport()
    store = MemoryEventStore()
    client = EventStreamClient("alpha", transport, store)
    client.ingest([EventEnvelope(1, "combat", {}), EventEnvelope(2, "radar", {})])

    pending = client.next_pending()
    assert pending is not None and pending.sequence == 1

    client.ack_next()
    client.ack_next()

    assert len(transport.sent) == 2
    assert json.loads(transport.sent[-1])["sequence"] == 2
    assert client.state.backlog == []


def test_state_restoration() -> None:
    """Persisted backlog should be replayed on a new client instance."""

    #2.- Prime the store with an existing backlog snapshot.
    store = MemoryEventStore()
    store.persist("bravo", EventStreamState(last_ack=2, backlog=[EventEnvelope(3, "respawn", {})]))

    transport = StubTransport()
    client = EventStreamClient("bravo", transport, store)

    pending = client.next_pending()
    assert pending is not None and pending.sequence == 3

    client.ack_next()
    assert json.loads(transport.sent[-1])["sequence"] == 3


def test_detects_gaps() -> None:
    """Missing events should surface as ValueError to request a replay."""

    transport = StubTransport()
    client = EventStreamClient("charlie", transport)

    try:
        client.ingest([EventEnvelope(5, "lifecycle", {})])
    except ValueError as exc:  # pragma: no cover - exact message asserted below
        assert "event gap detected" in str(exc)
    else:  # pragma: no cover
        raise AssertionError("expected a gap detection error")
