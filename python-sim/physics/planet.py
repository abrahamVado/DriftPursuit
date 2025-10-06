"""Procedural planet generation utilities based on signed distance fields."""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from typing import Dict, Iterable, Iterator, List, Mapping, MutableMapping, Optional, Sequence, Tuple

from .sdf import SignedDistanceField
from .penetration import BodyState

Vector3 = Tuple[float, float, float]


@dataclass(frozen=True)
class NoiseOctave:
    """Single octave describing frequency and amplitude for fractal noise."""

    frequency: float
    amplitude: float


@dataclass(frozen=True)
class PlanetSpec:
    """Configuration object defining the deterministic planet parameters."""

    seed: int
    radius: float
    atmosphere_height: float
    sea_level: float
    displacement_octaves: Tuple[NoiseOctave, ...]
    temperature_frequency: float
    moisture_frequency: float
    biome_blend: float
    lod_distances: Tuple[float, ...]
    scatter_seed: int
    scatter_radius: float
    scatter_density: float
    river_resolution: int
    river_threshold: float
    river_carve: float

    @staticmethod
    def from_json(spec: Mapping[str, object] | str) -> "PlanetSpec":
        """Instantiate a specification object from JSON text or mapping."""

        if isinstance(spec, str):
            # //1.- Parse JSON strings to obtain the raw mapping data.
            data = json.loads(spec)
        else:
            data = dict(spec)
        octaves_source = data.get("displacement_octaves", [])
        if not octaves_source:
            raise ValueError("displacement_octaves must define at least one octave")
        # //2.- Convert the octave dictionaries into immutable dataclass instances.
        octaves = tuple(
            NoiseOctave(
                frequency=float(entry["frequency"]),
                amplitude=float(entry["amplitude"]),
            )
            for entry in octaves_source
        )
        lod_values = tuple(float(distance) for distance in data.get("lod_distances", []))
        if not lod_values:
            raise ValueError("lod_distances must include at least one threshold")
        river_resolution = int(data.get("river_resolution", 32))
        if river_resolution <= 1:
            raise ValueError("river_resolution must exceed one to build flow gradients")
        # //3.- Normalize the dictionary to supply defaults for optional parameters.
        return PlanetSpec(
            seed=int(data["seed"]),
            radius=float(data["radius"]),
            atmosphere_height=float(data.get("atmosphere_height", 0.0)),
            sea_level=float(data.get("sea_level", 0.0)),
            displacement_octaves=octaves,
            temperature_frequency=float(data.get("temperature_frequency", 0.1)),
            moisture_frequency=float(data.get("moisture_frequency", 0.1)),
            biome_blend=float(data.get("biome_blend", 0.2)),
            lod_distances=lod_values,
            scatter_seed=int(data.get("scatter_seed", data["seed"])) ,
            scatter_radius=float(data.get("scatter_radius", 20.0)),
            scatter_density=float(data.get("scatter_density", 5.0)),
            river_resolution=river_resolution,
            river_threshold=float(data.get("river_threshold", 4.0)),
            river_carve=float(data.get("river_carve", 30.0)),
        )


class DeterministicNoise:
    """Seeded value-noise generator operating on unit direction vectors."""

    def __init__(self, seed: int):
        self._seed = int(seed)

    def sample(self, direction: Sequence[float], frequency: float) -> float:
        """Evaluate deterministic value noise at the provided direction."""

        # //1.- Normalize the direction to avoid seams during cubed-sphere sampling.
        direction_vec = _normalize(direction)
        scaled = (
            direction_vec[0] * frequency,
            direction_vec[1] * frequency,
            direction_vec[2] * frequency,
        )
        # //2.- Fetch the surrounding lattice cell for value noise interpolation.
        base = (math.floor(scaled[0]), math.floor(scaled[1]), math.floor(scaled[2]))
        fractions = (
            scaled[0] - base[0],
            scaled[1] - base[1],
            scaled[2] - base[2],
        )
        accum = 0.0
        for corner_x in (0, 1):
            for corner_y in (0, 1):
                for corner_z in (0, 1):
                    lattice = (
                        base[0] + corner_x,
                        base[1] + corner_y,
                        base[2] + corner_z,
                    )
                    weight = _fade(fractions[0], corner_x) * _fade(
                        fractions[1], corner_y
                    ) * _fade(fractions[2], corner_z)
                    accum += weight * _hash_float(lattice, self._seed)
        # //3.- Rescale the noise to the familiar -1..1 interval.
        return accum * 2.0 - 1.0


class PlanetDisplacementField:
    """Height displacement using fractal noise and coarse river carving."""

    def __init__(self, spec: PlanetSpec):
        self._spec = spec
        self._noise = DeterministicNoise(spec.seed)
        self._river_cache = _build_river_cache(spec, self._noise)

    def displacement(self, direction: Sequence[float]) -> float:
        """Compute the deterministic displacement along a unit direction vector."""

        dir_vec = _normalize(direction)
        value = 0.0
        amplitude_sum = 0.0
        # //1.- Aggregate all octaves to form a fractal Brownian motion field.
        for octave in self._spec.displacement_octaves:
            value += self._noise.sample(dir_vec, octave.frequency) * octave.amplitude
            amplitude_sum += abs(octave.amplitude)
        if amplitude_sum == 0.0:
            return 0.0
        normalized = value / amplitude_sum
        # //2.- Blend in river carving by reducing height along accumulated flow lines.
        river_strength = _sample_river(self._river_cache, dir_vec)
        carved = normalized - river_strength * self._spec.river_carve / max(
            1.0, self._spec.radius
        )
        return carved


class PlanetSDF(SignedDistanceField):
    """Signed distance field describing the procedural planet surface."""

    def __init__(self, spec: PlanetSpec):
        self._spec = spec
        self._displacement_field = PlanetDisplacementField(spec)

        def sampler(point: Vector3) -> float:
            # //1.- Compute radial distance from the planet center at the origin.
            radius = _length(point)
            if radius == 0.0:
                return -spec.radius
            direction = (
                point[0] / radius,
                point[1] / radius,
                point[2] / radius,
            )
            displacement = self._displacement_field.displacement(direction)
            surface_radius = spec.radius + displacement
            # //2.- Subtract the displaced radius from the radial length for the SDF.
            return radius - surface_radius

        super().__init__(sampler)

    def clamp_height(self, point: Sequence[float], clearance: float = 0.0) -> Vector3:
        """Project a point into the valid altitude band between terrain and atmosphere."""

        vec = _to_vec3(point)
        radius = _length(vec)
        if radius == 0.0:
            raise ValueError("point must not be located at the planet center")
        direction = _normalize(vec)
        displacement = self._displacement_field.displacement(direction)
        terrain_radius = self._spec.radius + displacement + clearance
        atmosphere_radius = self._spec.radius + self._spec.atmosphere_height
        clamped_radius = min(max(radius, terrain_radius), atmosphere_radius)
        # //1.- Scale the direction by the constrained radius to clamp the height.
        return (
            direction[0] * clamped_radius,
            direction[1] * clamped_radius,
            direction[2] * clamped_radius,
        )

    def atmosphere_contains(self, point: Sequence[float]) -> bool:
        """Check whether the point lies within the spherical atmosphere shell."""

        return _length(point) <= self._spec.radius + self._spec.atmosphere_height

    def biome_at(self, point: Sequence[float]) -> str:
        """Determine the biome string at the provided 3D position."""

        direction = _normalize(point)
        temperature = _remap(self._displacement_field, direction, self._spec.temperature_frequency)
        moisture = _remap(self._displacement_field, direction, self._spec.moisture_frequency)
        altitude = -self.sample(direction)
        if altitude < self._spec.sea_level:
            return "ocean"
        # //1.- Partition the climate grid using temperature and moisture thresholds.
        if temperature > 0.6:
            return "desert" if moisture < 0.4 else "savanna"
        if temperature > 0.3:
            return "grassland" if moisture < 0.6 else "forest"
        return "tundra" if moisture < 0.5 else "taiga"

    def advance_surface_body(
        self,
        state: BodyState,
        *,
        radius: float,
        dt: float,
        clearance: float = 0.0,
        normal_epsilon: float = 1e-3,
    ) -> "PlanetSurfaceAdvance":
        """Integrate a surface vehicle while enforcing the spherical altitude band."""

        if radius < 0.0:
            raise ValueError("radius must be non-negative for surface vehicles")
        # //1.- Advance the position using explicit Euler integration in planet-fixed space.
        predicted_position = (
            state.position[0] + state.velocity[0] * dt,
            state.position[1] + state.velocity[1] * dt,
            state.position[2] + state.velocity[2] * dt,
        )
        try:
            direction = _normalize(predicted_position)
        except ValueError:
            direction = _normalize(state.position)
        displacement = self._displacement_field.displacement(direction)
        terrain_radius = self._spec.radius + displacement + clearance + radius
        atmosphere_radius = self._spec.radius + self._spec.atmosphere_height
        clamped_radius = min(max(terrain_radius, 0.0), atmosphere_radius)
        clamped_position = (
            direction[0] * clamped_radius,
            direction[1] * clamped_radius,
            direction[2] * clamped_radius,
        )
        # //2.- Sample the SDF gradient to provide a world-space surface normal.
        normal = self.surface_normal(clamped_position, epsilon=normal_epsilon)
        # //3.- Project the velocity onto the tangent plane to remain glued to the surface.
        normal_speed = _dot(state.velocity, normal)
        tangential_velocity = (
            state.velocity[0] - normal[0] * normal_speed,
            state.velocity[1] - normal[1] * normal_speed,
            state.velocity[2] - normal[2] * normal_speed,
        )
        # //4.- Derive the residual clearance between the hull and displaced surface.
        altitude = max(0.0, self.sample(clamped_position) - radius)
        next_state = BodyState(position=clamped_position, velocity=tangential_velocity)
        return PlanetSurfaceAdvance(state=next_state, normal=normal, clearance=altitude)


@dataclass(frozen=True)
class PlanetSurfaceAdvance:
    """Result of advancing a body constrained to the procedural planet."""

    state: BodyState
    normal: Vector3
    clearance: float


@dataclass(frozen=True)
class CubedSphereTile:
    """Single quadtree tile on a cubed sphere layout."""

    face: int
    i: int
    j: int
    lod: int

    def parent(self) -> Optional["CubedSphereTile"]:
        """Return the parent tile in the quadtree hierarchy."""

        if self.lod == 0:
            return None
        # //1.- Integer division collapses the tile coordinates into their parent.
        return CubedSphereTile(self.face, self.i // 2, self.j // 2, self.lod - 1)

    def children(self) -> Tuple["CubedSphereTile", ...]:
        """Return the four child tiles with edge-consistent indexing."""

        next_lod = self.lod + 1
        base_i = self.i * 2
        base_j = self.j * 2
        # //1.- The children subdivide the square into four quadrants.
        return (
            CubedSphereTile(self.face, base_i, base_j, next_lod),
            CubedSphereTile(self.face, base_i + 1, base_j, next_lod),
            CubedSphereTile(self.face, base_i, base_j + 1, next_lod),
            CubedSphereTile(self.face, base_i + 1, base_j + 1, next_lod),
        )

    def resolution(self) -> int:
        """Return the tessellation resolution along one edge."""

        # //1.- Each level doubles the vertex count per edge.
        return 2 ** self.lod + 1

    def sample_grid(self) -> List[List[Vector3]]:
        """Generate the vertex grid projected onto the unit sphere."""

        size = self.resolution()
        vertices: List[List[Vector3]] = []
        for v_index in range(size):
            row: List[Vector3] = []
            for u_index in range(size):
                u = (self.i + u_index / (size - 1)) / (2 ** self.lod)
                v = (self.j + v_index / (size - 1)) / (2 ** self.lod)
                direction = _face_uv_to_direction(self.face, u, v)
                row.append(direction)
            vertices.append(row)
        return vertices

    def edge_signature(self, axis: str, index: int) -> Tuple[Vector3, ...]:
        """Return the edge vertices to assert cross-tile consistency."""

        grid = self.sample_grid()
        if axis == "u":
            column = [row[index] for row in grid]
            return tuple(column)
        return tuple(grid[index])


class TileStreamer:
    """LOD selection helper that streams cubed sphere tiles."""

    def __init__(self, spec: PlanetSpec):
        self._spec = spec

    def active_tiles(self, camera_radius: float) -> List[CubedSphereTile]:
        """Select the visible LOD based on the camera distance from the origin."""

        thresholds = self._spec.lod_distances
        lod = 0
        # //1.- Choose the deepest level for which the camera sits within the threshold.
        for index, distance in enumerate(thresholds):
            if camera_radius < distance:
                lod = index
                break
        else:
            lod = len(thresholds)
        tiles: List[CubedSphereTile] = []
        divisions = 2 ** lod
        for face in range(6):
            for i in range(divisions):
                for j in range(divisions):
                    tiles.append(CubedSphereTile(face, i, j, lod))
        return tiles


class TileScatterer:
    """Deterministic blue-noise style scatterer for instanced models."""

    def __init__(self, spec: PlanetSpec):
        self._spec = spec

    def scatter(self, tile: CubedSphereTile, seed: int | None = None) -> List[Vector3]:
        """Return deterministic scatter positions in spherical coordinates."""

        scatter_seed = self._spec.scatter_seed if seed is None else seed
        resolution = tile.resolution() - 1
        spacing = max(1, int(math.sqrt(resolution / max(1.0, self._spec.scatter_density))))
        positions: List[Vector3] = []
        for v in range(0, resolution + 1, spacing):
            for u in range(0, resolution + 1, spacing):
                key = (tile.face, tile.i + u, tile.j + v, tile.lod, scatter_seed)
                jitter = _hash_float(key, scatter_seed)
                offset_u = (u + jitter) / resolution
                offset_v = (v + (1.0 - jitter)) / resolution
                direction = _face_uv_to_direction(
                    tile.face,
                    (tile.i + offset_u) / (2 ** tile.lod),
                    (tile.j + offset_v) / (2 ** tile.lod),
                )
                positions.append(direction)
        return positions


def _fade(value: float, corner: int) -> float:
    # //1.- Quintic smoothstep preserves C2 continuity for interpolation.
    t = value if corner == 1 else 1.0 - value
    return t * t * t * (t * (t * 6.0 - 15.0) + 10.0)


def _hash_float(cell: Sequence[int | float], seed: int) -> float:
    # //1.- Combine integer lattice coordinates through a reversible hash.
    x = int(math.floor(cell[0]))
    y = int(math.floor(cell[1]))
    z = int(math.floor(cell[2]))
    value = x * 374761393 + y * 668265263 + z * 2147483647 + seed * 912367411
    value = (value ^ (value >> 13)) * 1274126177
    value = (value ^ (value >> 16)) & 0xFFFFFFFF
    return (value / 0xFFFFFFFF) if value else 0.0


def _length(vector: Sequence[float]) -> float:
    # //1.- Compute Euclidean length without numpy dependencies.
    return math.sqrt(sum(component * component for component in vector))


def _normalize(vector: Sequence[float]) -> Vector3:
    # //1.- Normalize the vector to unit length for spherical calculations.
    length = _length(vector)
    if length == 0.0:
        raise ValueError("vector must be non-zero")
    inv = 1.0 / length
    return (vector[0] * inv, vector[1] * inv, vector[2] * inv)


def _to_vec3(value: Sequence[float]) -> Vector3:
    iterator = iter(value)
    x = float(next(iterator))
    y = float(next(iterator))
    z = float(next(iterator))
    return (x, y, z)


def _face_uv_to_direction(face: int, u: float, v: float) -> Vector3:
    # //1.- Map the unit square onto the corresponding cube face orientation.
    cu = 2.0 * u - 1.0
    cv = 2.0 * v - 1.0
    if face == 0:  # +X
        direction = (1.0, -cv, -cu)
    elif face == 1:  # -X
        direction = (-1.0, -cv, cu)
    elif face == 2:  # +Y
        direction = (cu, 1.0, cv)
    elif face == 3:  # -Y
        direction = (cu, -1.0, -cv)
    elif face == 4:  # +Z
        direction = (cu, -cv, 1.0)
    else:  # face == 5 -> -Z
        direction = (-cu, -cv, -1.0)
    # //2.- Project the cube direction back onto the sphere to remove distortion.
    return _normalize(direction)


def _direction_to_face_uv(direction: Sequence[float]) -> Tuple[int, float, float]:
    # //1.- Choose the dominant axis to determine the cube face.
    x, y, z = direction
    ax, ay, az = abs(x), abs(y), abs(z)
    if ax >= ay and ax >= az:
        if x >= 0.0:
            face = 0
            u = -z / ax
            v = -y / ax
        else:
            face = 1
            u = z / ax
            v = -y / ax
    elif ay >= ax and ay >= az:
        if y >= 0.0:
            face = 2
            u = x / ay
            v = z / ay
        else:
            face = 3
            u = x / ay
            v = -z / ay
    else:
        if z >= 0.0:
            face = 4
            u = x / az
            v = -y / az
        else:
            face = 5
            u = -x / az
            v = -y / az
    # //2.- Convert from -1..1 face coordinates into 0..1 UV space.
    return face, (u + 1.0) * 0.5, (v + 1.0) * 0.5


def _build_river_cache(spec: PlanetSpec, noise: DeterministicNoise) -> Dict[Tuple[int, int, int], float]:
    # //1.- Sample the displacement field on a coarse cubed-sphere grid.
    resolution = spec.river_resolution
    cache: Dict[Tuple[int, int, int], float] = {}
    heights: Dict[Tuple[int, int], float] = {}
    for face in range(6):
        for i in range(resolution):
            for j in range(resolution):
                direction = _face_uv_to_direction(face, i / (resolution - 1), j / (resolution - 1))
                value = 0.0
                amplitude = 0.0
                for octave in spec.displacement_octaves:
                    value += noise.sample(direction, octave.frequency) * octave.amplitude
                    amplitude += abs(octave.amplitude)
                heights[(face, i, j)] = value / max(amplitude, 1e-6)
    # //2.- Accumulate flow by following the steepest descent between neighbors.
    flow: Dict[Tuple[int, int, int], float] = {}
    neighbors = [(-1, 0), (1, 0), (0, -1), (0, 1)]
    for face in range(6):
        for i in range(resolution):
            for j in range(resolution):
                current_height = heights[(face, i, j)]
                best_neighbor: Optional[Tuple[int, int, int]] = None
                best_height = current_height
                for offset in neighbors:
                    ni = i + offset[0]
                    nj = j + offset[1]
                    if ni < 0 or nj < 0 or ni >= resolution or nj >= resolution:
                        continue
                    neighbor_height = heights[(face, ni, nj)]
                    if neighbor_height < best_height:
                        best_neighbor = (face, ni, nj)
                        best_height = neighbor_height
                key = (face, i, j)
                if best_neighbor is None:
                    flow[key] = 0.0
                    continue
                neighbor_key = best_neighbor
                flow[key] = flow.get(neighbor_key, 0.0) + 1.0
    # //3.- Normalize flow strength to reuse during displacement queries.
    for key, value in flow.items():
        cache[key] = max(0.0, min(1.0, value / spec.river_threshold))
    return cache


def _sample_river(cache: Mapping[Tuple[int, int, int], float], direction: Sequence[float]) -> float:
    # //1.- Convert direction into the cached coarse grid coordinates.
    face, u, v = _direction_to_face_uv(direction)
    resolution = int(math.sqrt(len(cache) / 6)) or 1
    i = min(int(round(u * (resolution - 1))), resolution - 1)
    j = min(int(round(v * (resolution - 1))), resolution - 1)
    return cache.get((face, i, j), 0.0)


def _remap(displacement_field: PlanetDisplacementField, direction: Sequence[float], frequency: float) -> float:
    # //1.- Evaluate a low-frequency displacement to drive the climate fields.
    value = displacement_field._noise.sample(direction, frequency)
    return value * 0.5 + 0.5


def _dot(a: Sequence[float], b: Sequence[float]) -> float:
    # //1.- Compute the dot product to project velocities onto the surface normal.
    return float(a[0]) * float(b[0]) + float(a[1]) * float(b[1]) + float(a[2]) * float(b[2])

