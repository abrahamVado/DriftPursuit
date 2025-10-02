"""Validate ground vehicle surface constraints keep actors glued to the track."""

import sys
from pathlib import Path

import math

import pytest

sys.path.append(str(Path(__file__).resolve().parents[1]))

from physics import BodyState, PlaneField, advance_surface_bound_body  # type: ignore  # pylint: disable=import-error


def test_upward_velocity_gets_suppressed():
    plane = PlaneField((0.0, 0.0, 0.0), (0.0, 1.0, 0.0))
    state = BodyState(position=(0.0, 1.0, 0.0), velocity=(0.0, 12.0, 0.0))
    # //1.- Advance the surface-bound body so it cannot lift away from the ground.
    constrained = advance_surface_bound_body(state, plane, radius=1.0, dt=0.1)
    assert math.isclose(constrained.position[1], 1.0, rel_tol=1e-6, abs_tol=1e-6)
    assert constrained.velocity == pytest.approx((0.0, 0.0, 0.0))


def test_tangential_motion_survives_constraint():
    plane = PlaneField((0.0, 0.0, 0.0), (0.0, 1.0, 0.0))
    state = BodyState(position=(0.0, 1.0, 0.0), velocity=(10.0, 4.0, -3.0))
    # //1.- After the constraint vertical motion should vanish while tangential remains.
    constrained = advance_surface_bound_body(state, plane, radius=1.0, dt=0.05)
    assert constrained.velocity == pytest.approx((10.0, 0.0, -3.0))
