import assert from "node:assert";
import {
  SnapshotInterpolator,
  SnapshotSample,
} from "./networking/interpolator";

function makeSample(overrides: Partial<SnapshotSample>): SnapshotSample {
  return {
    tickId: 0,
    keyframe: false,
    capturedAtMs: 0,
    position: { x: 0, y: 0, z: 0 },
    orientation: { yawDeg: 0, pitchDeg: 0, rollDeg: 0 },
    ...overrides,
  };
}

//1.- Maintain the playback buffer inside the 100-150ms window under mild jitter.
{
  const interpolator = new SnapshotInterpolator();
  const start = 1_000;
  for (let i = 0; i < 6; i += 1) {
    const captured = start + i * 50;
    const delay = 110 + (i % 2 === 0 ? 10 : 25);
    const received = captured + delay;
    interpolator.enqueue(
      "alpha",
      makeSample({ tickId: i, capturedAtMs: captured }),
      received,
    );
  }
  const buffer = interpolator.getBufferMs();
  assert.ok(buffer >= 100 && buffer <= 150, `buffer out of range: ${buffer}`);
}

//2.- Clamp the buffer at 150ms during aggressive induced packet delay and verify sampling stays behind now.
{
  const interpolator = new SnapshotInterpolator();
  const captured = 5_000;
  interpolator.enqueue(
    "bravo",
    makeSample({ tickId: 10, capturedAtMs: captured }),
    captured + 220,
  );
  interpolator.enqueue(
    "bravo",
    makeSample({ tickId: 11, capturedAtMs: captured + 50 }),
    captured + 280,
  );
  const buffer = interpolator.getBufferMs();
  assert.ok(buffer <= 150, `buffer exceeded clamp: ${buffer}`);

  const now = captured + 400;
  const state = interpolator.sample("bravo", now);
  assert.ok(state, "expected interpolated state under heavy delay");
  const playbackLag = now - (state?.capturedAtMs ?? 0);
  assert.ok(playbackLag >= 100 && playbackLag <= 400, `playback lag ${playbackLag}`);
}

//3.- Snap to keyframes only when the error budget is exceeded.
{
  const interpolator = new SnapshotInterpolator();
  interpolator.enqueue(
    "charlie",
    makeSample({ tickId: 100, capturedAtMs: 10_000 }),
    10_120,
  );
  interpolator.enqueue(
    "charlie",
    makeSample({
      tickId: 101,
      capturedAtMs: 10_050,
      keyframe: true,
      position: { x: 10, y: 0, z: 0 },
    }),
    10_220,
  );
  const snapped = interpolator.sample("charlie", 10_200);
  assert.ok(snapped, "expected keyframe snap state");
  assert.strictEqual(snapped?.position.x, 10, "position should snap to keyframe");
  assert.ok(snapped?.keyframe, "returned state should retain keyframe flag");

  const smoothInterpolator = new SnapshotInterpolator();
  smoothInterpolator.enqueue(
    "delta",
    makeSample({ tickId: 200, capturedAtMs: 20_000 }),
    20_110,
  );
  smoothInterpolator.enqueue(
    "delta",
    makeSample({
      tickId: 201,
      capturedAtMs: 20_050,
      keyframe: true,
      position: { x: 0.5, y: 0, z: 0 },
    }),
    20_160,
  );
  const blended = smoothInterpolator.sample("delta", 20_150);
  assert.ok(blended, "expected interpolated state for small error");
  assert.ok(!blended?.keyframe, "blend should not carry keyframe flag");
  assert.ok((blended?.position.x ?? 0) < 0.5, "blend should remain below keyframe position");
}

//4.- Forgetting an entity should drop cached history and yield undefined samples.
{
  const interpolator = new SnapshotInterpolator();
  interpolator.enqueue(
    "echo",
    makeSample({ tickId: 10, capturedAtMs: 1_000 }),
    1_020,
  );
  interpolator.forget("echo");
  const state = interpolator.sample("echo", 1_100);
  assert.strictEqual(state, undefined, "entity history should be removed after forget");
}
