import math
from pathlib import Path
import sys
from typing import Tuple

import pytest

# Ensure the tunnelcave package is importable when running tests from repo root.
REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from tunnelcave_sandbox.profile import default_cavern_profile  # noqa: E402
from tunnelcave_sandbox.terrain_generator import (  # noqa: E402
    TunnelParams,
    TunnelTerrainGenerator,
)


def _make_params(**overrides: object) -> TunnelParams:
    base = dict(
        world_seed=1234,
        chunk_length=30.0,
        ring_step=3.0,
        tube_sides=16,
        dir_freq=0.05,
        dir_blend=0.65,
        radius_base=8.0,
        radius_var=0.0,
        radius_freq=0.0,
        rough_amp=0.9,
        rough_freq=0.1,
        rough_smoothness=0.0,
        rough_filter_kernel=None,
        jolt_every_meters=10_000.0,
        jolt_strength=0.0,
        max_turn_per_step_rad=math.radians(5.0),
        mode="mesh",
        profile=default_cavern_profile(),
    )
    base.update(overrides)
    return TunnelParams(**base)


def _avg_abs_diff(a: Tuple[float, ...], b: Tuple[float, ...]) -> float:
    return sum(abs(x - y) for x, y in zip(a, b)) / len(a)


class TestTunnelTerrainGenerator:
    def test_roughness_smoothing_reduces_jump_between_rings(self) -> None:
        no_smoothing_params = _make_params(rough_smoothness=0.0)
        no_smoothing_gen = TunnelTerrainGenerator(no_smoothing_params)
        no_smoothing_gen.generate_chunk(0)
        raw_rings = no_smoothing_gen.rings()
        baseline_diff = _avg_abs_diff(
            raw_rings[0].roughness_profile, raw_rings[1].roughness_profile
        )

        smoothed_params = _make_params(rough_smoothness=0.85)
        smoothed_gen = TunnelTerrainGenerator(smoothed_params)
        smoothed_gen.generate_chunk(0)
        smoothed_rings = smoothed_gen.rings()
        smoothed_diff = _avg_abs_diff(
            smoothed_rings[0].roughness_profile, smoothed_rings[1].roughness_profile
        )

        assert smoothed_diff < baseline_diff

    def test_invalid_smoothness_range_is_rejected(self) -> None:
        with pytest.raises(ValueError):
            TunnelTerrainGenerator(_make_params(rough_smoothness=-0.1))

        with pytest.raises(ValueError):
            TunnelTerrainGenerator(_make_params(rough_smoothness=1.1))

