"""Base runtime for FSM-driven intent bots."""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Callable, Mapping

from ._sdk import IntentClient
from .fsm_base import FSMContext, FiniteStateMachine, IntentPayload
from .match_metrics import MatchMetrics
from .world_state import WorldStateCache


@dataclass
class RuntimeToggles:
    """Feature switches that can be exposed on the CLI."""

    allow_boost: bool = False
    allow_handbrake: bool = False


class FSMIntentBot:
    """Glue between the shared IntentClient and an FSM policy."""

    def __init__(
        self,
        client: IntentClient,
        machine: FiniteStateMachine,
        controller_id: str,
        *,
        toggles: RuntimeToggles | None = None,
        auto_start: bool = True,
        planning_frequency_hz: float | None = None,
        metrics: MatchMetrics | None = None,
        world_state: WorldStateCache | None = None,
        time_source: Callable[[], float] | None = None,
    ) -> None:
        # //1.- Store collaborators so the bot can forward intents on every tick.
        self._client = client
        self._machine = machine
        self._controller_id = controller_id
        self._context = FSMContext(config=toggles or RuntimeToggles())
        # //2.- Track the cached world state so diffs can be applied efficiently.
        self._world = world_state or WorldStateCache()
        # //3.- Capture a monotonic clock for instrumentation that also aids testing.
        self._time = time_source or time.perf_counter
        # //4.- Aggregate cycle timings to make latency reporting straightforward.
        self._metrics = metrics or MatchMetrics()
        # //5.- Convert an optional planning frequency into a spacing interval.
        if planning_frequency_hz is not None:
            if planning_frequency_hz <= 0:
                raise ValueError("planning_frequency_hz must be positive")
            self._planning_interval = 1.0 / planning_frequency_hz
        else:
            self._planning_interval = None
        self._last_plan_ts: float | None = None
        self._template_intent: IntentPayload | None = None
        if auto_start:
            # //6.- Kick off the streaming loop immediately for realtime usage.
            self._client.start()

    @property
    def context(self) -> FSMContext:
        """Expose the mutable context so tests can inspect internal state."""

        return self._context

    @property
    def active_state(self) -> str:
        """Return the current FSM state name for diagnostics."""

        # //7.- Surface the FSM's active state without leaking the machine internals.
        return self._machine.active

    @property
    def metrics(self) -> MatchMetrics:
        """Expose the aggregated latency measurements for diagnostics."""

        # //8.- Provide callers with the metrics accumulator for reporting hooks.
        return self._metrics

    def process_diff(self, diff: Mapping[str, object]) -> IntentPayload:
        """Advance the FSM with the supplied world diff and send the resulting intent."""

        start = self._time()
        # //9.- Fold the diff into the cached world view before evaluating the FSM.
        world = self._world.apply(diff)
        post_diff = self._time()
        should_plan = self._should_plan(start)
        planned = should_plan or self._template_intent is None
        if planned:
            # //10.- Execute the current state logic and capture the resulting intent.
            intent = self._machine.step(world, self._context)
            decision_end = self._time()
            # //11.- Remember a template without the sequence so skips can reuse it cheaply.
            template = dict(intent)
            if "sequence_id" in template:
                template["sequence_id"] = 0
            self._template_intent = template
            self._last_plan_ts = decision_end
        else:
            # //12.- Re-emit the last intent with a fresh sequence when throttling planning.
            assert self._template_intent is not None  # for type checkers
            template = dict(self._template_intent)
            if "sequence_id" in template:
                template["sequence_id"] = self._context.next_sequence()
            intent = template
            decision_end = post_diff
        # //13.- Queue the intent for streaming while relying on the SDK for rate limiting.
        self._client.send_intent(intent)
        send_end = self._time()
        decision_duration = decision_end - post_diff if planned else 0.0
        self._metrics.record(
            diff_s=post_diff - start,
            decision_s=decision_duration,
            send_s=send_end - decision_end,
            total_s=send_end - start,
            planned=planned,
        )
        return intent

    def close(self) -> None:
        """Tear down the streaming loop and release resources."""

        # //14.- Stop the intent stream gracefully then dispose the channel.
        try:
            self._client.stop()
        finally:
            self._client.close()

    def _should_plan(self, now: float) -> bool:
        """Determine whether another FSM evaluation should occur."""

        # //15.- Always plan when throttling is disabled or no prior sample exists.
        if self._planning_interval is None or self._last_plan_ts is None:
            return True
        # //16.- Compare the elapsed time against the configured planning cadence.
        return (now - self._last_plan_ts) >= self._planning_interval


__all__ = ["FSMIntentBot", "RuntimeToggles"]
