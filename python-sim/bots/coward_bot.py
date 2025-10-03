"""Finite state coward bot implementation."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping, Tuple

from ._sdk import IntentClient
from .fsm_base import FSMContext, FSMState, FiniteStateMachine, StateResult
from .fsm_bot import FSMIntentBot, RuntimeToggles
from .intent_helpers import build_intent
from .vector_math import distance, heading_to


def _bot_pose(world: Mapping[str, object]) -> Tuple[float, float, float]:
    bot = world.get("bot", {})
    position = bot.get("position", (0.0, 0.0))
    heading = bot.get("heading", 0.0)
    return (float(position[0]), float(position[1]), float(heading))


def _target(world: Mapping[str, object]) -> Tuple[float, float]:
    target = world.get("target", {})
    position = target.get("position", (0.0, 0.0))
    return (float(position[0]), float(position[1]))


def _health(world: Mapping[str, object]) -> float:
    bot = world.get("bot", {})
    return float(bot.get("health", 1.0))


@dataclass
class CowardConfig:
    """Parameters driving the cowardly behaviour."""

    controller_id: str
    harass_distance: float = 40.0
    retreat_distance: float = 55.0
    safe_health: float = 0.45
    retreat_throttle: float = 0.95


@dataclass
class HarassState(FSMState):
    config: CowardConfig
    name: str = "harass"

    def act(self, world: Mapping[str, object], context: FSMContext) -> StateResult:
        # //1.- Maintain range while peppering the target if health is high enough.
        pose = _bot_pose(world)
        target_pos = _target(world)
        gap = distance(pose[:2], target_pos)
        steer = heading_to(pose, target_pos)
        throttle = 0.6 if gap > self.config.harass_distance else 0.2
        intent = build_intent(
            context.next_sequence(),
            controller_id=self.config.controller_id,
            throttle=throttle,
            steer=steer,
        )
        if _health(world) <= self.config.safe_health:
            context.memory["recover_ticks"] = 8
            return StateResult(intent, "retreat")
        return StateResult(intent)


@dataclass
class RetreatState(FSMState):
    config: CowardConfig
    name: str = "retreat"

    def act(self, world: Mapping[str, object], context: FSMContext) -> StateResult:
        # //2.- Flee from the opponent and build distance while health regenerates.
        pose = _bot_pose(world)
        target_pos = _target(world)
        steer = -heading_to(pose, target_pos)
        toggles: RuntimeToggles = context.config  # type: ignore[assignment]
        intent = build_intent(
            context.next_sequence(),
            controller_id=self.config.controller_id,
            throttle=self.config.retreat_throttle,
            steer=steer,
            boost=toggles.allow_boost,
        )
        gap = distance(pose[:2], target_pos)
        if gap >= self.config.retreat_distance:
            return StateResult(intent, "recover")
        return StateResult(intent)


@dataclass
class RecoverState(FSMState):
    config: CowardConfig
    name: str = "recover"

    def act(self, world: Mapping[str, object], context: FSMContext) -> StateResult:
        # //3.- Circle while waiting for the recover timer before re-engaging.
        steer = 0.6
        intent = build_intent(
            context.next_sequence(),
            controller_id=self.config.controller_id,
            throttle=0.3,
            steer=steer,
        )
        ticks = int(context.memory.get("recover_ticks", 0)) - 1
        context.memory["recover_ticks"] = ticks
        if ticks <= 0 and _health(world) > self.config.safe_health:
            return StateResult(intent, "harass")
        return StateResult(intent)


def build_coward_bot(
    client: IntentClient,
    config: CowardConfig,
    *,
    toggles: RuntimeToggles | None = None,
    auto_start: bool = True,
    planning_frequency_hz: float | None = None,
) -> FSMIntentBot:
    """Factory for the coward FSM bot."""

    # //4.- Compose harass, retreat, and recover states to drive the coward.
    states = [HarassState(config=config), RetreatState(config=config), RecoverState(config=config)]
    machine = FiniteStateMachine(states, "harass")
    return FSMIntentBot(
        client,
        machine,
        config.controller_id,
        toggles=toggles,
        auto_start=auto_start,
        planning_frequency_hz=planning_frequency_hz,
    )


__all__ = ["CowardConfig", "build_coward_bot"]
