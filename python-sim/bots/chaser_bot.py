"""Finite state chaser bot implementation."""

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
class ChaserConfig:
    """Parameters governing the aggressiveness of the chaser bot."""

    controller_id: str
    chase_throttle: float = 0.85
    search_turn_rate: float = 0.5
    engage_distance: float = 50.0
    attack_distance: float = 9.0


@dataclass
class SearchState(FSMState):
    config: ChaserConfig
    name: str = "search"

    def act(self, world: Mapping[str, object], context: FSMContext) -> StateResult:
        # //1.- Rotate in place while no target is within the engage distance.
        pose = _bot_pose(world)
        target_pos = _target(world)
        steer = context.memory.setdefault("search_direction", self.config.search_turn_rate)
        throttle = 0.1
        intent = build_intent(
            context.next_sequence(),
            controller_id=self.config.controller_id,
            throttle=throttle,
            steer=steer,
        )
        if distance(pose[:2], target_pos) <= self.config.engage_distance:
            context.memory.pop("search_direction", None)
            return StateResult(intent, "chase")
        return StateResult(intent)


@dataclass
class ChaseState(FSMState):
    config: ChaserConfig
    name: str = "chase"

    def act(self, world: Mapping[str, object], context: FSMContext) -> StateResult:
        # //2.- Close the gap aggressively until the target is within attack range.
        pose = _bot_pose(world)
        target_pos = _target(world)
        steering = heading_to(pose, target_pos)
        toggles: RuntimeToggles = context.config  # type: ignore[assignment]
        throttle = self.config.chase_throttle
        boost = toggles.allow_boost and distance(pose[:2], target_pos) > self.config.attack_distance * 1.5
        intent = build_intent(
            context.next_sequence(),
            controller_id=self.config.controller_id,
            throttle=throttle,
            steer=steering,
            boost=boost,
        )
        gap = distance(pose[:2], target_pos)
        if gap <= self.config.attack_distance:
            context.memory["attack_ticks"] = 3
            return StateResult(intent, "attack")
        if gap > self.config.engage_distance * 1.2:
            return StateResult(intent, "search")
        return StateResult(intent)


@dataclass
class AttackState(FSMState):
    config: ChaserConfig
    name: str = "attack"

    def act(self, world: Mapping[str, object], context: FSMContext) -> StateResult:
        # //3.- Apply heavy braking when directly on top of the target.
        pose = _bot_pose(world)
        target_pos = _target(world)
        steer = heading_to(pose, target_pos)
        intent = build_intent(
            context.next_sequence(),
            controller_id=self.config.controller_id,
            throttle=0.0,
            brake=1.0,
            steer=steer,
        )
        ticks = int(context.memory.get("attack_ticks", 0)) - 1
        context.memory["attack_ticks"] = ticks
        if ticks <= 0 or distance(pose[:2], target_pos) > self.config.attack_distance * 1.5:
            return StateResult(intent, "chase")
        return StateResult(intent)


def build_chaser_bot(
    client: IntentClient,
    config: ChaserConfig,
    *,
    toggles: RuntimeToggles | None = None,
    auto_start: bool = True,
    planning_frequency_hz: float | None = None,
) -> FSMIntentBot:
    """Factory for the chaser FSM bot."""

    # //4.- Register the search, chase, and attack states with the machine.
    states = [SearchState(config=config), ChaseState(config=config), AttackState(config=config)]
    machine = FiniteStateMachine(states, "search")
    return FSMIntentBot(
        client,
        machine,
        config.controller_id,
        toggles=toggles,
        auto_start=auto_start,
        planning_frequency_hz=planning_frequency_hz,
    )


__all__ = ["ChaserConfig", "build_chaser_bot"]
