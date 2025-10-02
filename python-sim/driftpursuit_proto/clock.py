"""Client-side helpers for smoothing time synchronisation offsets."""

from __future__ import annotations

import math
import time
from typing import Mapping, MutableMapping, Optional


class ClockSynchronizer:
    """Blend periodic offset updates into a smoothed local clock."""

    def __init__(self, tolerance_ms: float = 50.0, smoothing: float = 0.2) -> None:
        self._offset_ms = 0.0
        self._last_update_ms = 0.0
        self._tolerance_ms = max(0.0, float(tolerance_ms))
        self._smoothing = min(1.0, max(0.0, float(smoothing)))

    def ingest(
        self,
        update: Optional[Mapping[str, float] | MutableMapping[str, float]],
        received_at_ms: Optional[float] = None,
    ) -> None:
        """Apply a server-provided offset update while respecting the configured tolerance."""

        #1.- Validate the payload before blending to avoid propagating malformed data.
        if not update:
            return
        guidance = float(update.get("recommended_offset_ms", 0.0))
        if not math.isfinite(guidance):
            return

        #2.- Clamp large corrections to avoid oscillations while still tracking the server clock.
        delta = guidance - self._offset_ms
        if abs(delta) > self._tolerance_ms:
            self._offset_ms += math.copysign(self._tolerance_ms, delta)
        else:
            self._offset_ms += delta * self._smoothing

        #3.- Record when the correction was applied so callers can detect stale values.
        self._last_update_ms = (
            float(received_at_ms)
            if received_at_ms is not None
            else time.time() * 1000.0
        )

    def current_offset(self) -> float:
        """Expose the blended offset for diagnostics or manual adjustments."""

        return self._offset_ms

    def now(self, source_ms: Optional[float] = None) -> float:
        """Project the authoritative server time based on the smoothed offset."""

        base = float(source_ms) if source_ms is not None else time.time() * 1000.0
        return base + self._offset_ms

    def last_update_timestamp(self) -> float:
        """Return the millisecond timestamp when the last update was applied."""

        return self._last_update_ms
