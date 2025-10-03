"""Finite state patrol bot implementation."""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Mapping, Tuple

from ._sdk import IntentClient
from .fsm_base import FSMContext, FSMState, FiniteStateMachine, StateResult
from .fsm_bot import FSMIntentBot, RuntimeToggles
from .intent_helpers import build_intent
from .vector_math import distance, heading_to


@dataclass
class PatrolConfig:
    """Runtime parameters controlling the patrol behaviour."""

    controller_id: str
    waypoints: List[Tuple[float, float]]
    patrol_throttle: float = 0.4
    alert_distance: float = 30.0
    linger_ticks: int = 12

    def __post_init__(self) -> None:
        # //1.- Ensure at least two waypoints exist so the patrol loop makes sense.
        if len(self.waypoints) < 2:
            raise ValueError("waypoints must contain at least two entries")


def _bot_pose(world: Mapping[str, object]) -> Tuple[float, float, float]:
    bot = world.get("bot", {})
    position = bot.get("position", (0.0, 0.0))
    heading = bot.get("heading", 0.0)
    return (float(position[0]), float(position[1]), float(heading))


def _target_position(world: Mapping[str, object]) -> Tuple[float, float]:
    target = world.get("target", {})
    position = target.get("position", (0.0, 0.0))
    return (float(position[0]), float(position[1]))


@dataclass
class PatrolState(FSMState):
    config: PatrolConfig
    name: str = "patrol"

    def act(self, world: Mapping[str, object], context: FSMContext) -> StateResult:
        # //2.- Progress towards the current waypoint and advance when close enough.
        waypoint_index = int(context.memory.get("waypoint_index", 0))
        waypoint = self.config.waypoints[waypoint_index]
        pose = _bot_pose(world)
        steer = heading_to(pose, waypoint)
        intent = build_intent(
            context.next_sequence(),
            controller_id=self.config.controller_id,
            throttle=self.config.patrol_throttle,
            steer=steer,
        )
        if distance(pose[:2], waypoint) < 3.0:
            waypoint_index = (waypoint_index + 1) % len(self.config.waypoints)
            context.memory["waypoint_index"] = waypoint_index
        target_pos = _target_position(world)
        if distance(pose[:2], target_pos) <= self.config.alert_distance:
            context.memory["linger"] = self.config.linger_ticks
            context.memory["return_waypoint"] = context.memory.get("waypoint_index", 0)
            return StateResult(intent, "investigate")
        return StateResult(intent)


@dataclass
class InvestigateState(FSMState):
    config: PatrolConfig
    name: str = "investigate"

    def act(self, world: Mapping[str, object], context: FSMContext) -> StateResult:
        # //3.- Face towards the target while counting down the linger window.
        pose = _bot_pose(world)
        target_pos = _target_position(world)
        steer = heading_to(pose, target_pos)
        toggles: RuntimeToggles = context.config  # type: ignore[assignment]
        throttle = min(1.0, self.config.patrol_throttle + 0.2)
        handbrake = toggles.allow_handbrake and distance(pose[:2], target_pos) < 6.0
        intent = build_intent(
            context.next_sequence(),
            controller_id=self.config.controller_id,
            throttle=throttle,
            steer=steer,
            handbrake=handbrake,
        )
        linger = int(context.memory.get("linger", 0)) - 1
        context.memory["linger"] = linger
        if distance(pose[:2], target_pos) > self.config.alert_distance * 1.5 and linger <= 0:
            return StateResult(intent, "return")
        return StateResult(intent)


@dataclass
class ReturnState(FSMState):
    config: PatrolConfig
    name: str = "return"

    def act(self, world: Mapping[str, object], context: FSMContext) -> StateResult:
        # //4.- Head back to the last recorded waypoint before resuming patrol.
        pose = _bot_pose(world)
        waypoint_index = int(context.memory.get("return_waypoint", 0))
        waypoint = self.config.waypoints[waypoint_index]
        steer = heading_to(pose, waypoint)
        intent = build_intent(
            context.next_sequence(),
            controller_id=self.config.controller_id,
            throttle=self.config.patrol_throttle,
            steer=steer,
        )
        if distance(pose[:2], waypoint) < 2.0:
            context.memory["waypoint_index"] = waypoint_index
            return StateResult(intent, "patrol")
        return StateResult(intent)


def build_patrol_bot(
    client: IntentClient,
    config: PatrolConfig,
    *,
    toggles: RuntimeToggles | None = None,
    auto_start: bool = True,
    planning_frequency_hz: float | None = None,
) -> FSMIntentBot:
    """Factory that wires the patrol FSM into the shared runtime."""

    # //5.- Assemble the FSM with the three states backing the patrol behaviour.
    states = [PatrolState(config=config), InvestigateState(config=config), ReturnState(config=config)]
    machine = FiniteStateMachine(states, "patrol")
    return FSMIntentBot(
        client,
        machine,
        config.controller_id,
        toggles=toggles,
        auto_start=auto_start,
        planning_frequency_hz=planning_frequency_hz,
    )


__all__ = ["PatrolConfig", "build_patrol_bot"]
