(function (globalScope, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    globalScope.PlaneState = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  function createFollowManager(options = {}) {
    const planeLastSeen = options.planeLastSeen || new Map();
    const staleTimeoutMs = typeof options.staleTimeoutMs === 'number' ? options.staleTimeoutMs : 5000;
    const removalTimeoutMs = typeof options.removalTimeoutMs === 'number' ? options.removalTimeoutMs : staleTimeoutMs;
    const nowProvider = typeof options.nowProvider === 'function' ? options.nowProvider : () => Date.now();

    let followId = null;

    function ensureFollow(preferredId = null) {
      let changed = false;
      let candidate = preferredId;
      if (candidate && !planeLastSeen.has(candidate)) {
        candidate = null;
      }
      if (candidate && planeLastSeen.has(candidate)) {
        if (followId !== candidate) {
          followId = candidate;
          changed = true;
        }
        return changed;
      }

      if (followId && planeLastSeen.has(followId)) {
        return false;
      }

      const firstEntry = planeLastSeen.keys().next();
      if (!firstEntry.done) {
        const nextId = firstEntry.value;
        if (followId !== nextId) {
          followId = nextId;
          changed = true;
        }
        return changed;
      }

      if (followId !== null) {
        followId = null;
        changed = true;
      }

      return changed;
    }

    function onPlaneSeen(id, timestamp) {
      const seenAt = typeof timestamp === 'number' ? timestamp : nowProvider();
      const previous = planeLastSeen.get(id);
      const isNew = previous === undefined;
      const wasStale = previous !== undefined && (seenAt - previous) > staleTimeoutMs;
      planeLastSeen.set(id, seenAt);
      const preferId = planeLastSeen.size === 1 ? id : null;
      const followChanged = ensureFollow(preferId);
      return {
        isNew,
        followChanged,
        statusChanged: isNew || wasStale,
        followId,
      };
    }

    function reapStalePlanes(currentTime) {
      const now = typeof currentTime === 'number' ? currentTime : nowProvider();
      const removedIds = [];
      for (const [id, last] of planeLastSeen.entries()) {
        if ((now - last) > removalTimeoutMs) {
          planeLastSeen.delete(id);
          removedIds.push(id);
        }
      }

      let followChanged = false;
      if (removedIds.length > 0) {
        followChanged = ensureFollow();
      } else if (!followId || !planeLastSeen.has(followId)) {
        followChanged = ensureFollow();
      }

      return { removedIds, followChanged, followId };
    }

    function setFollow(id) {
      const next = id || null;
      if (next && !planeLastSeen.has(next)) {
        return { followChanged: false, followId };
      }
      const changed = ensureFollow(next);
      return { followChanged: changed, followId };
    }

    function cycleFollow(delta) {
      const ids = Array.from(planeLastSeen.keys());
      if (ids.length === 0) {
        const changed = followId !== null;
        followId = null;
        return { followChanged: changed, followId };
      }

      if (!followId || !planeLastSeen.has(followId)) {
        const changed = ensureFollow();
        return { followChanged: changed, followId };
      }

      if (!delta) {
        return { followChanged: false, followId };
      }

      let index = ids.indexOf(followId);
      if (index === -1) {
        index = 0;
      }
      const length = ids.length;
      let nextIndex = (index + delta) % length;
      if (nextIndex < 0) nextIndex += length;
      const nextId = ids[nextIndex];
      const changed = followId !== nextId;
      followId = nextId;
      return { followChanged: changed, followId };
    }

    function getPlaneStatuses(currentTime) {
      const now = typeof currentTime === 'number' ? currentTime : nowProvider();
      const statuses = [];
      for (const [id, last] of planeLastSeen.entries()) {
        statuses.push({
          id,
          stale: (now - last) > staleTimeoutMs,
          lastSeen: last,
        });
      }
      return statuses;
    }

    function getFollow() {
      if (followId && !planeLastSeen.has(followId)) {
        ensureFollow();
      }
      return followId;
    }

    return {
      onPlaneSeen,
      reapStalePlanes,
      setFollow,
      cycleFollow,
      getPlaneStatuses,
      getFollow,
    };
  }

  return { createFollowManager };
});
