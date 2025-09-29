import test from 'node:test';
import assert from 'node:assert/strict';

import PlaneStateModule from '../planeState.js';

const { createFollowManager } = PlaneStateModule;

test('keeps manual follow when new telemetry arrives', () => {
  let now = 0;
  const planeLastSeen = new Map();
  const manager = createFollowManager({
    planeLastSeen,
    staleTimeoutMs: 50,
    removalTimeoutMs: 150,
    nowProvider: () => now,
  });

  manager.onPlaneSeen('plane-1', now);
  assert.equal(manager.getFollow(), 'plane-1');

  now += 5;
  manager.setFollow('plane-1');

  now += 5;
  manager.onPlaneSeen('plane-2', now);
  assert.equal(manager.getFollow(), 'plane-1', 'new plane should not override manual selection');
});

test('reports stale planes before removal and eventually prunes them', () => {
  let now = 0;
  const planeLastSeen = new Map();
  const manager = createFollowManager({
    planeLastSeen,
    staleTimeoutMs: 50,
    removalTimeoutMs: 150,
    nowProvider: () => now,
  });

  manager.onPlaneSeen('plane-1', now);
  assert.equal(manager.getFollow(), 'plane-1');

  now = 80;
  const statuses = manager.getPlaneStatuses();
  assert.equal(statuses[0].stale, true, 'plane should be flagged stale before removal');

  const midRemoval = manager.reapStalePlanes();
  assert.deepEqual(midRemoval.removedIds, [], 'stale plane should remain until removal timeout passes');

  now = 180;
  const finalRemoval = manager.reapStalePlanes();
  assert.deepEqual(finalRemoval.removedIds, ['plane-1']);
  assert.equal(manager.getFollow(), null);
});

test('reassigns follow to another active plane when current plane expires', () => {
  let now = 0;
  const planeLastSeen = new Map();
  const manager = createFollowManager({
    planeLastSeen,
    staleTimeoutMs: 50,
    removalTimeoutMs: 150,
    nowProvider: () => now,
  });

  manager.onPlaneSeen('plane-1', now);
  now = 10;
  manager.onPlaneSeen('plane-2', now);
  manager.setFollow('plane-2');
  assert.equal(manager.getFollow(), 'plane-2');

  now = 120;
  manager.onPlaneSeen('plane-1', now);

  now = 200;
  const result = manager.reapStalePlanes();
  assert.deepEqual(result.removedIds, ['plane-2']);
  assert.equal(manager.getFollow(), 'plane-1', 'follow should move to remaining active plane');
});

test('cycles through planes in insertion order and recovers when follow entry is missing', () => {
  let now = 0;
  const planeLastSeen = new Map();
  const manager = createFollowManager({
    planeLastSeen,
    staleTimeoutMs: 50,
    removalTimeoutMs: 150,
    nowProvider: () => now,
  });

  manager.onPlaneSeen('plane-1', now);
  now = 10;
  manager.onPlaneSeen('plane-2', now);

  assert.equal(manager.getFollow(), 'plane-1');

  manager.cycleFollow(1);
  assert.equal(manager.getFollow(), 'plane-2');

  manager.cycleFollow(-1);
  assert.equal(manager.getFollow(), 'plane-1');

  // Simulate losing the tracked plane without informing the manager so it must recover.
  planeLastSeen.delete('plane-1');
  manager.cycleFollow(1);
  assert.equal(manager.getFollow(), 'plane-2');
});
