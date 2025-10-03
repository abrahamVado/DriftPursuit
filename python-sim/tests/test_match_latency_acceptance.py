"""Acceptance test covering intent cadence and planning latency in a match loop."""

from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Mapping

sys.path.append(str(Path(__file__).resolve().parents[1]))

from bots import RuntimeToggles
from bots.fsm_base import FSMContext, FSMState, FiniteStateMachine, StateResult
from bots.fsm_bot import FSMIntentBot
from bots.intent_helpers import build_intent
from bots.match_metrics import MatchMetrics
from bots.world_state import WorldStateCache


@dataclass
class CycleSpec:
    """Configuration for a single receive→decide→send cycle."""

    start: float
    post_diff: float
    post_decision: float
    post_send: float
    planned: bool


class AcceptanceClock:
    """Deterministic monotonic clock sequenced to mirror runtime instrumentation."""

    def __init__(self) -> None:
        self._timeline: list[float] = []

    def schedule(self, spec: CycleSpec) -> None:
        # //1.- Queue timestamps for start, diff, optional decision, and send phases.
        self._timeline.append(spec.start)
        self._timeline.append(spec.post_diff)
        if spec.planned:
            self._timeline.append(spec.post_decision)
        self._timeline.append(spec.post_send)

    def monotonic(self) -> float:
        # //2.- Pop the next timestamp so tests can advance the simulated clock.
        if not self._timeline:
            raise RuntimeError("clock underrun")
        return self._timeline.pop(0)


class RecordingIntentClient:
    """IntentClient stand-in that records payloads without networking."""

    def __init__(self) -> None:
        self.started = False
        self.sent: list[Mapping[str, object]] = []

    def start(self) -> None:
        # //3.- Mirror the production client lifecycle without spawning threads.
        self.started = True

    def stop(self) -> None:
        # //4.- Toggle the started flag so shutdown paths can be exercised.
        self.started = False

    def close(self) -> None:  # pragma: no cover - nothing to release in tests
        return

    def send_intent(self, intent: Mapping[str, object]) -> None:
        # //5.- Snapshot the payload so the acceptance test can inspect cadence.
        self.sent.append(dict(intent))


class CountingState(FSMState):
    """FSM state that emits intents with monotonically increasing sequences."""

    name = "count"

    def __init__(self, controller_id: str) -> None:
        self._controller = controller_id
        self.calls = 0

    def act(self, world: Mapping[str, object], context: FSMContext) -> StateResult:
        # //6.- Build a basic throttle intent while tracking execution frequency.
        self.calls += 1
        intent = build_intent(
            context.next_sequence(),
            controller_id=self._controller,
            throttle=0.4,
            steer=0.0,
        )
        return StateResult(intent)


def make_world(position: float) -> Mapping[str, object]:
    # //7.- Produce a tiny diff with positional data to exercise the world cache.
    return {"bot": {"position": (position, 0.0)}}


def run_controlled_match(rate_hz: float, schedule: Iterable[CycleSpec]) -> tuple[float, int, int]:
    clock = AcceptanceClock()
    metrics = MatchMetrics(window=32)
    client = RecordingIntentClient()
    state = CountingState("controller")
    machine = FiniteStateMachine([state], "count")
    bot = FSMIntentBot(
        client,
        machine,
        "controller",
        toggles=RuntimeToggles(),
        auto_start=False,
        planning_frequency_hz=rate_hz,
        metrics=metrics,
        world_state=WorldStateCache(),
        time_source=clock.monotonic,
    )

    position = 0.0
    for spec in schedule:
        # //8.- Advance the scripted clock then feed the diff into the FSM bot.
        clock.schedule(spec)
        bot.process_diff(make_world(position))
        position += 0.1

    snapshot = metrics.snapshot()
    # //9.- Emit a structured summary so CI logs capture acceptance metrics.
    print(
        f"ACCEPTANCE rate={rate_hz:.1f}Hz median={snapshot.median_total_ms:.2f}ms "
        f"drops={snapshot.dropped_frames} samples={snapshot.samples}",
    )
    return snapshot.median_total_ms, snapshot.dropped_frames, snapshot.samples


def test_match_loop_latency_acceptance() -> None:
    scenarios: dict[float, list[CycleSpec]] = {
        12.0: [
            # //10.- First frame completes a full plan with comfortable headroom.
            CycleSpec(0.000, 0.006, 0.022, 0.030, True),
            # //11.- A quick follow-up frame skips planning to simulate a throttle reuse.
            CycleSpec(0.060, 0.067, 0.067, 0.075, False),
            # //12.- A later frame plans again but stays within the latency budget.
            CycleSpec(0.160, 0.168, 0.190, 0.200, True),
            # //13.- Final frame also plans to check steady-state performance.
            CycleSpec(0.280, 0.288, 0.308, 0.312, True),
        ],
        18.0: [
            # //14.- Faster cadence still leaves sufficient headroom for planning.
            CycleSpec(0.000, 0.005, 0.018, 0.026, True),
            # //15.- Back-to-back frame forces a reused intent to mimic dropped plans.
            CycleSpec(0.050, 0.058, 0.058, 0.070, False),
            # //16.- Fresh plan verifies latency when the cadence recovers.
            CycleSpec(0.120, 0.128, 0.144, 0.160, True),
            # //17.- Another reuse ensures drop counting continues to work.
            CycleSpec(0.190, 0.198, 0.198, 0.208, False),
            # //18.- Closing plan checks that later cycles remain under budget.
            CycleSpec(0.270, 0.278, 0.295, 0.310, True),
        ],
    }

    for rate, schedule in scenarios.items():
        median, dropped, samples = run_controlled_match(rate, schedule)
        # //19.- Enforce the acceptance budget and ensure instrumentation captured drops.
        assert median <= 40.0
        assert dropped == samples - len([spec for spec in schedule if spec.planned])
