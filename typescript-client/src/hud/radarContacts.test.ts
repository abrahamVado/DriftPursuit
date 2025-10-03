import { RadarContactTracker } from "./radarContacts";

type Assertion = () => void;

function vector(x: number, y: number, z: number) {
  return { x, y, z };
}

function expect(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function expectAlmost(actual: number, expected: number, epsilon: number, message: string): void {
  if (Math.abs(actual - expected) > epsilon) {
    throw new Error(`${message}: expected ${expected} received ${actual}`);
  }
}

function runVisibilityLifecycleTest(): void {
  //1.- Confirm visible contacts flow into the HUD snapshot with stable styling metadata.
  const tracker = new RadarContactTracker(500);
  tracker.ingest(
    {
      sourceEntityId: "observer",
      entries: [
        {
          targetEntityId: "target",
          position: vector(100, 0, 0),
          velocity: vector(10, 0, 0),
          confidence: 1,
          occluded: false,
        },
      ],
    },
    0,
  );
  let snapshot = tracker.snapshot(0);
  expect(snapshot.visible.length === 1, "expected one visible contact");
  const visible = snapshot.visible[0];
  expect(visible.state === "visible", "expected contact state to be visible");
  expect(visible.fadeAlpha === 1, "expected visible contact to be fully opaque");
  expect(visible.dashed === false, "expected solid styling for active contacts");
  expect(visible.timelineLabel === "0.0s", "expected live contacts to show zero delay");
  expect(visible.position?.x === 100, "expected position to match last ping");

  //2.- When the contact becomes occluded the tracker should retain the last known data and update styling.
  tracker.ingest(
    {
      sourceEntityId: "observer",
      entries: [
        {
          targetEntityId: "target",
          occluded: true,
          confidence: 0.5,
        },
      ],
    },
    100,
  );
  snapshot = tracker.snapshot(200);
  expect(snapshot.visible.length === 0, "expected contact to move into last known bucket");
  expect(snapshot.lastKnown.length === 1, "expected retained last known contact");
  const lastKnown = snapshot.lastKnown[0];
  expect(lastKnown.state === "occluded", "expected occluded contact state");
  expectAlmost(lastKnown.fadeAlpha, 0.6, 0.001, "expected fade alpha to decay with age");
  expect(lastKnown.dashed === false, "expected dashed styling to wait for 2 seconds");
  expect(lastKnown.timelineLabel === "0.1s" || lastKnown.timelineLabel === "0.2s", "expected occlusion timer to advance");
  expect(lastKnown.position?.x === 100, "expected last known position to remain frozen");
  expect(lastKnown.confidence === 0.5, "expected occlusion confidence to match payload");

  //3.- Contacts should expire after the retention window to avoid stale HUD markers.
  snapshot = tracker.snapshot(600);
  expect(snapshot.lastKnown.length === 0, "expected last known contact to expire after retention");
}

function runTimelineTransitionsTest(): void {
  //4.- Validate that dashed styling begins after two seconds and resets on reacquisition.
  const tracker = new RadarContactTracker(5000);
  tracker.ingest(
    {
      sourceEntityId: "observer",
      entries: [
        {
          targetEntityId: "bandit",
          position: vector(0, 0, 0),
          velocity: vector(0, 5, 0),
          confidence: 1,
          occluded: false,
        },
      ],
    },
    0,
  );
  tracker.ingest(
    {
      sourceEntityId: "observer",
      entries: [
        {
          targetEntityId: "bandit",
          occluded: true,
        },
      ],
    },
    100,
  );
  let snapshot = tracker.snapshot(2100);
  expect(snapshot.lastKnown.length === 1, "expected bandit to remain tracked while occluded");
  const occluded = snapshot.lastKnown[0];
  expect(occluded.dashed === true, "expected dashed styling after two seconds of occlusion");
  expect(occluded.timelineLabel === "2.0s" || occluded.timelineLabel === "2.1s", "expected occlusion timer label");
  expectAlmost(occluded.fadeAlpha, 0.58, 0.05, "expected fade alpha to decay proportionally");

  tracker.ingest(
    {
      sourceEntityId: "observer",
      entries: [
        {
          targetEntityId: "bandit",
          position: vector(5, 0, 0),
          velocity: vector(0, 5, 0),
          occluded: false,
        },
      ],
    },
    2300,
  );
  snapshot = tracker.snapshot(2300);
  expect(snapshot.visible.length === 1, "expected bandit to return to visible list");
  const reacquired = snapshot.visible[0];
  expect(reacquired.dashed === false, "expected dashed styling to reset after reacquisition");
  expect(reacquired.fadeAlpha === 1, "expected fade alpha reset for visible contact");
  expect(reacquired.timelineLabel === "0.0s", "expected timeline label reset after reacquisition");
}

function runGhostTrailTest(): void {
  //5.- Ensure ghost trails extrapolate the cached velocity for one second of breadcrumbs.
  const tracker = new RadarContactTracker(4000);
  tracker.ingest(
    {
      sourceEntityId: "observer",
      entries: [
        {
          targetEntityId: "phantom",
          position: vector(50, 50, 0),
          velocity: vector(-20, 0, 0),
          occluded: false,
        },
      ],
    },
    0,
  );
  tracker.ingest(
    {
      sourceEntityId: "observer",
      entries: [
        {
          targetEntityId: "phantom",
          occluded: true,
        },
      ],
    },
    50,
  );
  const snapshot = tracker.snapshot(300);
  const phantom = snapshot.lastKnown[0];
  expect(Array.isArray(phantom.ghostTrail), "expected ghost trail array");
  expect(phantom.ghostTrail !== undefined, "expected ghost trail to be defined");
  expect(phantom.ghostTrail!.length === 5, "expected five breadcrumb samples");
  const first = phantom.ghostTrail![0];
  expect(first.offsetMs === 0, "expected first breadcrumb at zero offset");
  expectAlmost(first.position.x, 50, 0.001, "expected starting point to match last known position");
  const last = phantom.ghostTrail![phantom.ghostTrail!.length - 1];
  expect(last.offsetMs === 1000, "expected final breadcrumb one second back");
  expectAlmost(last.position.x, 70, 0.01, "expected ghost trail to extrapolate backwards along velocity");
}

const tests: Assertion[] = [runVisibilityLifecycleTest, runTimelineTransitionsTest, runGhostTrailTest];

for (const test of tests) {
  //6.- Execute each scenario eagerly so CI fails fast with clear context.
  test();
}
