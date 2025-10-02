"""Regression tests for penetration resolution using signed distance fields."""

import sys
from pathlib import Path

import math
import pytest

sys.path.append(str(Path(__file__).resolve().parents[1]))

from physics import BodyState, PlaneField, advance_body


def test_surface_normal_matches_plane_orientation():
    plane = PlaneField((0.0, 0.0, 0.0), (0.0, 1.0, 0.0))
    normal = plane.surface_normal((0.25, -0.5, 0.75))
    # //1.- Plane surface normals should align with the provided plane normal.
    assert normal == pytest.approx((0.0, 1.0, 0.0))


def test_penetration_resolution_pushes_body_out():
    plane = PlaneField((0.0, 0.0, 0.0), (0.0, 1.0, 0.0))
    state = BodyState(position=(0.0, 0.2, 0.0), velocity=(0.0, -5.0, 0.0))
    resolved = advance_body(state, plane, radius=1.0, dt=0.1)
    # //1.- The corrected position should rest exactly one unit above the plane.
    assert math.isclose(resolved.position[1], 1.0, rel_tol=1e-6, abs_tol=1e-6)
    # //2.- Inward velocity components are removed to prevent re-entry.
    assert resolved.velocity == pytest.approx((0.0, 0.0, 0.0))


def test_penetration_resolution_preserves_tangent_velocity():
    plane = PlaneField((0.0, 0.0, 0.0), (0.0, 1.0, 0.0))
    state = BodyState(position=(0.0, 0.5, 0.0), velocity=(10.0, -30.0, 5.0))
    resolved = advance_body(state, plane, radius=1.0, dt=0.05)
    # //1.- Tangential velocity components must remain unchanged after resolution.
    assert resolved.velocity == pytest.approx((10.0, 0.0, 5.0))


def test_high_speed_impact_stabilizes_after_single_step():
    plane = PlaneField((0.0, 0.0, 0.0), (0.0, 1.0, 0.0))
    state = BodyState(position=(0.0, 8.0, 0.0), velocity=(0.0, -180.0, 0.0))
    resolved = advance_body(state, plane, radius=1.0, dt=0.05)
    # //1.- High-speed impacts should still resolve to surface contact without jitter.
    assert math.isclose(resolved.position[1], 1.0, rel_tol=1e-6, abs_tol=1e-6)
    assert resolved.velocity == pytest.approx((0.0, 0.0, 0.0))

    # //2.- Subsequent frames should remain stable without re-penetration.
    follow_up = advance_body(resolved, plane, radius=1.0, dt=0.05)
    assert math.isclose(follow_up.position[1], 1.0, rel_tol=1e-6, abs_tol=1e-6)
    assert follow_up.velocity == pytest.approx((0.0, 0.0, 0.0))
