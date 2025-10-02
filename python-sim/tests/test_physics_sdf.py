"""Unit tests for SDF sampling and collision helpers."""

import math
import sys
from pathlib import Path

import pytest

sys.path.append(str(Path(__file__).resolve().parents[1]))

from physics import PlaneField, SphereField


def test_sphere_sampling_matches_analytic():
    field = SphereField((0.0, 0.0, 0.0), 2.0)
    cases = [
        ((0.0, 0.0, 0.0), -2.0),
        ((2.0, 0.0, 0.0), 0.0),
        ((0.0, 3.0, 0.0), 1.0),
        ((1.0, 2.0, 2.0), math.sqrt(9.0) - 2.0),
    ]
    for point, expected in cases:
        # //1.- Ensure analytic sphere distances match signed distance samples.
        assert math.isclose(field.sample(point), expected, rel_tol=1e-7)


def test_ray_intersection_hits_sphere_surface():
    field = SphereField((0.0, 0.0, 0.0), 2.0)
    hit = field.ray_intersection((0.0, 0.0, 5.0), (0.0, 0.0, -1.0))
    # //1.- Ray should strike the sphere three units away from the origin point.
    assert hit.hit
    assert math.isclose(hit.distance, 3.0, rel_tol=1e-3, abs_tol=1e-3)
    assert math.isclose(hit.position[2], 2.0, rel_tol=1e-3, abs_tol=1e-3)


def test_sphere_intersection_detects_plane_penetration():
    plane = PlaneField((0.0, 0.0, 0.0), (0.0, 1.0, 0.0))
    intersects, separation = plane.sphere_intersection((0.0, 0.5, 0.0), 1.0)
    # //1.- The sphere center is half a unit above the plane with radius one.
    assert intersects
    assert math.isclose(separation, -0.5, rel_tol=1e-7)


def test_sphere_intersection_respects_clearance():
    plane = PlaneField((0.0, 0.0, 0.0), (0.0, 1.0, 0.0))
    intersects, separation = plane.sphere_intersection((0.0, 2.5, 0.0), 1.0)
    # //1.- Verify the clearance equals signed distance minus the radius.
    assert not intersects
    assert math.isclose(separation, 1.5, rel_tol=1e-7)


def test_ray_intersection_handles_inside_origin():
    field = SphereField((0.0, 0.0, 0.0), 2.0)
    hit = field.ray_intersection((0.0, 0.0, 0.0), (0.0, 0.0, 1.0))
    # //1.- Starting inside returns an immediate hit at zero distance.
    assert hit.hit
    assert hit.distance == 0.0
    assert hit.position == (0.0, 0.0, 0.0)


def test_sample_requires_three_components():
    field = SphereField((0.0, 0.0, 0.0), 1.0)
    # //1.- Ensure the helper raises when insufficient coordinates are supplied.
    with pytest.raises(ValueError):
        field.sample((1.0, 2.0))
