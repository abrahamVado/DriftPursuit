import { strict as assert } from "node:assert";

import { CombatEvent, CombatEventKind, DamageSummary } from "./generated/events";
import { Vector3 } from "./generated/types";

(() => {
  //1.- Construct a combat event with nested damage and spatial details.
  const event: CombatEvent = {
    schemaVersion: "0.2.0",
    eventId: "evt-007",
    occurredAtMs: 987654321,
    kind: CombatEventKind.COMBAT_EVENT_KIND_DIRECT_HIT,
    attackerEntityId: "attacker-01",
    defenderEntityId: "defender-02",
    position: { x: 1.1, y: 2.2, z: 3.3 } as Vector3,
    direction: { x: 0.0, y: 0.5, z: 1.0 } as Vector3,
    damage: { amount: 75.5, type: "laser", critical: true } as DamageSummary,
    metadata: { weapon: "beam", range: "close" },
  };

  //2.- Encode and decode using the generated helpers to simulate broker round-trip.
  const encoded = CombatEvent.encode(event).finish();
  const decoded = CombatEvent.decode(encoded);

  //3.- Verify the structured data survives the binary round-trip intact.
  assert.equal(decoded.kind, CombatEventKind.COMBAT_EVENT_KIND_DIRECT_HIT);
  assert.equal(decoded.damage?.critical, true);
  assert.equal(decoded.metadata["weapon"], "beam");
  assert.equal(decoded.position?.z, 3.3);
})();
