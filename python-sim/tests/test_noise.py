import os
import sys

import numpy as np

# Ensure the simulator package is importable when running pytest from the repo root.
THIS_DIR = os.path.dirname(__file__)
PROJECT_ROOT = os.path.abspath(os.path.join(THIS_DIR, ".."))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from client import Plane, apply_noise  # noqa: E402  pylint: disable=wrong-import-position


def test_noise_stays_within_bounds():
    plane = Plane("test-plane", x=10.0, y=-5.0, z=500.0, speed=45.0)
    rng = np.random.default_rng(1234)

    pos_noise = 3.5
    vel_noise = 1.25

    pos_before = plane.pos.copy()
    vel_before = plane.vel.copy()

    pos_delta, vel_delta = apply_noise(plane, rng, pos_noise, vel_noise)

    assert pos_delta is not None
    assert vel_delta is not None

    assert np.all(np.abs(pos_delta) <= pos_noise)
    assert np.all(np.abs(vel_delta) <= vel_noise)

    assert np.allclose(plane.pos, pos_before + pos_delta)
    assert np.allclose(plane.vel, vel_before + vel_delta)

    # Restore and ensure we end up back at the starting values.
    plane.pos -= pos_delta
    plane.vel -= vel_delta

    assert np.allclose(plane.pos, pos_before)
    assert np.allclose(plane.vel, vel_before)
