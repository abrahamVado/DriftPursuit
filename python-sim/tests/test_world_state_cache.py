"""Tests for the optimised world state diff applier."""

from __future__ import annotations

import sys
from pathlib import Path
sys.path.append(str(Path(__file__).resolve().parents[1]))

from bots.world_state import WorldStateCache


def test_world_state_cache_merges_nested_diffs() -> None:
    cache = WorldStateCache()

    # //1.- Seed the cache with a baseline snapshot including nested dictionaries.
    first = cache.apply({"bot": {"position": (0.0, 0.0), "health": 1.0}})
    bot_ref = first["bot"]

    # //2.- Apply a partial diff that only updates the position component.
    second = cache.apply({"bot": {"position": (5.0, 2.0)}})

    assert second["bot"] is bot_ref
    assert second["bot"]["health"] == 1.0
    assert second["bot"]["position"] == (5.0, 2.0)

    # //3.- Confirm that unrelated keys can be introduced without replacing siblings.
    third = cache.apply({"target": {"position": (1.0, 1.0)}})
    assert third["bot"] is bot_ref
    assert third["target"]["position"] == (1.0, 1.0)


def test_world_state_cache_reset_drops_state() -> None:
    cache = WorldStateCache()
    cache.apply({"bot": {"position": (1.0, 1.0)}})

    # //4.- Clearing the cache removes the prior snapshot so future diffs start fresh.
    cache.reset()
    fresh = cache.apply({"bot": {"position": (0.0, 0.0)}})
    assert fresh["bot"]["position"] == (0.0, 0.0)
