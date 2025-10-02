import assert from "node:assert";
import { EventEnvelope, EventStreamClient, MemoryEventStore } from "./eventStream";

(async () => {
  //1.- Capture outbound acknowledgements for verification.
  const sent: string[] = [];
  const transport = { send: (data: string) => sent.push(data) };
  const store = new MemoryEventStore();
  const client = new EventStreamClient("alpha", transport, store);

  const events: EventEnvelope[] = [
    { sequence: 1, kind: "combat", payload: { id: "evt-1" } },
    { sequence: 2, kind: "radar", payload: { id: "evt-2" } },
  ];

  client.ingest(events);
  assert.deepStrictEqual(client.nextPending(), events[0]);

  client.ackLatest();
  client.ackLatest();

  assert.deepStrictEqual(sent, [
    JSON.stringify({ type: "event_ack", subscriber: "alpha", sequence: 1 }),
    JSON.stringify({ type: "event_ack", subscriber: "alpha", sequence: 2 }),
  ]);
  assert.strictEqual(client.snapshot().backlog.length, 0);

  //2.- Persist a backlog and confirm the reconstructed client replays it.
  const persisted = new MemoryEventStore();
  const seedEvents: EventEnvelope[] = [
    { sequence: 3, kind: "respawn", payload: { id: "evt-3" } },
  ];
  persisted.persist("bravo", { lastAck: 2, backlog: seedEvents });

  const replaySent: string[] = [];
  const replayClient = new EventStreamClient("bravo", { send: (data: string) => replaySent.push(data) }, persisted);
  assert.deepStrictEqual(replayClient.nextPending(), seedEvents[0]);
  replayClient.ackLatest();
  assert.deepStrictEqual(replaySent, [
    JSON.stringify({ type: "event_ack", subscriber: "bravo", sequence: 3 }),
  ]);
  assert.strictEqual(replayClient.snapshot().lastAck, 3);

  //3.- Detect missing events so the caller can trigger a replay request.
  const gapClient = new EventStreamClient("charlie", { send: () => undefined });
  assert.throws(
    () =>
      gapClient.ingest([
        { sequence: 2, kind: "lifecycle", payload: {} },
      ]),
    /event gap detected/,
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
