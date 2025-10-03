import { HudRadarContact, RadarContactTracker } from "./radarContacts";

type Assertion = () => void;

function vector(x: number, y: number, z: number) {
  return { x, y, z };
}

function expect(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function formatContact(contactLabel: string, contact: HudRadarContact | undefined): string {
  //1.- Present a compact summary of contact state so QA can validate the simulation quickly.
  if (!contact) {
    return `${contactLabel}: missing`;
  }
  const position = contact.position
    ? `(${contact.position.x.toFixed(1)}, ${contact.position.y.toFixed(1)}, ${contact.position.z.toFixed(1)})`
    : "(n/a)";
  return `${contactLabel}: state=${contact.state} occluded=${contact.occluded} confidence=${contact.confidence.toFixed(
    2,
  )} alpha=${contact.fadeAlpha.toFixed(2)} timeline=${contact.timelineLabel} position=${position}`;
}

function runOcclusionSimulation(): void {
  //1.- Initialise a tracker with a short retention window to keep the scenario focused.
  const tracker = new RadarContactTracker(4000);

  //2.- Seed the tracker with a visible target that reports both position and velocity data.
  tracker.ingest(
    {
      sourceEntityId: "observer",
      entries: [
        {
          targetEntityId: "bandit-1",
          position: vector(250, 5, 0),
          velocity: vector(-15, 0, 0),
          confidence: 0.9,
          occluded: false,
        },
      ],
    },
    0,
  );
  const atSpawn = tracker.snapshot(0);
  const visible = atSpawn.visible[0];
  console.log(formatContact("QA_LOG_VISIBLE", visible));
  expect(visible.state === "visible", "expected initial contact to be visible");
  expect(visible.fadeAlpha === 1, "expected no fade for active contact");

  //3.- Transition the contact into an occluded state without a fresh position update.
  tracker.ingest(
    {
      sourceEntityId: "observer",
      entries: [
        {
          targetEntityId: "bandit-1",
          occluded: true,
        },
      ],
    },
    200,
  );

  //4.- Advance the clock to inspect the last known snapshot and verify visual decay.
  const occludedSnapshot = tracker.snapshot(950);
  expect(occludedSnapshot.visible.length === 0, "expected visible list to be empty after occlusion");
  expect(occludedSnapshot.lastKnown.length === 1, "expected last-known list to track occluded target");
  const occluded = occludedSnapshot.lastKnown[0];
  console.log(formatContact("QA_LOG_OCCLUDED", occluded));
  expect(occluded.state === "occluded", "expected state to flip to occluded");
  expect(occluded.dashed === false, "expected dashed styling to wait until two seconds");
  expect(occluded.position?.x === 250, "expected last known position to remain intact");
  expect(occluded.timelineLabel === "0.7s" || occluded.timelineLabel === "0.8s", "expected occlusion timer to increase");
  expect(occluded.fadeAlpha < 1 && occluded.fadeAlpha > 0.4, "expected fade alpha to decay gradually");

  //5.- Continue advancing so the dashed styling threshold is crossed for QA verification.
  const dashedSnapshot = tracker.snapshot(2300);
  expect(dashedSnapshot.lastKnown.length === 1, "expected occluded target to persist until reacquisition");
  const dashedContact = dashedSnapshot.lastKnown[0];
  console.log(formatContact("QA_LOG_DASHED", dashedContact));
  expect(dashedContact.dashed === true, "expected dashed styling after two seconds");
  expect(dashedContact.fadeAlpha < occluded.fadeAlpha, "expected continued fade decay while occluded");

  //6.- Re-acquire the contact with a visible update and confirm the visuals reset.
  tracker.ingest(
    {
      sourceEntityId: "observer",
      entries: [
        {
          targetEntityId: "bandit-1",
          position: vector(200, 5, 0),
          velocity: vector(-12, 0, 0),
          occluded: false,
        },
      ],
    },
    2350,
  );
  const reacquiredSnapshot = tracker.snapshot(2350);
  expect(reacquiredSnapshot.visible.length === 1, "expected visible contact when reacquired");
  const reacquired = reacquiredSnapshot.visible[0];
  console.log(formatContact("QA_LOG_REACQUIRED", reacquired));
  expect(reacquired.state === "visible", "expected contact to return to visible");
  expect(reacquired.timelineLabel === "0.0s", "expected timeline reset on reacquisition");
}

const tests: Assertion[] = [runOcclusionSimulation];

for (const test of tests) {
  //2.- Execute the occlusion simulation to provide QA logs alongside assertions.
  test();
}
