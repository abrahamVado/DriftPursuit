"""Base runtime for FSM-driven intent bots."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping

from ._sdk import IntentClient
from .fsm_base import FSMContext, FiniteStateMachine, IntentPayload


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
    ) -> None:
        # //1.- Store collaborators so the bot can forward intents on every tick.
        self._client = client
        self._machine = machine
        self._controller_id = controller_id
        self._context = FSMContext(config=toggles or RuntimeToggles())
        if auto_start:
            # //2.- Kick off the streaming loop immediately for realtime usage.
            self._client.start()

    @property
    def context(self) -> FSMContext:
        """Expose the mutable context so tests can inspect internal state."""

        return self._context

    @property
    def active_state(self) -> str:
        """Return the current FSM state name for diagnostics."""

        # //3.- Surface the FSM's active state without leaking the machine internals.
        return self._machine.active

    def process_diff(self, diff: Mapping[str, object]) -> IntentPayload:
        """Advance the FSM with the supplied world diff and send the resulting intent."""

        # //4.- Execute the current state logic and capture the resulting intent.
        intent = self._machine.step(diff, self._context)
        # //5.- Queue the intent for streaming while relying on the SDK for rate limiting.
        self._client.send_intent(intent)
        return intent

    def close(self) -> None:
        """Tear down the streaming loop and release resources."""

        # //6.- Stop the intent stream gracefully then dispose the channel.
        try:
            self._client.stop()
        finally:
            self._client.close()


__all__ = ["FSMIntentBot", "RuntimeToggles"]
