import { RadarContactTracker } from "./radarContacts";

function vector(x: number, y: number, z: number) {
  return { x, y, z };
}

function expect(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

//1.- Visible contacts should be surfaced immediately with full fidelity.
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
expect(snapshot.lastKnown.length === 0, "expected no last known contacts yet");
expect(snapshot.visible[0].position?.x === 100, "expected position to match last ping");

//2.- When the contact becomes occluded the tracker should retain the last known data.
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
expect(snapshot.lastKnown[0].position?.x === 100, "expected last known position to remain frozen");
expect(snapshot.lastKnown[0].confidence === 0.5, "expected occlusion confidence to match payload");

//3.- Contacts should expire after the retention window to avoid stale HUD markers.
snapshot = tracker.snapshot(600);
expect(snapshot.lastKnown.length === 0, "expected last known contact to expire after retention");

//4.- Occluded contacts without prior visibility should be ignored.
tracker.ingest(
  {
    sourceEntityId: "observer",
    entries: [
      {
        targetEntityId: "ghost",
        occluded: true,
      },
    ],
  },
  700,
);
snapshot = tracker.snapshot(700);
expect(snapshot.visible.length === 0, "occluded ghost should not create visible contact");
expect(snapshot.lastKnown.length === 0, "occluded ghost should not create last known contact");

