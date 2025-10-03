"""Import helpers that tolerate missing optional SDK dependencies in tests."""

from __future__ import annotations

from typing import Mapping, Protocol

try:  # pragma: no cover - exercised when google/protobuf is installed
    from bot_sdk.intent_client import IntentClient as _IntentClient
except ModuleNotFoundError:  # pragma: no cover - test environments without protobuf
    class IntentClient(Protocol):
        """Protocol describing the subset of IntentClient used by the bots."""

        def start(self) -> None:
            ...

        def stop(self):
            ...

        def close(self) -> None:
            ...

        def send_intent(self, intent: Mapping[str, object]) -> None:
            ...
else:  # pragma: no cover - runtime path
    IntentClient = _IntentClient


__all__ = ["IntentClient"]
