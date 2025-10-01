"""Cavern cross-section shaping helpers."""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Tuple

from .noise import noise3, noise3_periodic


@dataclass(frozen=True)
class CavernProfileParams:
    """Parameters describing how the tunnel cross-section is sculpted."""

    base_scale: float
    lobe_centers: Tuple[float, ...]
    lobe_strengths: Tuple[float, ...]
    lobe_width: float
    fractal_octaves: int
    fractal_gain: float
    fractal_lacunarity: float
    twist_frequency: float
    twist_strength: float


def default_cavern_profile() -> CavernProfileParams:
    """Return a profile that yields three interlinked caverns."""

    return CavernProfileParams(
        base_scale=1.35,
        lobe_centers=(math.pi / 2.0, 3.0 * math.pi / 2.0, 0.0),
        lobe_strengths=(0.85, 0.85, 0.55),
        lobe_width=0.9,
        fractal_octaves=4,
        fractal_gain=0.55,
        fractal_lacunarity=2.1,
        twist_frequency=0.018,
        twist_strength=0.65,
    )


def _wrap_angle(angle: float) -> float:
    """Wrap ``angle`` to the ``[-π, π]`` range for smooth comparisons."""

    wrapped = (angle + math.pi) % (2.0 * math.pi)
    return wrapped - math.pi


def lobe_scale(angle: float, profile: CavernProfileParams) -> float:
    """Compute the blended influence of all lobes at ``angle``."""

    if profile.lobe_width <= 0.0:
        return 0.0
    width = profile.lobe_width
    total = 0.0
    for center, strength in zip(profile.lobe_centers, profile.lobe_strengths):
        diff = _wrap_angle(angle - center)
        falloff = math.exp(-0.5 * (diff / width) ** 2)
        total += strength * falloff
    return total


def twist_angle(seed: int, profile: CavernProfileParams, arc_length: float) -> float:
    """Slowly rotate lobes along the path to interlink the caverns."""

    if profile.twist_strength <= 0.0 or profile.twist_frequency <= 0.0:
        return 0.0
    twist = noise3(seed, arc_length * profile.twist_frequency, 0.0, 0.0)
    return twist * profile.twist_strength


def fractal_roughness(
    seed: int,
    profile: CavernProfileParams,
    position: Tuple[float, float, float],
    arc_length: float,
    angle: float,
    frequency: float,
) -> float:
    """Periodic fractal noise that adds rocky detail to the walls."""

    amplitude = 1.0
    total = 0.0
    weight = 0.0
    current_freq = 1.0
    px, py, _ = position
    for octave in range(profile.fractal_octaves):
        sample = noise3_periodic(
            seed + octave * 97,
            px * frequency * current_freq + math.cos(angle) * profile.base_scale,
            py * frequency * current_freq + math.sin(angle) * profile.base_scale,
            arc_length * frequency * current_freq + math.sin(angle * 0.5) * profile.base_scale,
            period=math.tau,
        )
        total += sample * amplitude
        weight += amplitude
        amplitude *= profile.fractal_gain
        current_freq *= profile.fractal_lacunarity
    return total / weight if weight > 0.0 else 0.0
