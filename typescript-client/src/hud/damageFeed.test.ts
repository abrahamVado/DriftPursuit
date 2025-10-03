import { strict as assert } from "node:assert";

import { extractDamageBreakdown, formatDamageSummary } from "./damageFeed";

(() => {
  //1.- Provide metadata resembling the broker payload to exercise extraction and formatting.
  const metadata = {
    damage_direct: "150.50",
    damage_splash: "25.25",
    damage_collision: "10.00",
    damage_total: "185.75",
    damage_instant_kill: "true",
  } as Record<string, string>;

  const breakdown = extractDamageBreakdown(metadata);
  assert.equal(breakdown.length, 3);
  assert.equal(breakdown[0].source, "direct");
  assert.ok(breakdown[0].amount > breakdown[1].amount);

  const summary = formatDamageSummary(metadata);
  assert.deepEqual(summary[0], "Total 185.75");
  assert.ok(summary.includes("INSTANT KILL"));
  assert.ok(summary.some((line) => line.startsWith("DIRECT")));
})();
