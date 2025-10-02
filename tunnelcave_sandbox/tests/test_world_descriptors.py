"""Validate world descriptor construction tags spline nodes appropriately."""
from __future__ import annotations

from tunnelcave_sandbox.src.world import (
    SPAWN_TAG,
    SET_DRESSING_TAG,
    build_loop_descriptor,
)


# //1.- Building a descriptor should mark rooms for set dressing and a spawn point.
def test_build_loop_descriptor_tags_spawn_and_rooms():
    path = (
        (0.0, 0.0, 0.0),
        (5.0, 0.0, 0.0),
        (5.0, 5.0, 0.0),
        (0.0, 0.0, 0.0),
    )
    radii = (6.0, 3.0, 7.0, 6.0)
    rooms = (2,)
    descriptor = build_loop_descriptor(path, radii, rooms)
    spawn_nodes = descriptor.tagged(SPAWN_TAG)
    assert spawn_nodes
    assert spawn_nodes[0].index == 2
    assert spawn_nodes[0].has_tag(SET_DRESSING_TAG)
    assert descriptor.nodes[1].tags == ()
