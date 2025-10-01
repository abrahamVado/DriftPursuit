from __future__ import annotations

import math

from tunnelcave_sandbox.path import CavePath
from tunnelcave_sandbox.terrain_generator import TunnelParams, TunnelTerrainGenerator


def make_params(**overrides: object) -> TunnelParams:
    base = dict(
        world_seed=7,
        chunk_length=6.0,
        ring_step=3.0,
        tube_sides=6,
        dir_freq=0.05,
        dir_blend=0.65,
        radius_base=5.0,
        radius_var=0.5,
        radius_freq=0.01,
        rough_amp=0.2,
        rough_freq=0.1,
        jolt_every_meters=200.0,
        jolt_strength=0.1,
        max_turn_per_step_rad=0.5,
        mode="mesh",
        field_type="divergence_free",
        min_clearance_radius=0.0,
    )
    base.update(overrides)
    return TunnelParams(**base)


def test_sample_matches_first_ring_at_zero() -> None:
    params = make_params()
    generator = TunnelTerrainGenerator(params)
    path = CavePath(generator)

    sample = path.sample(0.0)
    first_ring = generator.rings()[0]

    assert sample.frame.origin == first_ring.center
    assert sample.frame.forward == first_ring.forward
    assert sample.radii == first_ring.roughness_profile


def test_sample_interpolates_between_rings() -> None:
    params = make_params()
    generator = TunnelTerrainGenerator(params)
    path = CavePath(generator)

    generator.ensure_arc_length(params.ring_step)
    arc_lengths = generator.arc_lengths()
    assert len(arc_lengths) >= 2

    t = arc_lengths[1] * 0.42
    sample = path.sample(t)

    ring0, ring1 = generator.rings()[:2]
    s0, s1 = arc_lengths[:2]
    blend = (t - s0) / (s1 - s0)

    expected_origin = ring0.center.lerp(ring1.center, blend)
    assert (sample.frame.origin - expected_origin).length() < 1e-6

    theta = 1.234
    sides = params.tube_sides
    angle_index = (theta % math.tau) / math.tau * sides
    radius0 = ring0.radius_at_angle(angle_index)
    radius1 = ring1.radius_at_angle(angle_index)
    expected_radius = radius0 * (1.0 - blend) + radius1 * blend
    assert abs(sample.radius_at(theta) - expected_radius) < 1e-6

    wall_point = path.wall_point(t, theta)
    axis = sample.frame.right * math.cos(theta) + sample.frame.up * math.sin(theta)
    assert (wall_point - (sample.frame.origin + axis * expected_radius)).length() < 1e-6


def test_wall_point_allows_custom_radius() -> None:
    params = make_params()
    generator = TunnelTerrainGenerator(params)
    path = CavePath(generator)

    custom_radius = 1.5
    theta = 0.5
    point = path.wall_point(0.0, theta, custom_radius)
    first_ring = generator.rings()[0]
    axis = first_ring.frame.right * math.cos(theta) + first_ring.frame.up * math.sin(theta)
    expected = first_ring.center + axis * custom_radius
    assert (point - expected).length() < 1e-6
