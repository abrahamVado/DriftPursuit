"""Finite state machine utilities for intent-driven bots."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, Iterable, Mapping, MutableMapping, Protocol

IntentPayload = MutableMapping[str, object]


@dataclass
class StateResult:
    """Outcome of a state update including the next intent and transition."""

    intent: IntentPayload
    transition: str | None = None


class FSMState(Protocol):
    """Protocol describing a single finite state machine state."""

    name: str

    def act(self, world: Mapping[str, object], context: "FSMContext") -> StateResult:
        """Compute the next intent and optional transition."""


@dataclass
class FSMContext:
    """Shared runtime information passed to each state."""

    sequence: int = 0
    memory: Dict[str, object] = field(default_factory=dict)
    config: object | None = None

    def next_sequence(self) -> int:
        """Increment and return the intent sequence counter."""

        # //1.- Bump the internal sequence so intents remain monotonically increasing.
        self.sequence += 1
        return self.sequence


class FiniteStateMachine:
    """Small helper that manages state transitions and intent generation."""

    def __init__(self, states: Iterable[FSMState], initial: str) -> None:
        # //1.- Index all states by name so transitions can resolve quickly at runtime.
        self._states: Dict[str, FSMState] = {state.name: state for state in states}
        if initial not in self._states:
            raise ValueError(f"unknown initial state {initial!r}")
        # //2.- Remember the active state's name to evaluate it on each tick.
        self._active = initial

    @property
    def active(self) -> str:
        """Return the name of the current state for diagnostics and tests."""

        return self._active

    def step(self, world: Mapping[str, object], context: FSMContext) -> IntentPayload:
        """Evaluate the current state and switch if a transition is requested."""

        # //3.- Fetch the active state implementation before executing it.
        state = self._states[self._active]
        result = state.act(world, context)
        # //4.- Apply transitions only when the state explicitly requests them.
        if result.transition:
            if result.transition not in self._states:
                raise ValueError(f"unknown state transition {result.transition!r}")
            self._active = result.transition
        # //5.- Return the intent so callers can forward it to the intent client.
        return result.intent


__all__ = ["FiniteStateMachine", "FSMContext", "FSMState", "IntentPayload", "StateResult"]
