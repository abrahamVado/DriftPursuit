"""Runtime-level tests for FSMIntentBot instrumentation and planning throttle."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Mapping

sys.path.append(str(Path(__file__).resolve().parents[1]))

from bots import RuntimeToggles
from bots.fsm_base import FSMContext, FSMState, FiniteStateMachine, StateResult
from bots.fsm_bot import FSMIntentBot
from bots.intent_helpers import build_intent
from bots.match_metrics import MatchMetrics
from bots.world_state import WorldStateCache


class ScriptedClock:
    """Deterministic monotonic clock returning pre-seeded timestamps."""

    def __init__(self) -> None:
        self._timeline: list[float] = []

    def push_cycle(
        self,
        start: float,
        post_diff: float,
        post_decision: float,
        post_send: float,
        *,
        planned: bool = True,
    ) -> None:
        # //1.- Queue timestamps that mirror the expected runtime instrumentation order.
        self._timeline.append(start)
        self._timeline.append(post_diff)
        if planned:
            self._timeline.append(post_decision)
        self._timeline.append(post_send)

    def monotonic(self) -> float:
        # //2.- Pop the next timestamp, mirroring time.monotonic semantics.
        if not self._timeline:
            raise RuntimeError("clock underrun")
        return self._timeline.pop(0)


class StubIntentClient:
    """Minimal IntentClient stub that records queued intents."""

    def __init__(self) -> None:
        self.sent: list[Mapping[str, object]] = []

    def start(self) -> None:  # pragma: no cover - trivial stub
        return

    def stop(self) -> None:  # pragma: no cover - trivial stub
        return

    def close(self) -> None:  # pragma: no cover - trivial stub
        return

    def send_intent(self, intent: Mapping[str, object]) -> None:
        # //3.- Store a copy so assertions can inspect the transmitted payloads.
        self.sent.append(dict(intent))


class CountingState(FSMState):
    """FSM state that increments a counter whenever it plans."""

    name = "count"

    def __init__(self, controller_id: str) -> None:
        self.controller_id = controller_id
        self.calls = 0

    def act(self, world: Mapping[str, object], context: FSMContext) -> StateResult:
        # //4.- Generate a new intent while tracking how often the state executes.
        self.calls += 1
        intent = build_intent(
            context.next_sequence(),
            controller_id=self.controller_id,
            throttle=0.2,
            steer=0.0,
        )
        return StateResult(intent)


def test_fsm_intent_bot_throttles_planning_and_tracks_latency() -> None:
    clock = ScriptedClock()
    metrics = MatchMetrics(window=8)
    client = StubIntentClient()
    state = CountingState("controller")
    machine = FiniteStateMachine([state], "count")

    bot = FSMIntentBot(
        client,
        machine,
        "controller",
        toggles=RuntimeToggles(),
        auto_start=False,
        planning_frequency_hz=5.0,
        metrics=metrics,
        world_state=WorldStateCache(),
        time_source=clock.monotonic,
    )

    # //5.- First cycle happens at time zero and should trigger a full plan.
    clock.push_cycle(0.000, 0.003, 0.005, 0.006)
    bot.process_diff({"bot": {"position": (0.0, 0.0)}})

    # //6.- Second cycle occurs before the planning interval elapses, forcing a reuse.
    clock.push_cycle(0.010, 0.011, 0.011, 0.012, planned=False)
    bot.process_diff({"bot": {"position": (0.1, 0.0)}})

    # //7.- Third cycle happens after the throttle window and plans again.
    clock.push_cycle(0.250, 0.253, 0.257, 0.259)
    bot.process_diff({"bot": {"position": (0.2, 0.0)}})

    assert state.calls == 2
    assert [payload["sequence_id"] for payload in client.sent] == [1, 2, 3]

    snapshot = bot.metrics.snapshot()
    assert snapshot.samples == 3
    assert snapshot.planned_samples == 2
    assert snapshot.median_total_ms == 6.0
    assert snapshot.median_decision_ms == 2.0
    assert snapshot.median_diff_ms == 3.0
