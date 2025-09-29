from __future__ import annotations

import numpy as np
import pytest

from collision import CollisionSystem
from client import Plane, ensure_tag


def _make_plane() -> Plane:
    plane = Plane("plane-1", x=0.0, y=0.0, z=120.0, speed=120.0)
    plane.manual_override.disable()
    return plane


def test_ground_collision_resets_to_spawn():
    plane = _make_plane()
    system = CollisionSystem(
        spawn_position=plane.pos.copy(),
        spawn_orientation=plane.ori,
        start_time=0.0,
    )

    # Move into the ground with a steep dive.
    plane.pos[:] = [0.0, 0.0, -5.0]
    plane.vel[:] = [0.0, 0.0, -150.0]
    plane.ori = [0.0, -0.9, 0.0]

    hit, crashed = system.handle_step(plane, now=1.0, ensure_tag_fn=ensure_tag)
    assert crashed is True
    assert hit is not None and hit.kind == "ground"
    assert plane.manual_override.enabled is False
    assert plane.pos[2] == pytest.approx(system.spawn_position[2])


def test_safe_state_checkpoint_used_for_reset():
    plane = _make_plane()
    system = CollisionSystem(
        spawn_position=plane.pos.copy(),
        spawn_orientation=plane.ori,
        start_time=0.0,
    )

    # Fly to a new position and record the checkpoint.
    plane.pos[:] = [200.0, 50.0, 320.0]
    plane.vel[:] = [80.0, 0.0, 0.0]
    plane.ori = [0.1, 0.05, 0.0]
    system.handle_step(plane, now=1.0, ensure_tag_fn=ensure_tag)

    # Crash at a different location.
    plane.pos[:] = [400.0, -30.0, -10.0]
    plane.vel[:] = [120.0, 0.0, -180.0]
    plane.ori = [0.0, -0.8, 0.0]

    hit, crashed = system.handle_step(plane, now=1.5, ensure_tag_fn=ensure_tag)
    assert crashed is True
    assert hit is not None
    assert plane.pos[0] == pytest.approx(200.0)
    assert plane.pos[1] == pytest.approx(50.0)
    assert plane.pos[2] == pytest.approx(320.0)


def test_soft_touchdown_does_not_trigger_crash():
    plane = _make_plane()
    system = CollisionSystem(
        spawn_position=plane.pos.copy(),
        spawn_orientation=plane.ori,
        start_time=0.0,
    )

    # Descend gently until the capsule intersects the ground.
    bottom = system.sample_ground_height(0.0, 0.0) + system.ground_margin
    plane.pos[:] = [0.0, 0.0, bottom + system.capsule_half_height - 0.25]
    plane.vel[:] = [15.0, 0.0, -5.0]
    plane.ori = [0.0, 0.0, 0.0]

    hit, crashed = system.handle_step(plane, now=1.0, ensure_tag_fn=ensure_tag)
    assert crashed is False
    assert hit is not None and hit.kind == "ground"
    assert plane.pos[2] >= bottom + system.capsule_half_height


def test_obstacle_collision_detected():
    plane = _make_plane()
    system = CollisionSystem(
        spawn_position=plane.pos.copy(),
        spawn_orientation=plane.ori,
        start_time=0.0,
    )
    system.add_box_obstacle(minimum=[40.0, -10.0, 0.0], maximum=[80.0, 10.0, 40.0], name="hangar")

    # Record a safe state above the obstacle so the reset uses it.
    plane.pos[:] = [60.0, 0.0, 180.0]
    plane.vel[:] = [60.0, 0.0, 0.0]
    plane.ori = [0.0, 0.1, 0.0]
    system.handle_step(plane, now=1.0, ensure_tag_fn=ensure_tag)

    plane.pos[:] = [60.0, 0.0, 20.0]
    plane.vel[:] = [100.0, 0.0, -30.0]
    plane.ori = [0.0, -0.7, 0.0]

    hit, crashed = system.handle_step(plane, now=1.4, ensure_tag_fn=ensure_tag)
    assert hit is not None
    assert hit.kind == "obstacle"
    assert hit.object_id == "hangar"
    assert crashed is True


def test_grace_period_prevents_immediate_recollision():
    plane = _make_plane()
    system = CollisionSystem(
        spawn_position=plane.pos.copy(),
        spawn_orientation=plane.ori,
        start_time=0.0,
        grace_period=0.5,
    )

    # First crash triggers a reset.
    plane.pos[:] = [0.0, 0.0, -2.0]
    plane.vel[:] = [0.0, 0.0, -120.0]
    plane.ori = [0.0, -0.8, 0.0]
    _, crashed = system.handle_step(plane, now=1.0, ensure_tag_fn=ensure_tag)
    assert crashed is True

    # Immediately after the reset the plane is still touching the ground but
    # should not be flagged as another crash.
    plane.vel[:] = [0.0, 0.0, -5.0]
    _hit, crashed = system.handle_step(plane, now=1.2, ensure_tag_fn=ensure_tag)
    assert crashed is False

