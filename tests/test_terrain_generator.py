import math
from pathlib import Path
import sys
from typing import Iterable, Tuple

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


def _adjacent_variation(profile: Iterable[float]) -> float:
    values = tuple(profile)
    if not values:
        return 0.0
    diffs = []
    for idx, value in enumerate(values):
        next_value = values[(idx + 1) % len(values)]
        diffs.append(abs(next_value - value))
    return sum(diffs) / len(diffs)


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

    def test_angular_filter_kernel_reduces_profile_variation(self) -> None:
        baseline_params = _make_params(
            rough_amp=1.2,
            rough_freq=0.3,
            rough_filter_kernel=None,
            rough_smoothness=0.0,
        )
        baseline_gen = TunnelTerrainGenerator(baseline_params)
        baseline_gen.generate_chunk(0)
        baseline_profile = baseline_gen.rings()[1].roughness_profile
        baseline_variation = _adjacent_variation(baseline_profile)

        filtered_params = _make_params(
            rough_amp=1.2,
            rough_freq=0.3,
            rough_filter_kernel=(1.0, 2.0, 1.0),
            rough_smoothness=0.0,
        )
        filtered_gen = TunnelTerrainGenerator(filtered_params)
        filtered_gen.generate_chunk(0)
        filtered_profile = filtered_gen.rings()[1].roughness_profile
        filtered_variation = _adjacent_variation(filtered_profile)

        assert filtered_variation < baseline_variation

    def test_forward_rotation_respects_turn_limit(self) -> None:
        limit_rad = math.radians(3.0)
        params = _make_params(max_turn_per_step_rad=limit_rad)
        generator = TunnelTerrainGenerator(params)
        generator.generate_chunk(1)
        rings = generator.rings()
        for prev, curr in zip(rings, rings[1:]):
            dot = max(-1.0, min(1.0, prev.forward.dot(curr.forward)))
            angle = math.acos(dot)
            assert angle <= limit_rad + 1e-5

    def test_minimum_radius_respected_across_rings(self) -> None:
        params = _make_params(radius_base=6.0, rough_amp=5.5)
        generator = TunnelTerrainGenerator(params)
        generator.generate_chunk(2)
        expected_floor = params.radius_base * 0.2 * params.profile.base_scale
        for ring in generator.rings():
            assert min(ring.roughness_profile) >= expected_floor

