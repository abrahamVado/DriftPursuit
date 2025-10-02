"""Ensure spawn selection honours descriptor tagging and safety constraints."""
from __future__ import annotations

from tunnelcave_sandbox.src.generation import build_swept_tube
from tunnelcave_sandbox.src.spawn import select_spawn_node
from tunnelcave_sandbox.src.world import SPAWN_TAG, build_loop_descriptor


# //1.- Spawn selection should choose the safest tagged node that meets clearance.
def test_select_spawn_node_prefers_safe_spawn():
    path = (
        (0.0, 0.0, 0.0),
        (10.0, 0.0, 0.0),
        (20.0, 0.0, 0.0),
    )
    radii = (2.0, 6.0, 2.0)
    rooms = (1,)

    def radius_callback(index: int, total: int) -> float:
        return radii[min(index, len(radii) - 1)]

    tube = build_swept_tube(path, radius_callback)
    descriptor = build_loop_descriptor(path, radii, rooms)
    spawn_node = select_spawn_node(descriptor, tube, clearance_threshold=4.0)
    assert SPAWN_TAG in spawn_node.tags
    assert spawn_node.index == 1
    assert spawn_node.radius >= 6.0


# //2.- Requesting an excessive clearance should raise for visibility.
def test_select_spawn_node_rejects_insufficient_clearance():
    path = (
        (0.0, 0.0, 0.0),
        (5.0, 0.0, 0.0),
    )
    radii = (2.0, 2.0)
    rooms = (0,)
    tube = build_swept_tube(path, lambda index, total: radii[min(index, len(radii) - 1)])
    descriptor = build_loop_descriptor(path, radii, rooms)
    try:
        select_spawn_node(descriptor, tube, clearance_threshold=3.0)
    except ValueError:
        return
    raise AssertionError("Expected ValueError for insufficient clearance")
