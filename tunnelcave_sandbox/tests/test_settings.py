"""Tests for generator configuration loading."""
from __future__ import annotations

from tunnelcave_sandbox.src.generation import load_generator_settings


# //1.- Ensure configuration loader parses bundled JSON files correctly.
def test_load_generator_settings_uses_defaults():
    settings = load_generator_settings()
    assert settings.loop.target_length_m > 0
    assert settings.loop.step_size_m > 0
    assert settings.rooms.room_radius_m > 0
    assert 0.0 < settings.rooms.room_probability <= 1.0
    assert settings.clearance.min_radius_m >= settings.clearance.min_clearance_m
    assert settings.clearance.max_radius_m >= settings.clearance.min_radius_m
    assert settings.clearance.sampling_step > 0
    assert settings.clearance.lateral_sample_offsets
    assert settings.world.geometry in {"flat", "sphere"}
    assert settings.world.radius_m > 0
