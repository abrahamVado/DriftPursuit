"""World streaming helpers for the Python simulator.

This module mirrors the viewer's notion of maps so the simulator can apply
ground collisions against either authored tiles or procedural terrain.  The
``WorldStreamer`` keeps a small window of tiles around the aircraft loaded and
provides a ground-height callback that plugs directly into the
``CollisionSystem``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import math
from typing import Dict, Mapping, Optional, Sequence, Tuple

import numpy as np


DEFAULT_CHUNK_SIZE = 900.0
DEFAULT_VISIBLE_RADIUS = 2


def _to_float(value: object, default: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    if not math.isfinite(number):
        return default
    return number


def _clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(value, maximum))


@dataclass(frozen=True)
class HeightfieldDescriptor:
    rows: int
    cols: int
    samples: Tuple[float, ...]
    scale_z: float = 1.0

    @classmethod
    def from_mapping(cls, payload: Mapping[str, object]) -> "HeightfieldDescriptor":
        rows = int(_to_float(payload.get("rows") or payload.get("height") or 0, 0))
        cols = int(_to_float(payload.get("cols") or payload.get("width") or 0, 0))
        data = payload.get("data")
        if not rows or not cols or not isinstance(data, Sequence):
            raise ValueError("Heightfield descriptor must define rows, cols and a data array")
        if len(data) != rows * cols:
            raise ValueError("Heightfield descriptor expected rows*cols samples")

        scale = payload.get("scale") or payload.get("metersPerSample")
        scale_z = payload.get("scaleZ") or payload.get("heightScale")
        if isinstance(scale, Mapping):
            scale_z = scale.get("z") if scale_z is None else scale_z
        if isinstance(scale, Sequence) and len(scale) > 2:
            scale_z = scale[2]

        samples = tuple(float(sample) for sample in data)
        return cls(rows=rows, cols=cols, samples=samples, scale_z=_to_float(scale_z, 1.0))


@dataclass(frozen=True)
class TileDescriptor:
    coords: Tuple[int, int]
    base_height: float = 0.0
    heightfield: Optional[HeightfieldDescriptor] = None

    @classmethod
    def from_mapping(cls, payload: Mapping[str, object]) -> "TileDescriptor":
        coords_value = payload.get("coords") or payload.get("coordinates")
        if not isinstance(coords_value, Sequence) or len(coords_value) < 2:
            raise ValueError("Tile descriptor must define coords as a two element array")
        coords = (int(coords_value[0]), int(coords_value[1]))
        base_height = _to_float(
            payload.get("baseHeight")
            or payload.get("base_height")
            or payload.get("elevation")
            or 0.0,
            0.0,
        )
        heightfield_payload = payload.get("heightfield")
        heightfield = None
        if isinstance(heightfield_payload, Mapping):
            heightfield = HeightfieldDescriptor.from_mapping(heightfield_payload)
        return cls(coords=coords, base_height=base_height, heightfield=heightfield)


@dataclass
class MapDescriptor:
    id: str
    type: str = "procedural"
    chunk_size: float = DEFAULT_CHUNK_SIZE
    visible_radius: int = DEFAULT_VISIBLE_RADIUS
    tiles: Dict[Tuple[int, int], TileDescriptor] = field(default_factory=dict)
    fallback_type: str = "procedural"

    @classmethod
    def procedural(
        cls,
        *,
        map_id: str = "procedural:endless",
        chunk_size: float = DEFAULT_CHUNK_SIZE,
        visible_radius: int = DEFAULT_VISIBLE_RADIUS,
    ) -> "MapDescriptor":
        return cls(
            id=map_id,
            type="procedural",
            chunk_size=chunk_size,
            visible_radius=visible_radius,
            tiles={},
            fallback_type="procedural",
        )

    @classmethod
    def from_mapping(cls, payload: Mapping[str, object]) -> "MapDescriptor":
        if not isinstance(payload, Mapping):
            raise ValueError("Map descriptor must be a mapping")

        map_id = str(payload.get("id") or payload.get("map_id") or "custom")
        map_type = str(payload.get("type") or payload.get("kind") or "procedural")
        if map_type not in {"procedural", "tilemap"}:
            raise ValueError(f"Unsupported map type '{map_type}'")

        if map_type == "tilemap":
            chunk_size = _to_float(payload.get("tileSize"), DEFAULT_CHUNK_SIZE)
        else:
            chunk_size = _to_float(payload.get("chunkSize"), DEFAULT_CHUNK_SIZE)

        radius_value = payload.get("visibleRadius")
        visible_radius = int(_to_float(radius_value, DEFAULT_VISIBLE_RADIUS))

        tiles: Dict[Tuple[int, int], TileDescriptor] = {}
        if map_type == "tilemap":
            raw_tiles = payload.get("tiles")
            if isinstance(raw_tiles, Sequence):
                for entry in raw_tiles:
                    if isinstance(entry, Mapping):
                        tile = TileDescriptor.from_mapping(entry)
                        tiles[tile.coords] = tile

        fallback = payload.get("fallback") or {}
        fallback_type = str(fallback.get("type") or "procedural").lower()

        return cls(
            id=map_id,
            type=map_type,
            chunk_size=chunk_size if chunk_size > 0 else DEFAULT_CHUNK_SIZE,
            visible_radius=visible_radius if visible_radius > 0 else DEFAULT_VISIBLE_RADIUS,
            tiles=tiles,
            fallback_type=fallback_type,
        )


class _HeightfieldSampler:
    def __init__(self, descriptor: HeightfieldDescriptor, chunk_size: float) -> None:
        self.rows = max(1, int(descriptor.rows))
        self.cols = max(1, int(descriptor.cols))
        self.scale_z = float(descriptor.scale_z)
        self.chunk_size = float(chunk_size)
        self._data = np.array(descriptor.samples, dtype=float).reshape(self.rows, self.cols)

    def sample(self, local_x: float, local_y: float) -> float:
        if self.rows == 1 and self.cols == 1:
            return float(self._data[0, 0] * self.scale_z)

        u = (local_x / self.chunk_size) + 0.5
        v = (local_y / self.chunk_size) + 0.5
        u = _clamp(u, 0.0, 0.999999)
        v = _clamp(v, 0.0, 0.999999)
        col = u * (self.cols - 1)
        row = v * (self.rows - 1)

        c0 = int(math.floor(col))
        c1 = min(c0 + 1, self.cols - 1)
        r0 = int(math.floor(row))
        r1 = min(r0 + 1, self.rows - 1)

        tx = col - c0
        ty = row - r0

        h00 = self._data[r0, c0]
        h01 = self._data[r0, c1]
        h10 = self._data[r1, c0]
        h11 = self._data[r1, c1]

        h0 = h00 * (1.0 - tx) + h01 * tx
        h1 = h10 * (1.0 - tx) + h11 * tx
        value = h0 * (1.0 - ty) + h1 * ty
        return float(value * self.scale_z)


class _Tile:
    def __init__(self, descriptor: TileDescriptor, chunk_size: float) -> None:
        self.coords = descriptor.coords
        self.chunk_size = float(chunk_size)
        self.base_height = float(descriptor.base_height)
        self.center = np.array(
            [self.coords[0] * self.chunk_size, self.coords[1] * self.chunk_size], dtype=float
        )
        self._heightfield_sampler = (
            _HeightfieldSampler(descriptor.heightfield, self.chunk_size)
            if descriptor.heightfield is not None
            else None
        )

    def contains(self, x: float, y: float) -> bool:
        local = np.array([x, y], dtype=float) - self.center
        half = self.chunk_size * 0.5
        return abs(local[0]) <= half and abs(local[1]) <= half

    def ground_height(self, x: float, y: float) -> float:
        local_x = x - self.center[0]
        local_y = y - self.center[1]
        height = self.base_height
        if self._heightfield_sampler is not None:
            height += self._heightfield_sampler.sample(local_x, local_y)
        return float(height)


class _ProceduralTile:
    def __init__(self, chunk_size: float) -> None:
        self.chunk_size = float(chunk_size)

    def ground_height(self, _x: float, _y: float) -> float:
        return 0.0


class WorldStreamer:
    """Maintain a sliding window of map tiles around a focus point."""

    def __init__(self, descriptor: Optional[MapDescriptor] = None) -> None:
        self._descriptor = descriptor or MapDescriptor.procedural()
        self.chunk_size = float(self._descriptor.chunk_size)
        self.visible_radius = int(self._descriptor.visible_radius)
        self._tile_cache: Dict[Tuple[int, int], _Tile] = {}
        self._active_tiles: Dict[Tuple[int, int], _Tile] = {}
        self._last_center: Optional[Tuple[int, int]] = None
        self._fallback_tile = _ProceduralTile(self.chunk_size)
        self._bounds: Optional[Tuple[float, float, float, float]] = None
        self.apply_descriptor(self._descriptor)

    @property
    def descriptor(self) -> MapDescriptor:
        return self._descriptor

    def apply_descriptor(self, descriptor: MapDescriptor) -> None:
        self._descriptor = descriptor
        self.chunk_size = float(descriptor.chunk_size or DEFAULT_CHUNK_SIZE)
        self.visible_radius = max(1, int(descriptor.visible_radius or DEFAULT_VISIBLE_RADIUS))
        self._tile_cache = {
            coords: _Tile(tile_descriptor, self.chunk_size)
            for coords, tile_descriptor in descriptor.tiles.items()
        }
        self._active_tiles.clear()
        self._last_center = None
        self._fallback_tile = _ProceduralTile(self.chunk_size)
        self._bounds = self._compute_bounds(descriptor)

    def _compute_bounds(self, descriptor: MapDescriptor) -> Optional[Tuple[float, float, float, float]]:
        if descriptor.type != "tilemap":
            return None
        if descriptor.fallback_type != "none" and descriptor.fallback_type != "finite":
            # Infinite world due to procedural fallback.
            if descriptor.fallback_type == "procedural":
                return None

        if not descriptor.tiles:
            return None

        xs = [coords[0] for coords in descriptor.tiles]
        ys = [coords[1] for coords in descriptor.tiles]
        half = descriptor.chunk_size * 0.5
        min_x = min(xs) * descriptor.chunk_size - half
        max_x = max(xs) * descriptor.chunk_size + half
        min_y = min(ys) * descriptor.chunk_size - half
        max_y = max(ys) * descriptor.chunk_size + half
        return float(min_x), float(max_x), float(min_y), float(max_y)

    def update(self, focus_xy: Sequence[float]) -> None:
        if focus_xy is None:
            return
        fx = float(focus_xy[0])
        fy = float(focus_xy[1])
        chunk_size = self.chunk_size if self.chunk_size else DEFAULT_CHUNK_SIZE
        center_x = int(math.floor(fx / chunk_size))
        center_y = int(math.floor(fy / chunk_size))

        if self._last_center == (center_x, center_y) and self._active_tiles:
            return

        needed: Dict[Tuple[int, int], _Tile] = {}
        for dx in range(-self.visible_radius, self.visible_radius + 1):
            for dy in range(-self.visible_radius, self.visible_radius + 1):
                coords = (center_x + dx, center_y + dy)
                tile = self._tile_cache.get(coords)
                if tile is None:
                    if self._descriptor.type == "tilemap" and coords not in self._descriptor.tiles:
                        if self._descriptor.fallback_type == "procedural":
                            tile = _ProceduralTile(self.chunk_size)
                        else:
                            tile = None
                    else:
                        tile = _ProceduralTile(self.chunk_size)
                if tile is not None:
                    needed[coords] = tile

        self._active_tiles = needed
        self._last_center = (center_x, center_y)

    def sample_ground_height(self, x: float, y: float) -> float:
        chunk_size = self.chunk_size if self.chunk_size else DEFAULT_CHUNK_SIZE
        chunk_x = int(math.floor(float(x) / chunk_size))
        chunk_y = int(math.floor(float(y) / chunk_size))
        tile = self._active_tiles.get((chunk_x, chunk_y))
        if tile is None:
            tile = self._tile_cache.get((chunk_x, chunk_y))
        if tile is None:
            return float(self._fallback_tile.ground_height(x, y))
        return float(tile.ground_height(x, y))

    def ensure_position_within_bounds(self, position: Sequence[float]) -> Tuple[np.ndarray, bool]:
        pos_array = np.array(position, dtype=float)
        bounds = self._bounds
        if bounds is None:
            return pos_array, False

        min_x, max_x, min_y, max_y = bounds
        snapped = False
        margin = min(self.chunk_size * 0.45, 50.0)

        if pos_array[0] < min_x + margin:
            pos_array[0] = min_x + margin
            snapped = True
        elif pos_array[0] > max_x - margin:
            pos_array[0] = max_x - margin
            snapped = True

        if pos_array[1] < min_y + margin:
            pos_array[1] = min_y + margin
            snapped = True
        elif pos_array[1] > max_y - margin:
            pos_array[1] = max_y - margin
            snapped = True

        if snapped:
            ground = self.sample_ground_height(pos_array[0], pos_array[1])
            target_altitude = ground + 120.0
            if pos_array[2] < target_altitude:
                pos_array[2] = target_altitude

        return pos_array, snapped

    def summary(self) -> Mapping[str, object]:
        return {
            "map_id": self._descriptor.id,
            "type": self._descriptor.type,
            "chunk_size": self.chunk_size,
            "visible_radius": self.visible_radius,
        }


__all__ = ["MapDescriptor", "WorldStreamer"]

