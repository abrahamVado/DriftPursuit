"""High-level loop generation orchestrating radius and clearance constraints."""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import List, Sequence, Tuple

from .config import GenerationSeeds
from .divergence_free import DivergenceFreeField, integrate_streamline
from .swept_tube import SweptTube, build_swept_tube
from .settings import GeneratorSettings
from ..world import WorldDescriptor, build_loop_descriptor


# //1.- Describe the generated loop profile for downstream validation and metrics.
@dataclass(frozen=True)
class LoopProfile:
    radii: Sequence[float]
    room_indices: Sequence[int]


# //2.- Capture both the swept tube and supporting profile metadata.
@dataclass(frozen=True)
class LoopGenerationResult:
    tube: SweptTube
    profile: LoopProfile
    descriptor: WorldDescriptor


# //3.- Compute total steps ensuring the loop meets the configured length target.
def _compute_step_count(settings: GeneratorSettings) -> int:
    steps = max(2, int(math.ceil(settings.loop.target_length_m / settings.loop.step_size_m)))
    return steps


# //4.- Produce a deterministic radius profile constrained by configuration bounds.
def _build_radius_profile(
    *,
    path_length: int,
    seeds: GenerationSeeds,
    settings: GeneratorSettings,
) -> Tuple[List[float], List[int]]:
    rng = seeds.create_generators()["path"]
    radii: List[float] = []
    rooms: List[int] = []
    min_radius = max(settings.clearance.min_radius_m, settings.clearance.min_clearance_m)
    max_radius = max(settings.clearance.max_radius_m, min_radius)
    room_radius = min(settings.rooms.room_radius_m, max_radius)
    for index in range(path_length):
        radius = rng.uniform(min_radius, max_radius)
        if rng.random() < settings.rooms.room_probability:
            radius = max(room_radius, min_radius)
            rooms.append(index)
        radius = max(min(radius, max_radius), min_radius)
        radii.append(radius)
    if not rooms and path_length:
        radii[-1] = max(room_radius, min_radius)
        rooms.append(path_length - 1)
    return radii, rooms


# //5.- Attach the starting point to close the loop for a seamless circuit.
def _close_loop(path: List[Sequence[float]]) -> List[Sequence[float]]:
    if path[0] != path[-1]:
        path.append(path[0])
    return path


# //6.- Build swept tube from explicit radius profile for consistent sampling.
def _tube_from_profile(path: Sequence[Sequence[float]], radii: Sequence[float]) -> SweptTube:
    def radius_callback(index: int, total: int) -> float:
        clamped = min(index, len(radii) - 1)
        return float(radii[clamped])

    return build_swept_tube(path, radius=radius_callback)


# //7.- High-level helper generating a single loop instance from seeds.
def generate_loop_tube(
    field: DivergenceFreeField,
    *,
    seeds: GenerationSeeds,
    origin: Sequence[float] = (0.0, 0.0, 0.0),
    settings: GeneratorSettings,
) -> LoopGenerationResult:
    steps = _compute_step_count(settings)
    path = integrate_streamline(
        field,
        seed=origin,
        steps=steps,
        step_size=settings.loop.step_size_m,
    )
    closed_path = _close_loop(list(path))
    radii, rooms = _build_radius_profile(path_length=len(closed_path), seeds=seeds, settings=settings)
    tube = _tube_from_profile(closed_path, radii)
    profile = LoopProfile(radii=tuple(radii), room_indices=tuple(rooms))
    descriptor = build_loop_descriptor(closed_path, profile.radii, profile.room_indices)
    return LoopGenerationResult(tube=tube, profile=profile, descriptor=descriptor)


# //8.- Validate generated tube against clearance constraints producing diagnostics.
def verify_loop_clearance(
    result: LoopGenerationResult,
    *,
    settings: GeneratorSettings,
) -> Tuple[float, float]:
    min_radius = min(result.profile.radii)
    max_radius = max(result.profile.radii)
    average_radius = sum(result.profile.radii) / len(result.profile.radii)
    if min_radius < settings.clearance.min_clearance_m:
        raise ValueError("Generated loop violates minimum clearance constraint")
    if min(result.profile.radii) < settings.clearance.min_radius_m:
        raise ValueError("Generated loop violates minimum radius constraint")
    if max_radius > settings.clearance.max_radius_m:
        raise ValueError("Generated loop violates maximum radius constraint")
    return min_radius, average_radius
