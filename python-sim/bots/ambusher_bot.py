"""Finite state ambusher bot implementation."""

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


@dataclass
class AmbusherConfig:
    """Parameters defining the ambusher behaviour."""

    controller_id: str
    detection_distance: float = 60.0
    ambush_distance: float = 25.0
    strike_throttle: float = 1.0
    stalk_throttle: float = 0.35


@dataclass
class HideState(FSMState):
    config: AmbusherConfig
    name: str = "hide"

    def act(self, world: Mapping[str, object], context: FSMContext) -> StateResult:
        # //1.- Stay idle until a target moves within the detection cone.
        pose = _bot_pose(world)
        target_pos = _target(world)
        intent = build_intent(
            context.next_sequence(),
            controller_id=self.config.controller_id,
            throttle=0.0,
            steer=0.0,
        )
        if distance(pose[:2], target_pos) <= self.config.detection_distance:
            context.memory["stalk_ticks"] = 5
            return StateResult(intent, "stalk")
        return StateResult(intent)


@dataclass
class StalkState(FSMState):
    config: AmbusherConfig
    name: str = "stalk"

    def act(self, world: Mapping[str, object], context: FSMContext) -> StateResult:
        # //2.- Shadow the target slowly until it is close enough for an ambush.
        pose = _bot_pose(world)
        target_pos = _target(world)
        steer = heading_to(pose, target_pos)
        intent = build_intent(
            context.next_sequence(),
            controller_id=self.config.controller_id,
            throttle=self.config.stalk_throttle,
            steer=steer,
        )
        gap = distance(pose[:2], target_pos)
        context.memory["stalk_ticks"] = int(context.memory.get("stalk_ticks", 0)) - 1
        if gap <= self.config.ambush_distance:
            context.memory["strike_ticks"] = 4
            return StateResult(intent, "strike")
        if gap > self.config.detection_distance * 1.2 and context.memory["stalk_ticks"] <= 0:
            return StateResult(intent, "hide")
        return StateResult(intent)


@dataclass
class StrikeState(FSMState):
    config: AmbusherConfig
    name: str = "strike"

    def act(self, world: Mapping[str, object], context: FSMContext) -> StateResult:
        # //3.- Charge aggressively using optional boost toggles.
        pose = _bot_pose(world)
        target_pos = _target(world)
        steer = heading_to(pose, target_pos)
        toggles: RuntimeToggles = context.config  # type: ignore[assignment]
        intent = build_intent(
            context.next_sequence(),
            controller_id=self.config.controller_id,
            throttle=self.config.strike_throttle,
            steer=steer,
            boost=toggles.allow_boost,
        )
        context.memory["strike_ticks"] = int(context.memory.get("strike_ticks", 0)) - 1
        if context.memory["strike_ticks"] <= 0:
            context.memory["evade_ticks"] = 5
            return StateResult(intent, "evade")
        return StateResult(intent)


@dataclass
class EvadeState(FSMState):
    config: AmbusherConfig
    name: str = "evade"

    def act(self, world: Mapping[str, object], context: FSMContext) -> StateResult:
        # //4.- Break line of sight before returning to the hiding loop.
        pose = _bot_pose(world)
        target_pos = _target(world)
        steer = -heading_to(pose, target_pos)
        intent = build_intent(
            context.next_sequence(),
            controller_id=self.config.controller_id,
            throttle=0.5,
            steer=steer,
        )
        context.memory["evade_ticks"] = int(context.memory.get("evade_ticks", 0)) - 1
        if context.memory["evade_ticks"] <= 0:
            return StateResult(intent, "hide")
        return StateResult(intent)


def build_ambusher_bot(
    client: IntentClient,
    config: AmbusherConfig,
    *,
    toggles: RuntimeToggles | None = None,
    auto_start: bool = True,
) -> FSMIntentBot:
    """Factory for the ambusher FSM bot."""

    # //5.- Wire the hide, stalk, strike, and evade states into the FSM runtime.
    states = [HideState(config=config), StalkState(config=config), StrikeState(config=config), EvadeState(config=config)]
    machine = FiniteStateMachine(states, "hide")
    return FSMIntentBot(client, machine, config.controller_id, toggles=toggles, auto_start=auto_start)


__all__ = ["AmbusherConfig", "build_ambusher_bot"]
