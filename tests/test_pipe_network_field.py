from __future__ import annotations

import math

import pytest

from tunnelcave_sandbox.direction_field import FieldParams, PipeNetworkField, PipeNetworkParams
from tunnelcave_sandbox.terrain_generator import TunnelParams, TunnelTerrainGenerator


def make_params(pipe_params: PipeNetworkParams) -> TunnelParams:
    return TunnelParams(
        world_seed=1337,
        chunk_length=18.0,
        ring_step=3.0,
        tube_sides=6,
        dir_freq=0.05,
        dir_blend=0.5,
        radius_base=4.0,
        radius_var=0.5,
        radius_freq=0.02,
        rough_amp=0.2,
        rough_freq=0.15,
        jolt_every_meters=0.0,
        jolt_strength=0.0,
        max_turn_per_step_rad=0.75,
        mode="mesh",
        field_type="pipe_network",
        pipe_network=pipe_params,
    )


def _collect_rings(generator: TunnelTerrainGenerator, chunk_count: int) -> list:
    for idx in range(chunk_count):
        generator.generate_chunk(idx)
    return list(generator.rings())


def test_pipe_network_field_repeatable_and_smooth() -> None:
    pipe_params = PipeNetworkParams(
        module_count_hint=16,
        straight_length=9.0,
        helix_turns=1.25,
        helix_pitch=2.75,
        helix_radius=6.5,
        junction_angle_deg=55.0,
        junction_radius=7.5,
    )
    params = make_params(pipe_params)
    generator_a = TunnelTerrainGenerator(params)
    generator_b = TunnelTerrainGenerator(params)

    rings_a = _collect_rings(generator_a, chunk_count=4)
    rings_b = _collect_rings(generator_b, chunk_count=4)

    assert len(rings_a) == len(rings_b) > 0

    for a, b in zip(rings_a, rings_b):
        assert a.center.x == pytest.approx(b.center.x, abs=1e-6)
        assert a.center.y == pytest.approx(b.center.y, abs=1e-6)
        assert a.center.z == pytest.approx(b.center.z, abs=1e-6)
        forward_dot = max(-1.0, min(1.0, a.forward.dot(b.forward)))
        assert math.acos(forward_dot) < 1e-6

    field_params = FieldParams(
        world_seed=params.world_seed,
        dir_freq=params.dir_freq,
        dir_blend=params.dir_blend,
        max_turn_per_step_rad=params.max_turn_per_step_rad,
        jolt_every_meters=params.jolt_every_meters,
        jolt_strength=params.jolt_strength,
    )
    field = PipeNetworkField(field_params, pipe_params)
    for index, ring in enumerate(rings_a[:16]):
        arc_length = index * params.ring_step
        expected = field.position_at(arc_length)
        assert ring.center.x == pytest.approx(expected.x, abs=1e-4)
        assert ring.center.y == pytest.approx(expected.y, abs=1e-4)
        assert ring.center.z == pytest.approx(expected.z, abs=1e-4)

    # The module plan should include each primitive type in a single cycle so the
    # tunnel never degenerates into a straight or purely helical run.
    field.position_at(pipe_params.straight_length * pipe_params.module_count_hint * 2.0)
    seen = {type(segment).__name__ for segment, _ in field._segments[: pipe_params.module_count_hint]}
    assert "_StraightSegment" in seen
    assert "_HelixSegment" in seen
    assert "_ArcSegment" in seen

    turn_angles = []
    for prev, curr in zip(rings_a, rings_a[1:]):
        dot = max(-1.0, min(1.0, prev.forward.dot(curr.forward)))
        turn_angles.append(math.acos(dot))
    assert max(turn_angles) < 0.75
