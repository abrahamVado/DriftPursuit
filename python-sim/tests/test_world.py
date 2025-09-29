import numpy as np
import pytest

from collision import CollisionSystem
from world import MapDescriptor, WorldStreamer


def build_tilemap_descriptor():
    return MapDescriptor.from_mapping(
        {
            "id": "two_tiles",
            "type": "tilemap",
            "tileSize": 100,
            "visibleRadius": 0,
            "tiles": [
                {"coords": [0, 0], "baseHeight": 0.0},
                {"coords": [1, 0], "baseHeight": 5.0},
            ],
            "fallback": {"type": "none"},
        }
    )


def test_streamer_updates_active_tiles():
    descriptor = build_tilemap_descriptor()
    streamer = WorldStreamer(descriptor)

    streamer.update((10.0, 0.0))
    assert (0, 0) in streamer._active_tiles  # pylint: disable=protected-access

    streamer.update((120.0, 0.0))
    assert (1, 0) in streamer._active_tiles  # pylint: disable=protected-access


def test_heightfield_sampling_blends_values():
    descriptor = MapDescriptor.from_mapping(
        {
            "id": "hf",
            "type": "tilemap",
            "tileSize": 100,
            "visibleRadius": 0,
            "tiles": [
                {
                    "coords": [0, 0],
                    "baseHeight": 1.0,
                    "heightfield": {
                        "rows": 2,
                        "cols": 2,
                        "data": [0.0, 1.0, 1.0, 0.0],
                        "scale": {"z": 2.0},
                    },
                }
            ],
            "fallback": {"type": "none"},
        }
    )

    streamer = WorldStreamer(descriptor)
    streamer.update((0.0, 0.0))

    ground_center = streamer.sample_ground_height(0.0, 0.0)
    # Base height 1.0 plus average of heightfield (0.5) scaled by 2.0 -> 2.0
    assert ground_center == pytest.approx(2.0)


def test_collision_system_respects_tile_ground():
    descriptor = MapDescriptor.from_mapping(
        {
            "id": "collisions",
            "type": "tilemap",
            "tileSize": 100,
            "visibleRadius": 1,
            "tiles": [
                {"coords": [0, 0], "baseHeight": 8.0},
            ],
            "fallback": {"type": "procedural"},
        }
    )

    streamer = WorldStreamer(descriptor)
    streamer.update((0.0, 0.0))

    plane = type("Dummy", (), {})()
    plane.pos = np.array([0.0, 0.0, 2.0], dtype=float)
    plane.vel = np.array([0.0, 0.0, -5.0], dtype=float)
    plane.ori = [0.0, 0.0, 0.0]
    plane.tags = []
    plane.manual_override = type("Manual", (), {"disable": lambda self: None})()
    plane.manual_override.disable = lambda: None

    collision_system = CollisionSystem(
        spawn_position=plane.pos.copy(),
        spawn_orientation=plane.ori,
        ground_height_fn=streamer.sample_ground_height,
        start_time=0.0,
    )

    hit, crashed = collision_system.handle_step(plane)
    assert hit is not None
    assert crashed is False
    expected_altitude = 8.0 + collision_system.ground_margin + collision_system.capsule_half_height
    assert plane.pos[2] == pytest.approx(expected_altitude)
