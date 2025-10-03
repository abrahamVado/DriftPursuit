import assert from "assert";
import { PerformanceMonitor } from "./performanceMonitor";

function simulateFrames(monitor: PerformanceMonitor, frameIntervalMs: number, frames: number): void {
  let timestamp = 0;
  for (let index = 0; index < frames; index += 1) {
    // //1.- Record monotonically increasing timestamps to emulate render frames.
    monitor.record(timestamp);
    timestamp += frameIntervalMs;
  }
}

(function testHighLoadMaintainsTargetFps() {
  const monitor = new PerformanceMonitor(256);
  simulateFrames(monitor, 1000 / 60, 256);
  const snapshot = monitor.snapshot();
  const threshold = 55;
  if (snapshot.averageFps < threshold) {
    throw new Error(`FPS ${snapshot.averageFps.toFixed(2)} below ${threshold}`);
  }
  assert.ok(snapshot.minFps > 0);
  assert.ok(snapshot.maxFps >= snapshot.minFps);
})();

(function testDetectsLowFpsRegression() {
  const monitor = new PerformanceMonitor(180);
  simulateFrames(monitor, 1000 / 20, 180);
  const snapshot = monitor.snapshot();
  // //2.- Ensure the calculated FPS falls below the required minimum under heavy load.
  assert.ok(snapshot.averageFps < 30, `expected fps to drop under stress, got ${snapshot.averageFps}`);
})();
