"""Structured loader for tunnel generation settings."""
from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import List, Sequence


# //1.- Capture loop settings controlling total distance and integration step.
@dataclass(frozen=True)
class LoopSettings:
    target_length_m: float
    step_size_m: float


# //2.- Record room expansion behaviour sourced from configuration files.
@dataclass(frozen=True)
class RoomSettings:
    room_radius_m: float
    room_probability: float


# //3.- Encapsulate clearance and radius bounds for generated tubes.
@dataclass(frozen=True)
class ClearanceSettings:
    min_clearance_m: float
    target_average_clearance_m: float
    min_radius_m: float
    max_radius_m: float
    sampling_step: float
    lateral_sample_offsets: Sequence[Sequence[float]]


# //4.- Aggregate complete generator settings for downstream modules.
@dataclass(frozen=True)
class GeneratorSettings:
    loop: LoopSettings
    rooms: RoomSettings
    clearance: ClearanceSettings


# //5.- Resolve repository default configuration directory lazily.
def _default_config_directory() -> str:
    base_dir = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
    return os.path.join(base_dir, "config")


# //6.- Load a single JSON configuration file and coerce to dictionary.
def _read_json_config(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


# //7.- Construct loop settings from on-disk JSON configuration.
def _load_loop_settings(config_dir: str) -> LoopSettings:
    payload = _read_json_config(os.path.join(config_dir, "loop.json"))
    return LoopSettings(
        target_length_m=float(payload["target_length_m"]),
        step_size_m=float(payload["step_size_m"]),
    )


# //8.- Build room settings while normalizing diameter to radius units.
def _load_room_settings(config_dir: str) -> RoomSettings:
    payload = _read_json_config(os.path.join(config_dir, "rooms.json"))
    diameter = float(payload.get("room_diameter_m", 0.0))
    radius = float(payload.get("room_radius_m", diameter / 2 if diameter else 0.0))
    return RoomSettings(
        room_radius_m=radius,
        room_probability=float(payload["room_probability"]),
    )


# //9.- Interpret clearance configuration including sampling metadata.
def _load_clearance_settings(config_dir: str) -> ClearanceSettings:
    payload = _read_json_config(os.path.join(config_dir, "clearance.json"))
    offsets: List[List[float]] = []
    for vector in payload["lateral_sample_offsets"]:
        offsets.append([float(component) for component in vector])
    return ClearanceSettings(
        min_clearance_m=float(payload["min_clearance_m"]),
        target_average_clearance_m=float(payload["target_average_clearance_m"]),
        min_radius_m=float(payload["min_radius_m"]),
        max_radius_m=float(payload["max_radius_m"]),
        sampling_step=float(payload["sampling_step"]),
        lateral_sample_offsets=tuple(tuple(item for item in vector) for vector in offsets),
    )


# //10.- Public helper assembling full generator settings bundle.
def load_generator_settings(config_dir: str | None = None) -> GeneratorSettings:
    directory = config_dir or _default_config_directory()
    loop = _load_loop_settings(directory)
    rooms = _load_room_settings(directory)
    clearance = _load_clearance_settings(directory)
    return GeneratorSettings(loop=loop, rooms=rooms, clearance=clearance)
