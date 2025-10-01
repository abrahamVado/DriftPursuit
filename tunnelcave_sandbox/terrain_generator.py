"""High-level tunnel generation entry point."""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import List, Tuple

from .direction_field import DivergenceFreeField, FieldParams
from .frame import OrthonormalFrame
from .geometry import ChunkGeometry, MeshChunk, RingSample, SDFChunk
from .noise import noise3
from .profile import CavernProfileParams, default_cavern_profile, fractal_roughness, lobe_scale, twist_angle
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
    profile: CavernProfileParams = field(default_factory=default_cavern_profile)


class TunnelTerrainGenerator:
    """Generates chunks on demand while caching previously computed rings."""

    def __init__(self, params: TunnelParams) -> None:
        if params.tube_sides < 3:
            raise ValueError("tube_sides must be >= 3")
        if params.radius_base <= params.rough_amp:
            raise ValueError("roughness amplitude must be smaller than base radius")
        if len(params.profile.lobe_centers) != len(params.profile.lobe_strengths):
            raise ValueError("lobe_centers and lobe_strengths must have the same length")

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
        ring_minima = [min(r.roughness_profile) for r in rings]
        ring_maxima = [max(r.roughness_profile) for r in rings]
        chunk.min_radius = min(ring_minima)
        chunk.max_radius = max(ring_maxima)
        chunk.widest_ring_index = max(range(len(rings)), key=lambda i: ring_maxima[i])
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

            base_radius = params.radius_base
            roughness, max_radius = self._build_roughness_profile(frame, base_radius, 0.0)
            ring = RingSample(frame=frame, radius=max_radius, roughness_profile=roughness)
            self._global_rings.append(ring)
            self._global_s_positions.append(0.0)
            return

        prev_ring = self._global_rings[-1]
        prev_s = self._global_s_positions[-1]
        arc_length = prev_s + params.ring_step
        direction = self._field.next_direction(prev_ring.center, prev_ring.forward, index, arc_length)
        origin = prev_ring.center + direction * params.ring_step
        frame = prev_ring.frame.transport(origin, direction)

        base_radius = params.radius_base + params.radius_var * noise3(
            params.world_seed + 2000, arc_length * params.radius_freq, 0.0, 0.0
        )
        base_radius = max(base_radius, params.radius_base * 0.2)

        roughness_profile, max_radius = self._build_roughness_profile(frame, base_radius, arc_length)
        ring = RingSample(frame=frame, radius=max_radius, roughness_profile=roughness_profile)

        self._global_rings.append(ring)
        self._global_s_positions.append(arc_length)

    def _build_roughness_profile(
        self, frame: OrthonormalFrame, base_radius: float, arc_length: float
    ) -> Tuple[Tuple[float, ...], float]:
        params = self._params
        profile = params.profile
        sides = params.tube_sides
        scaled_radius = base_radius * profile.base_scale
        twist = twist_angle(params.world_seed + 5000, profile, arc_length)
        values: List[float] = []
        max_radius = scaled_radius
        for side in range(sides):
            angle = (side / sides) * math.tau
            shifted_angle = angle + twist
            lobe = lobe_scale(shifted_angle, profile)
            cavern_radius = scaled_radius * (1.0 + lobe)
            rock_detail = fractal_roughness(
                params.world_seed + 6000,
                profile,
                (frame.origin.x, frame.origin.y, frame.origin.z),
                arc_length,
                shifted_angle,
                params.rough_freq,
            )
            radius = cavern_radius + params.rough_amp * rock_detail
            radius = max(radius, scaled_radius * 0.8)
            values.append(radius)
            max_radius = max(max_radius, radius)
        return tuple(values), max_radius

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
