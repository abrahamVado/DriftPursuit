import assert from "node:assert";
import { ClockSynchronizer, TimeSyncUpdate } from "./timeSync";
import { TimeSyncController } from "../../tunnelcave_sandbox_web/src/networking/timeSync";

function makeUpdate(offset: number): TimeSyncUpdate {
  return {
    server_timestamp_ms: Date.now(),
    simulated_timestamp_ms: Date.now(),
    recommended_offset_ms: offset,
  };
}

//1.- Clamp large corrections to the ±50ms envelope and move gradually towards the target offset.
{
  const clock = new ClockSynchronizer();
  clock.ingest(makeUpdate(120), 1_000);
  assert.strictEqual(clock.currentOffset(), 50);
  clock.ingest(makeUpdate(120), 1_100);
  assert.strictEqual(clock.currentOffset(), 100);
}

//2.- Blend smaller adjustments using the smoothing factor to avoid oscillations.
{
  const clock = new ClockSynchronizer();
  clock.ingest(makeUpdate(30), 2_000);
  const offset = clock.currentOffset();
  assert.ok(offset > 0 && offset < 30, `expected blended offset under 30ms, got ${offset}`);
}

//3.- Expose a stable now() helper anchored by the blended offset.
{
  const clock = new ClockSynchronizer();
  clock.ingest(makeUpdate(-40), 3_000);
  const baseline = 10_000;
  const serverNow = clock.now(baseline);
  assert.strictEqual(serverNow, baseline + clock.currentOffset());
  assert.strictEqual(clock.lastUpdateTimestamp(), 3_000);
}

//4.- Verify the web controller filters irrelevant payloads before delegating to the synchroniser.
{
  const controller = new TimeSyncController();
  controller.handleMessage({ type: "different" });
  assert.strictEqual(controller.currentOffset(), 0);
  controller.handleMessage({ type: "time_sync", recommended_offset_ms: 60 }, 4_000);
  assert.strictEqual(controller.currentOffset(), 50);
  const projected = controller.now(7_000);
  assert.strictEqual(projected, 7_000 + controller.currentOffset());
}
