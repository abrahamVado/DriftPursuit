import assert from "node:assert";
import { IntentPublisher } from "./intentPublisher";

const frames: string[] = [];
const publisher = new IntentPublisher("pilot-42", (payload) => {
  //1.- Capture outgoing frames to verify the serialized structure.
  frames.push(payload);
});

const first = publisher.publish({
  //2.- Feed intentionally out-of-range values to confirm clamping behaviour.
  throttle: 2,
  brake: -1,
  steer: -2,
  handbrake: true,
  gear: 12,
  boost: false,
});

assert.strictEqual(first.sequence_id, 1, "first frame should increment sequence to 1");
assert.strictEqual(first.throttle, 1, "throttle should be clamped to max value");
assert.strictEqual(first.brake, 0, "brake should be clamped to min value");
assert.strictEqual(first.steer, -1, "steer should be clamped to min value");
assert.strictEqual(first.gear, 9, "gear should be clamped to upper bound");

const encoded = frames.length > 0 ? frames[frames.length - 1] : undefined;
assert.ok(encoded, "an encoded frame should be emitted");
const decoded = JSON.parse(encoded ?? "{}") as Record<string, unknown>;
assert.strictEqual(decoded["controller_id"], "pilot-42", "controller id should be populated in JSON");
assert.strictEqual(decoded["type"], "intent", "payload type should be intent");

publisher.publish({
  //3.- Publish a second frame to ensure the sequence advances and values pass through.
  throttle: -0.5,
  brake: 0.5,
  steer: 0.25,
  handbrake: false,
  gear: -1,
  boost: true,
});

assert.strictEqual(publisher.currentSequence(), 2, "sequence should advance with each publish call");

const last = JSON.parse(frames.length > 0 ? frames[frames.length - 1] : "{}") as Record<string, unknown>;
assert.strictEqual(last["boost"], true, "boost flag should remain true");
assert.strictEqual(last["gear"], -1, "reverse gear should be preserved");
