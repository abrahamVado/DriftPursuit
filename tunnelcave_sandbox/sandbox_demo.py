"""Small demonstration harness for the tunnel sandbox."""
from __future__ import annotations

import math

from .camera import CameraParams, ThirdPersonCamera
from .spawn import SpawnPlanner, SpawnRequest
from .streaming import ChunkStreamer
from .profile import default_cavern_profile
from .terrain_generator import TunnelParams, TunnelTerrainGenerator
from .vector import Vector3


def build_default_params() -> TunnelParams:
    return TunnelParams(
        world_seed=1337,
        chunk_length=80.0,
        ring_step=3.0,
        tube_sides=18,
        dir_freq=0.05,
        dir_blend=0.65,
        radius_base=11.0,
        radius_var=1.2,
        radius_freq=0.008,
        rough_amp=1.1,
        rough_freq=0.1,
        rough_smoothness=0.45,
        rough_filter_kernel=(0.2, 0.6, 0.2),
        jolt_every_meters=140.0,
        jolt_strength=0.3,
        max_turn_per_step_rad=0.7,
        mode="mesh+sdf",
        profile=default_cavern_profile(),
    )


def main() -> None:
    params = build_default_params()
    generator = TunnelTerrainGenerator(params)
    streamer = ChunkStreamer(generator)
    streamer.update(0)
    print(streamer.band_summary())

    planner = SpawnPlanner(generator.rings())
    result = planner.plan(SpawnRequest(arc_window=(0, 80), craft_radius=1.5))
    print("Spawn position:", result.position)
    camera = ThirdPersonCamera(
        params=CameraParams(follow_distance=12.0, height_offset=5.0, lateral_offset=0.0, smoothing=0.3),
        position=result.position - result.forward * 10.0,
        target=result.position,
    )
    camera.update(result.position, result.right, result.up, result.forward, dt=0.016)
    print("Camera position:", camera.position)


if __name__ == "__main__":
    main()
