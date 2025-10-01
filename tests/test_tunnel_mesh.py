from __future__ import annotations

from tunnelcave_sandbox.terrain_generator import TunnelParams, TunnelTerrainGenerator


def make_params(**overrides: object) -> TunnelParams:
    base = dict(
        world_seed=42,
        chunk_length=6.0,
        ring_step=3.0,
        tube_sides=4,
        dir_freq=0.05,
        dir_blend=0.65,
        radius_base=5.0,
        radius_var=0.5,
        radius_freq=0.01,
        rough_amp=0.3,
        rough_freq=0.1,
        jolt_every_meters=120.0,
        jolt_strength=0.25,
        max_turn_per_step_rad=0.5,
        mode="mesh",
    )
    base.update(overrides)
    return TunnelParams(**base)


def test_mesh_caps_append_center_vertices() -> None:
    params = make_params(add_end_caps=True)
    generator = TunnelTerrainGenerator(params)
    chunk = generator.generate_chunk(0)
    assert chunk.mesh is not None
    mesh = chunk.mesh
    ring_count = int(round(params.chunk_length / params.ring_step)) + 1
    assert len(chunk.rings) == ring_count

    expected_vertices = ring_count * params.tube_sides + 2
    expected_indices = (ring_count - 1) * params.tube_sides * 6 + params.tube_sides * 3 * 2

    assert len(mesh.vertices) == expected_vertices
    assert len(mesh.indices) == expected_indices

    start_center = mesh.vertices[params.tube_sides]
    end_center = mesh.vertices[-1]
    assert start_center == chunk.rings[0].center
    assert end_center == chunk.rings[-1].center


def test_mesh_caps_can_be_disabled() -> None:
    params = make_params(add_end_caps=False)
    generator = TunnelTerrainGenerator(params)
    chunk = generator.generate_chunk(0)
    assert chunk.mesh is not None
    mesh = chunk.mesh
    ring_count = int(round(params.chunk_length / params.ring_step)) + 1

    expected_vertices = ring_count * params.tube_sides
    expected_indices = (ring_count - 1) * params.tube_sides * 6

    assert len(mesh.vertices) == expected_vertices
    assert len(mesh.indices) == expected_indices
