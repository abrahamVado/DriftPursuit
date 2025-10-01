"""High-level tunnel generation entry point."""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Dict, List, Tuple

from .direction_field import DivergenceFreeField, FieldParams
from .frame import OrthonormalFrame
from .geometry import ChunkGeometry, MeshChunk, RingSample, SDFChunk
from .noise import noise3, noise3_periodic
from .vector import Vector3


@dataclass(frozen=True)
class TunnelParams:
    world_seed: int
    chunk_length: float
    ring_step: float
    tube_sides: int
    dir_freq: float
    dir_blend: float
    radius_base: float
    radius_var: float
    radius_freq: float
    rough_amp: float
    rough_freq: float
    jolt_every_meters: float
    jolt_strength: float
    max_turn_per_step_rad: float
    mode: str


class TunnelTerrainGenerator:
    """Generates chunks on demand while caching previously computed rings."""

    def __init__(self, params: TunnelParams) -> None:
        if params.tube_sides < 3:
            raise ValueError("tube_sides must be >= 3")
        if params.radius_base <= params.rough_amp:
            raise ValueError("roughness amplitude must be smaller than base radius")
        self._params = params
        field_params = FieldParams(
            world_seed=params.world_seed,
            dir_freq=params.dir_freq,
            dir_blend=params.dir_blend,
            max_turn_per_step_rad=params.max_turn_per_step_rad,
            jolt_every_meters=params.jolt_every_meters,
            jolt_strength=params.jolt_strength,
        )
        self._field = DivergenceFreeField(field_params)
        self._global_rings: List[RingSample] = []
        self._global_s_positions: List[float] = []
        self._rings_per_chunk = int(round(params.chunk_length / params.ring_step)) + 1
        self._ensure_ring(0)

    def generate_chunk(self, chunk_index: int) -> ChunkGeometry:
        start = chunk_index * (self._rings_per_chunk - 1)
        end = start + self._rings_per_chunk
        self._ensure_ring(end)
        rings = tuple(self._global_rings[start:end])
        chunk = ChunkGeometry(chunk_index=chunk_index, rings=rings)
        chunk.min_radius = min(r.radius for r in rings)
        chunk.max_radius = max(r.radius for r in rings)
        chunk.widest_ring_index = max(range(len(rings)), key=lambda i: rings[i].radius)
        chunk.update_bounds()
        if self._params.mode in ("mesh", "mesh+sdf"):
            chunk.mesh = self._build_mesh(rings)
        if self._params.mode in ("sdf", "mesh+sdf"):
            chunk.sdf = self._build_sdf(chunk_index, rings)
        return chunk

    def rings(self) -> Tuple[RingSample, ...]:
        """Return all generated rings so far."""

        return tuple(self._global_rings)

    def _ensure_ring(self, index: int) -> None:
        while len(self._global_rings) <= index:
            self._append_ring()

    def _append_ring(self) -> None:
        params = self._params
        index = len(self._global_rings)
        if index == 0:
            origin = Vector3.zero()
            forward = Vector3.unit_z()
            frame = OrthonormalFrame.initial(origin, forward)
            radius = params.radius_base
            roughness = tuple([params.radius_base] * params.tube_sides)
            ring = RingSample(frame=frame, radius=radius, roughness_profile=roughness)
            self._global_rings.append(ring)
            self._global_s_positions.append(0.0)
            return

        prev_ring = self._global_rings[-1]
        prev_s = self._global_s_positions[-1]
        arc_length = prev_s + params.ring_step
        direction = self._field.next_direction(prev_ring.center, prev_ring.forward, index, arc_length)
        origin = prev_ring.center + direction * params.ring_step
        frame = prev_ring.frame.transport(origin, direction)

        radius = params.radius_base + params.radius_var * noise3(
            params.world_seed + 2000, arc_length * params.radius_freq, 0.0, 0.0
        )
        radius = max(radius, params.radius_base * 0.2)

        roughness_profile = self._build_roughness_profile(index, frame, radius, arc_length)
        ring = RingSample(frame=frame, radius=radius, roughness_profile=roughness_profile)
        self._global_rings.append(ring)
        self._global_s_positions.append(arc_length)

    def _build_roughness_profile(
        self, index: int, frame: OrthonormalFrame, radius: float, arc_length: float
    ) -> Tuple[float, ...]:
        params = self._params
        sides = params.tube_sides
        values: List[float] = []
        for side in range(sides):
            angle = (side / sides) * math.tau
            noise_value = noise3_periodic(
                params.world_seed + 4000,
                frame.origin.x * params.rough_freq,
                frame.origin.y * params.rough_freq,
                angle + arc_length * params.rough_freq,
                period=math.tau,
            )
            rough = radius + params.rough_amp * noise_value
            rough = max(rough, radius * 0.5)
            values.append(rough)
        return tuple(values)

    def _build_mesh(self, rings: Tuple[RingSample, ...]) -> MeshChunk:
        vertices: List[Vector3] = []
        indices: List[int] = []
        sides = self._params.tube_sides
        for ring_idx, ring in enumerate(rings):
            for side in range(sides):
                angle = (side / sides) * math.tau
                axis = ring.frame.right * math.cos(angle) + ring.frame.up * math.sin(angle)
                radius = ring.roughness_profile[side]
                vertices.append(ring.center + axis * radius)
            if ring_idx == 0:
                continue
            base_prev = (ring_idx - 1) * sides
            base_curr = ring_idx * sides
            for side in range(sides):
                next_side = (side + 1) % sides
                indices.extend([
                    base_prev + side,
                    base_curr + side,
                    base_curr + next_side,
                    base_prev + side,
                    base_curr + next_side,
                    base_prev + next_side,
                ])
        return MeshChunk(vertices=vertices, indices=indices)

    def _build_sdf(self, chunk_index: int, rings: Tuple[RingSample, ...]) -> SDFChunk:
        indexes = tuple(range(chunk_index * (self._rings_per_chunk - 1), chunk_index * (self._rings_per_chunk - 1) + len(rings)))
        radii = tuple(r.radius for r in rings)
        return SDFChunk(ring_indexes=indexes, radii=radii)
