"""Validate entrance constraint velocity clipping."""
from __future__ import annotations

from tunnelcave_sandbox.src.physics import clip_velocity_outward


# //1.- Outward velocity components aligned with the normal should be removed.
def test_clip_velocity_outward_removes_normal_component():
    velocity = (5.0, 2.0, 0.0)
    normal = (1.0, 0.0, 0.0)
    clipped = clip_velocity_outward(velocity, normal)
    assert clipped[0] == 0.0
    assert clipped[1] == velocity[1]


# //2.- Tangential or inward motion should remain unaffected.
def test_clip_velocity_outward_preserves_inward_motion():
    velocity = (-3.0, 1.0, 0.0)
    normal = (1.0, 0.0, 0.0)
    clipped = clip_velocity_outward(velocity, normal)
    assert clipped == velocity
