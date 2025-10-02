"""In-memory acknowledgement tracker for reliable gameplay event delivery."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Iterable, List, Protocol


class EventTransport(Protocol):
    """Protocol describing the outbound acknowledgement sink."""

    def send(self, payload: str) -> None:
        """Send an encoded acknowledgement frame."""


@dataclass
class EventEnvelope:
    """Mutable representation of an inbound gameplay event."""

    sequence: int
    kind: str
    payload: object


@dataclass
class EventStreamState:
    """Persisted cursor and backlog used to resume on reconnect."""

    last_ack: int = 0
    backlog: List[EventEnvelope] = field(default_factory=list)


class EventStore(Protocol):
    """Storage abstraction for persisting stream checkpoints."""

    def load(self, subscriber: str) -> EventStreamState | None:
        """Load the previously persisted state for the subscriber."""

    def persist(self, subscriber: str, state: EventStreamState) -> None:
        """Persist the latest acknowledgement cursor and backlog."""


class MemoryEventStore:
    """Simple dictionary-backed store suitable for tests."""

    def __init__(self) -> None:
        self._snapshots: dict[str, EventStreamState] = {}

    def load(self, subscriber: str) -> EventStreamState | None:
        #1.- Return a defensive copy so callers cannot mutate the stored instance.
        snapshot = self._snapshots.get(subscriber)
        if snapshot is None:
            return None
        return EventStreamState(snapshot.last_ack, [EventEnvelope(e.sequence, e.kind, e.payload) for e in snapshot.backlog])

    def persist(self, subscriber: str, state: EventStreamState) -> None:
        #2.- Clone the incoming state to decouple the store from caller mutations.
        clone = EventStreamState(state.last_ack, [EventEnvelope(e.sequence, e.kind, e.payload) for e in state.backlog])
        self._snapshots[subscriber] = clone


class EventStreamClient:
    """Client side buffer that enforces ordered acknowledgements."""

    def __init__(self, subscriber: str, transport: EventTransport, store: EventStore | None = None) -> None:
        #3.- Load the persisted state on construction so reconnects resume immediately.
        self._subscriber = subscriber
        self._transport = transport
        self._store = store or MemoryEventStore()
        snapshot = self._store.load(subscriber)
        if snapshot:
            self._last_ack = snapshot.last_ack
            self._backlog = snapshot.backlog
        else:
            self._last_ack = 0
            self._backlog: List[EventEnvelope] = []

    def ingest(self, events: Iterable[EventEnvelope]) -> None:
        #4.- Append strictly ordered events and raise on sequence gaps.
        for event in events:
            if event.sequence <= self._last_ack:
                continue
            expected = self._backlog[-1].sequence + 1 if self._backlog else self._last_ack + 1
            if event.sequence != expected:
                raise ValueError(f"event gap detected: expected {expected}, received {event.sequence}")
            self._backlog.append(EventEnvelope(event.sequence, event.kind, event.payload))
        self._store.persist(self._subscriber, EventStreamState(self._last_ack, list(self._backlog)))

    def next_pending(self) -> EventEnvelope | None:
        #5.- Expose the next unacknowledged event without mutating the queue.
        return self._backlog[0] if self._backlog else None

    def ack_next(self) -> None:
        #6.- Pop the head event, notify the transport, and persist the cursor.
        if not self._backlog:
            return
        event = self._backlog.pop(0)
        self._last_ack = event.sequence
        frame = {
            "type": "event_ack",
            "subscriber": self._subscriber,
            "sequence": self._last_ack,
        }
        self._transport.send(json.dumps(frame))
        self._store.persist(self._subscriber, EventStreamState(self._last_ack, list(self._backlog)))

    @property
    def state(self) -> EventStreamState:
        #7.- Provide a snapshot for diagnostics and tests.
        return EventStreamState(self._last_ack, list(self._backlog))
