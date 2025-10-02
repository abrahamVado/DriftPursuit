export type EventKind = "combat" | "radar" | "respawn" | "lifecycle";

export interface EventEnvelope {
  sequence: number;
  kind: EventKind;
  payload: unknown;
}

export interface EventTransport {
  //1.- Transport abstracts the outbound acknowledgement channel (e.g. WebSocket).
  send(data: string): void;
}

export interface EventStoreSnapshot {
  lastAck: number;
  backlog: EventEnvelope[];
}

export interface EventStore {
  //2.- Persist the acknowledgement cursor and backlog for reconnect safety.
  load(subscriberId: string): EventStoreSnapshot | undefined;
  persist(subscriberId: string, snapshot: EventStoreSnapshot): void;
}

export class MemoryEventStore implements EventStore {
  private readonly snapshots = new Map<string, EventStoreSnapshot>();

  load(subscriberId: string): EventStoreSnapshot | undefined {
    //3.- Return a deep copy so callers cannot mutate the stored state.
    const snapshot = this.snapshots.get(subscriberId);
    if (!snapshot) {
      return undefined;
    }
    return {
      lastAck: snapshot.lastAck,
      backlog: snapshot.backlog.map((event) => ({ ...event })),
    };
  }

  persist(subscriberId: string, snapshot: EventStoreSnapshot): void {
    this.snapshots.set(subscriberId, {
      lastAck: snapshot.lastAck,
      backlog: snapshot.backlog.map((event) => ({ ...event })),
    });
  }
}

export interface AckMessage {
  type: "event_ack";
  subscriber: string;
  sequence: number;
}

export class EventStreamClient {
  private backlog: EventEnvelope[] = [];
  private lastAck = 0;

  constructor(
    private readonly subscriberId: string,
    private readonly transport: EventTransport,
    private readonly store: EventStore = new MemoryEventStore(),
  ) {
    //4.- Restore persisted state on construction so reconnects resume seamlessly.
    const snapshot = this.store.load(subscriberId);
    if (snapshot) {
      this.lastAck = snapshot.lastAck;
      this.backlog = snapshot.backlog.map((event) => ({ ...event }));
    }
  }

  ingest(events: EventEnvelope[]): void {
    //5.- Normalise and append events while preserving strict ordering guarantees.
    const filtered = events
      .filter((event) => event.sequence > this.lastAck)
      .sort((a, b) => a.sequence - b.sequence);
    if (filtered.length === 0) {
      return;
    }
    const expected = this.backlog.length > 0 ? this.backlog[this.backlog.length - 1].sequence : this.lastAck;
    filtered.forEach((event, index) => {
      const nextSequence = expected + index + 1;
      if (event.sequence !== nextSequence) {
        throw new Error(`event gap detected: expected ${nextSequence}, received ${event.sequence}`);
      }
    });
    this.backlog.push(...filtered.map((event) => ({ ...event })));
    this.store.persist(this.subscriberId, { lastAck: this.lastAck, backlog: this.backlog });
  }

  nextPending(): EventEnvelope | undefined {
    //6.- Provide the next event without removing it so callers can retry on failures.
    return this.backlog[0];
  }

  ackLatest(): void {
    //7.- Pop the head of the backlog and send an acknowledgement frame.
    const event = this.backlog.shift();
    if (!event) {
      return;
    }
    this.lastAck = event.sequence;
    const message: AckMessage = {
      type: "event_ack",
      subscriber: this.subscriberId,
      sequence: this.lastAck,
    };
    this.transport.send(JSON.stringify(message));
    this.store.persist(this.subscriberId, { lastAck: this.lastAck, backlog: this.backlog });
  }

  snapshot(): EventStoreSnapshot {
    //8.- Expose a shallow copy for diagnostic inspection in tests.
    return {
      lastAck: this.lastAck,
      backlog: this.backlog.map((event) => ({ ...event })),
    };
  }
}
