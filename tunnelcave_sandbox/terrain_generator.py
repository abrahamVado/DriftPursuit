"""High-level tunnel generation entry point."""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import List, Optional, Tuple

from .direction_field import (
    DivergenceFreeField,
    FieldParams,
    PipeNetworkField,
    PipeNetworkParams,
)
from .frame import OrthonormalFrame
from .geometry import ChunkGeometry, MeshChunk, RingSample, SDFChunk
from .noise import noise3
from .profile import (
    CavernProfileParams,
    default_cavern_profile,
    fractal_roughness,
    lobe_scale,
    twist_angle,
)
from .vector import Vector3


@dataclass(frozen=True)
class _RoughnessStats:
    mean: float
    variance: float
    min_radius: float


@dataclass(frozen=True)
class TunnelParams:
    """High level knob set for :class:`TunnelTerrainGenerator`.

    The ``add_end_caps`` toggle controls whether generated mesh chunks include
    extra geometry to close off their start and end rings. When enabled the
    ``end_cap_style`` option selects between a triangle fan (``"fan"``) that
    adds a single center vertex per boundary ring or a short overlap sleeve
    (``"sleeve"``) that extrudes an additional ring of vertices so adjacent
    chunks can interpenetrate without gaps.
    """

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
    field_type: str = "divergence_free"
    pipe_network: PipeNetworkParams | None = None
    add_end_caps: bool = True
    end_cap_style: str = "fan"
    profile: CavernProfileParams = field(default_factory=default_cavern_profile)
    rough_smoothness: float = 0.0
    rough_filter_kernel: Optional[Tuple[float, ...]] = None


class TunnelTerrainGenerator:
    """Generates chunks on demand while caching previously computed rings."""

    def __init__(self, params: TunnelParams) -> None:
        if params.tube_sides < 3:
            raise ValueError("tube_sides must be >= 3")
        if params.radius_base <= params.rough_amp:
            raise ValueError("roughness amplitude must be smaller than base radius")
        if len(params.profile.lobe_centers) != len(params.profile.lobe_strengths):
            raise ValueError("lobe_centers and lobe_strengths must have the same length")
        if not 0.0 <= params.rough_smoothness <= 1.0:
            raise ValueError("rough_smoothness must be between 0 and 1")

        kernel = params.rough_filter_kernel
        if kernel is not None:
            if len(kernel) == 0:
                raise ValueError("rough_filter_kernel must not be empty when provided")
            if all(weight == 0.0 for weight in kernel):
                raise ValueError("rough_filter_kernel must contain a non-zero weight")
            self._rough_filter_kernel: Optional[Tuple[float, ...]] = tuple(kernel)
        else:
            self._rough_filter_kernel = None

        if params.end_cap_style not in {"fan", "sleeve"}:
            raise ValueError("end_cap_style must be either 'fan' or 'sleeve'")

        self._params = params
        field_params = FieldParams(
            world_seed=params.world_seed,
            dir_freq=params.dir_freq,
            dir_blend=params.dir_blend,
            max_turn_per_step_rad=params.max_turn_per_step_rad,
            jolt_every_meters=params.jolt_every_meters,
            jolt_strength=params.jolt_strength,
        )
        if params.field_type == "divergence_free":
            self._field = DivergenceFreeField(field_params)
        elif params.field_type == "pipe_network":
            pipe_params = params.pipe_network or PipeNetworkParams()
            self._field = PipeNetworkField(field_params, pipe_params)
        else:
            raise ValueError(f"Unknown field_type '{params.field_type}'")
        self._global_rings: List[RingSample] = []
        self._global_s_positions: List[float] = []
        self._rings_per_chunk = int(round(params.chunk_length / params.ring_step)) + 1
        self._prev_roughness_profile: Optional[Tuple[float, ...]] = None
        self._prev_profile_stats: Optional[_RoughnessStats] = None
        self._radius_floor_history: List[float] = []
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

    def radius_floor_history(self) -> Tuple[float, ...]:
        """Return the per-ring minimum radius floor used during generation."""

        return tuple(self._radius_floor_history)

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
        if hasattr(self._field, "position_at"):
            origin = getattr(self._field, "position_at")(arc_length)
            delta = origin - prev_ring.center
            if delta.length() > 1e-6:
                direction = delta.normalized()
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
        min_radius = self._compute_min_radius_floor(base_radius, scaled_radius)
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
            radius = max(radius, min_radius)
            values.append(radius)
            max_radius = max(max_radius, radius)

        previous_profile = self._prev_roughness_profile
        smoothness = params.rough_smoothness
        if previous_profile is not None and smoothness > 0.0:
            blend = 1.0 - smoothness
            smoothed: List[float] = []
            for idx, raw_value in enumerate(values):
                prev_value = previous_profile[idx % len(previous_profile)]
                blended = prev_value * smoothness + raw_value * blend
                smoothed.append(max(blended, min_radius))
            values = smoothed

        if self._rough_filter_kernel is not None:
            kernel = self._rough_filter_kernel
            assert kernel is not None  # for type checkers
            kernel_sum = sum(kernel)
            if kernel_sum == 0.0:
                filtered = values
            else:
                center = len(kernel) // 2
                filtered = []
                for idx in range(sides):
                    acc = 0.0
                    for offset, weight in enumerate(kernel):
                        neighbor = (idx + offset - center) % sides
                        acc += values[neighbor] * weight
                    filtered.append(max(acc / kernel_sum, min_radius))
            values = filtered

        final_max = max(values, default=min_radius)
        result = tuple(values)
        self._prev_roughness_profile = result
        self._radius_floor_history.append(min_radius)
        if result:
            mean_radius = sum(result) / len(result)
            variance = sum((v - mean_radius) ** 2 for v in result) / len(result)
            min_value = min(result)
            self._prev_profile_stats = _RoughnessStats(
                mean=mean_radius,
                variance=variance,
                min_radius=min_value,
            )
        else:
            self._prev_profile_stats = None
        return result, max(final_max, scaled_radius)

    def _build_mesh(self, rings: Tuple[RingSample, ...]) -> MeshChunk:
        vertices: List[Vector3] = []
        indices: List[int] = []
        if not rings:
            return MeshChunk(vertices=vertices, indices=indices)

        sides = self._params.tube_sides
        ring_vertex_starts: List[int] = []
        ring_center_indices: List[int | None] = []
        add_fan_caps = self._params.add_end_caps and self._params.end_cap_style == "fan"

        def connect_rings(prev_start: int, curr_start: int) -> None:
            for side in range(sides):
                next_side = (side + 1) % sides
                indices.extend([
                    prev_start + side,
                    curr_start + side,
                    curr_start + next_side,
                    prev_start + side,
                    curr_start + next_side,
                    prev_start + next_side,
                ])

        for ring_idx, ring in enumerate(rings):
            ring_vertex_starts.append(len(vertices))
            for side in range(sides):
                angle = (side / sides) * math.tau
                axis = ring.frame.right * math.cos(angle) + ring.frame.up * math.sin(angle)
                radius = ring.roughness_profile[side]
                vertices.append(ring.center + axis * radius)
            if add_fan_caps and ring_idx in (0, len(rings) - 1):
                ring_center_indices.append(len(vertices))
                vertices.append(ring.center)
            else:
                ring_center_indices.append(None)
            if ring_idx == 0:
                continue
            connect_rings(ring_vertex_starts[ring_idx - 1], ring_vertex_starts[ring_idx])

        if not self._params.add_end_caps:
            return MeshChunk(vertices=vertices, indices=indices)

        if self._params.end_cap_style == "fan":
            start_center = ring_center_indices[0]
            if start_center is not None:
                base = ring_vertex_starts[0]
                for side in range(sides):
                    next_side = (side + 1) % sides
                    indices.extend([
                        start_center,
                        base + next_side,
                        base + side,
                    ])
            end_center = ring_center_indices[-1]
            if end_center is not None and len(rings) > 1:
                base = ring_vertex_starts[-1]
                for side in range(sides):
                    next_side = (side + 1) % sides
                    indices.extend([
                        end_center,
                        base + side,
                        base + next_side,
                    ])
        else:  # sleeve end caps
            sleeve_length = max(self._params.ring_step * 0.5, 1e-6)
            start_base = ring_vertex_starts[0]
            start_offset = rings[0].forward * (-sleeve_length)
            start_positions = [vertices[start_base + side] for side in range(sides)]
            start_sleeve_start = len(vertices)
            for pos in start_positions:
                vertices.append(pos + start_offset)
            connect_rings(start_sleeve_start, start_base)

            end_base = ring_vertex_starts[-1]
            end_offset = rings[-1].forward * sleeve_length
            end_positions = [vertices[end_base + side] for side in range(sides)]
            end_sleeve_start = len(vertices)
            for pos in end_positions:
                vertices.append(pos + end_offset)
            connect_rings(end_base, end_sleeve_start)

        return MeshChunk(vertices=vertices, indices=indices)

    def _build_sdf(self, chunk_index: int, rings: Tuple[RingSample, ...]) -> SDFChunk:
        indexes = tuple(range(chunk_index * (self._rings_per_chunk - 1), chunk_index * (self._rings_per_chunk - 1) + len(rings)))
        radii = tuple(r.radius for r in rings)
        return SDFChunk(ring_indexes=indexes, radii=radii)

    def _compute_min_radius_floor(self, base_radius: float, scaled_radius: float) -> float:
        profile_scale = self._params.profile.base_scale
        scale_factor = 0.18 + 0.05 * math.tanh(profile_scale - 1.0)
        scale_factor = max(0.1, min(scale_factor, 0.32))
        scaled_component = scaled_radius * scale_factor
        base_component = base_radius * 0.12
        floor = max(base_component, scaled_component)

        stats = self._prev_profile_stats
        if stats is not None:
            prev_mean = stats.mean
            prev_std = math.sqrt(max(stats.variance, 0.0))
            prev_min = stats.min_radius
            if prev_mean > 1e-6:
                normalized_std = min(1.0, prev_std / prev_mean)
            else:
                normalized_std = 0.0
            continuity_floor = prev_min * (0.9 + 0.05 * (1.0 - normalized_std))
            smooth_floor = prev_mean - prev_std * (0.75 + 0.25 * normalized_std)
            floor = max(floor, continuity_floor, smooth_floor)

        floor = max(floor, scaled_radius * 0.05)
        floor = min(floor, scaled_radius * 0.95)
        return floor
