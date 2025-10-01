"""Chunk streaming helper."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, Tuple

from .geometry import ChunkGeometry
from .terrain_generator import TunnelTerrainGenerator


@dataclass
class ChunkStreamer:
    generator: TunnelTerrainGenerator
    band: tuple[int, int] = (-2, 3)
    loaded: Dict[int, ChunkGeometry] = field(default_factory=dict)

    def update(self, current_chunk: int) -> None:
        start = current_chunk + self.band[0]
        end = current_chunk + self.band[1]
        desired = set(index for index in range(start, end + 1) if index >= 0)
        to_unload = [index for index in self.loaded.keys() if index not in desired]
        for index in to_unload:
            del self.loaded[index]
        for index in desired:
            if index not in self.loaded:
                self.loaded[index] = self.generator.generate_chunk(index)

    def band_summary(self) -> str:
        keys = sorted(self.loaded.keys())
        return ", ".join(f"{k}:{self.loaded[k].summary()}" for k in keys)
