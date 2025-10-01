"""Tunnelcave sandbox package.

This package bundles all logic required to generate an endless cave
environment following the "Tunnelcave Sandbox" specification. The
modules are intentionally small so every file stays well below the
800-line limit requested by the user.
"""

from .vector import Vector3
from .noise import NoiseConfig, noise3
from .direction_field import DivergenceFreeField
from .frame import OrthonormalFrame
from .geometry import RingSample, ChunkGeometry
from .terrain_generator import TunnelTerrainGenerator, TunnelParams
from .probe import RingProbe
from .spawn import SpawnPlanner, SpawnRequest, SpawnResult
from .streaming import ChunkStreamer
from .camera import ThirdPersonCamera

__all__ = [
    "Vector3",
    "NoiseConfig",
    "noise3",
    "DivergenceFreeField",
    "OrthonormalFrame",
    "RingSample",
    "ChunkGeometry",
    "TunnelTerrainGenerator",
    "TunnelParams",
    "RingProbe",
    "SpawnPlanner",
    "SpawnRequest",
    "SpawnResult",
    "ChunkStreamer",
    "ThirdPersonCamera",
]
