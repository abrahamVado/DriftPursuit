"""Procedural terrain sampler powering the gameplay sandbox."""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Dict, Tuple

from . import vector
from .vector import Vector3

BIOMES = ("plains", "forest", "alpine", "lakeshore")


# //1.- Provide structured information about ground conditions for flight logic.
@dataclass(frozen=True)
class TerrainSample:
    ground_height: float
    ceiling_height: float
    surface_normal: Vector3
    slope_radians: float
    biome: str
    water_height: float
    is_water: bool


# //2.- Generate deterministic gradient noise for world features.
class _GradientNoise:
    def __init__(self, seed: int, frequency: float, amplitude: float) -> None:
        self._seed = int(seed)
        self._frequency = float(frequency)
        self._amplitude = float(amplitude)

    def _hash(self, ix: int, iz: int) -> float:
        value = (self._seed * 374761393 + ix * 668265263 + iz * 2147483647) & 0xFFFFFFFF
        value ^= value >> 13
        value = (value * 1274126177) & 0xFFFFFFFF
        value ^= value >> 16
        return value / 0xFFFFFFFF

    def sample(self, x: float, z: float) -> float:
        scaled_x = x * self._frequency
        scaled_z = z * self._frequency
        ix = math.floor(scaled_x)
        iz = math.floor(scaled_z)
        fx = scaled_x - ix
        fz = scaled_z - iz
        corners = {}
        for dx in (0, 1):
            for dz in (0, 1):
                corners[(dx, dz)] = self._hash(ix + dx, iz + dz)
        x0 = corners[(0, 0)] * (1 - fx) + corners[(1, 0)] * fx
        x1 = corners[(0, 1)] * (1 - fx) + corners[(1, 1)] * fx
        value = x0 * (1 - fz) + x1 * fz
        return (value * 2.0 - 1.0) * self._amplitude


# //3.- Combine multiple octaves of noise to synthesize varied terrain heights.
def _fractal_height(noise_layers: Tuple[_GradientNoise, ...], x: float, z: float) -> float:
    return sum(layer.sample(x, z) for layer in noise_layers)


# //4.- Categorize biome types using a slower noise field.
def _biome_tag(biome_noise: _GradientNoise, x: float, z: float) -> str:
    value = biome_noise.sample(x, z)
    normalized = (value + biome_noise._amplitude) / (2 * biome_noise._amplitude or 1.0)
    index = int(normalized * len(BIOMES)) % len(BIOMES)
    return BIOMES[index]


# //5.- Estimate surface normals using central differences for lighting and collisions.
def _estimate_normal(height_func, x: float, z: float, epsilon: float = 0.5) -> Vector3:
    h_x1 = height_func(x + epsilon, z)
    h_x0 = height_func(x - epsilon, z)
    h_z1 = height_func(x, z + epsilon)
    h_z0 = height_func(x, z - epsilon)
    normal = vector.normalize((-(h_x1 - h_x0), 2 * epsilon, -(h_z1 - h_z0)))
    return normal


# //6.- Terrain sampler orchestrating height, slope, and biome calculations.
class TerrainSampler:
    def __init__(self, seed: int, planet_radius: float = 6000.0) -> None:
        # //1.- Persist the deterministic seed so every subsystem samples the same planetary surface.
        self._seed = int(seed)
        # //2.- Remember the spherical planet parameters so callers can reason about curvature.
        self._planet_radius = float(planet_radius)
        self._planet_center: Vector3 = (0.0, -self._planet_radius, 0.0)
        self._planet_radius_sq = self._planet_radius * self._planet_radius
        # //3.- Prepare layered noise sources that sculpt mountain ranges atop the spherical shell.
        self._height_layers = (
            _GradientNoise(seed * 5 + 1, 0.003, 40.0),
            _GradientNoise(seed * 7 + 2, 0.01, 12.0),
            _GradientNoise(seed * 11 + 3, 0.05, 2.0),
        )
        # //4.- Additional noise fields control cavern ceilings, inland seas, and biome tags.
        self._ceiling_noise = _GradientNoise(seed * 13 + 4, 0.004, 20.0)
        self._water_noise = _GradientNoise(seed * 17 + 5, 0.002, 6.0)
        self._biome_noise = _GradientNoise(seed * 19 + 6, 0.001, 1.0)
        # //5.- Cache integer cell samples because flight queries routinely revisit nearby tiles.
        self._cache: Dict[Tuple[int, int], TerrainSample] = {}

    @property
    def planet_radius(self) -> float:
        # //6.- Expose the configured radius so gameplay systems can anchor orbital maths in tests.
        return self._planet_radius

    @property
    def planet_center(self) -> Vector3:
        # //7.- Publish the planet center allowing callers to build radial vectors for navigation.
        return self._planet_center

    def _planet_shell_height(self, x: float, z: float) -> float:
        # //8.- Solve the sphere equation so the base terrain hugs the interior of the planet shell.
        dx = x - self._planet_center[0]
        dz = z - self._planet_center[2]
        distance_sq = dx * dx + dz * dz
        interior = max(self._planet_radius_sq - min(distance_sq, self._planet_radius_sq), 0.0)
        return self._planet_center[1] + math.sqrt(interior)

    def _terrain_offset(self, x: float, z: float) -> float:
        # //9.- Layer fractal noise so the spherical ground receives varied elevations and valleys.
        return _fractal_height(self._height_layers, x, z)

    def _ground_height(self, x: float, z: float) -> float:
        # //10.- Combine the spherical shell with displacement noise to form the actual surface height.
        return self._planet_shell_height(x, z) + self._terrain_offset(x, z)

    def _water_height(self, x: float, z: float) -> float:
        # //11.- Keep lakes conforming to curvature by offsetting from the shell before adding ripples.
        return self._planet_shell_height(x, z) + self._water_noise.sample(x, z) - 8.0

    def _ceiling_height(self, ground: float, x: float, z: float) -> float:
        # //12.- Stretch caverns above the ground height so the underground sky respects the surface.
        caverns = max(self._ceiling_noise.sample(x, z) + 30.0, 15.0)
        return ground + caverns

    def _sample_uncached(self, x: float, z: float) -> TerrainSample:
        # //13.- Produce the authoritative sample with normals aligned to the spherical curvature.
        ground = self._ground_height(x, z)
        water = self._water_height(x, z)
        ceiling = self._ceiling_height(ground, x, z)
        normal = _estimate_normal(self._ground_height, x, z)
        slope = math.acos(max(min(vector.dot(normal, (0.0, 1.0, 0.0)), 1.0), -1.0))
        biome = _biome_tag(self._biome_noise, x, z)
        is_water = ground <= water
        return TerrainSample(
            ground_height=ground,
            ceiling_height=ceiling,
            surface_normal=normal,
            slope_radians=slope,
            biome=biome,
            water_height=water,
            is_water=is_water,
        )

    def sample(self, x: float, z: float) -> TerrainSample:
        # //14.- Cache lookups by integer tile so repeated sampling over the planet remains fast.
        key = (int(math.floor(x)), int(math.floor(z)))
        if key not in self._cache:
            self._cache[key] = self._sample_uncached(x, z)
        return self._cache[key]
