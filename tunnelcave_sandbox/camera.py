"""Third-person camera smoothing utilities."""
from __future__ import annotations

from dataclasses import dataclass

from .vector import Vector3


@dataclass
class CameraParams:
    follow_distance: float
    height_offset: float
    lateral_offset: float
    smoothing: float


@dataclass
class ThirdPersonCamera:
    params: CameraParams
    position: Vector3
    target: Vector3

    def update(self, ship_position: Vector3, frame_right: Vector3, frame_up: Vector3, frame_forward: Vector3, dt: float) -> None:
        desired = (
            ship_position
            - frame_forward * self.params.follow_distance
            + frame_right * self.params.lateral_offset
            + frame_up * self.params.height_offset
        )
        lerp_factor = 1.0 - pow(0.5, dt / max(1e-4, self.params.smoothing))
        self.position = self.position * (1.0 - lerp_factor) + desired * lerp_factor
        self.target = self.target * (1.0 - lerp_factor) + ship_position * lerp_factor
