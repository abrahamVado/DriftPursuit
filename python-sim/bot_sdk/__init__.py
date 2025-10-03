"""Bot SDK utilities for interacting with the broker."""

from .launcher import BotProcessManager, BotSnapshot, create_server
from .state_stream import ApplyCallback, CodecRegistry, DiffPayload, StateStreamReceiver

# //1.- Re-export the key primitives so consumers get a compact API surface.
__all__ = [
    "ApplyCallback",
    "BotProcessManager",
    "BotSnapshot",
    "CodecRegistry",
    "DiffPayload",
    "StateStreamReceiver",
    "create_server",
]
