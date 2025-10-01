"""Direction field and jolt management for the tunnel path."""
from __future__ import annotations

import math
from bisect import bisect_left
from dataclasses import dataclass
from typing import Iterable, List

from .noise import curl_noise
from .vector import Vector3, orthonormalize, rotate_towards


@dataclass(frozen=True)
class FieldParams:
    world_seed: int
    dir_freq: float
    dir_blend: float
    max_turn_per_step_rad: float
    jolt_every_meters: float
    jolt_strength: float
    curve_smoothing_distance: float = 0.0
    curve_smoothing_steps: int = 1


@dataclass(frozen=True)
class PipeNetworkParams:
    """Parameters that control the deterministic pipe network path."""

    module_count_hint: int = 24
    straight_length: float = 12.0
    helix_turns: float = 1.5
    helix_pitch: float = 3.0
    helix_radius: float = 6.0
    junction_angle_deg: float = 45.0
    junction_radius: float = 10.0


class StraightField:
    """Degenerate field that keeps the tunnel perfectly straight."""

    def __init__(self, params: FieldParams) -> None:
        self._params = params
        forward, up, right = orthonormalize(Vector3.unit_z(), Vector3(0.0, 1.0, 0.0))
        self._frame = _FrameState(Vector3.zero(), forward, up, right)

    def next_direction(
        self,
        position: Vector3,
        previous_direction: Vector3,
        step_index: int,
        arc_length: float,
    ) -> Vector3:
        target = self._frame.forward
        if previous_direction.length() < 1e-6:
            previous_direction = target
        return rotate_towards(previous_direction, target, self._params.max_turn_per_step_rad).normalized()

    def position_at(self, arc_length: float) -> Vector3:
        return self._frame.origin + self._frame.forward * arc_length


class DivergenceFreeField:
    """Produces smooth directions along the path using curl noise."""

    def __init__(self, params: FieldParams) -> None:
        self._params = params
        self._persistent_target = Vector3.unit_z()

    def next_direction(
        self,
        position: Vector3,
        previous_direction: Vector3,
        step_index: int,
        arc_length: float,
    ) -> Vector3:
        """Evaluate the field at ``position`` and apply smoothing & jolts."""

        sampled = self._sample_smoothed_direction(position, previous_direction)
        blended = previous_direction.lerp(sampled, self._params.dir_blend).normalized()
        jolted = self._apply_jolt(blended, step_index, arc_length)
        clamped = rotate_towards(previous_direction, jolted, self._params.max_turn_per_step_rad)
        return clamped.normalized()

    def _sample_smoothed_direction(self, position: Vector3, previous_direction: Vector3) -> Vector3:
        params = self._params
        steps = max(1, params.curve_smoothing_steps)
        distance = max(0.0, params.curve_smoothing_distance)
        direction = previous_direction
        if direction.length() < 1e-5:
            direction = Vector3.unit_z()
        direction = direction.normalized()

        if steps <= 1 or distance <= 1e-6:
            averaged = self._sample_field(position)
        else:
            span = distance
            step_size = span / max(1, steps - 1)
            start = -0.5 * span
            accumulator = Vector3.zero()
            for idx in range(steps):
                offset = start + step_size * idx
                sample_pos = position + direction * offset
                accumulator += self._sample_field(sample_pos)
            averaged = accumulator / max(1, steps)

        if averaged.length() < 1e-6:
            averaged = Vector3.unit_z()
        averaged = averaged.normalized()

        history_blend = 1.0 / max(1, steps)
        self._persistent_target = self._persistent_target.lerp(averaged, history_blend).normalized()
        return self._persistent_target

    def _sample_field(self, position: Vector3) -> Vector3:
        raw_x, raw_y, raw_z = curl_noise(
            self._params.world_seed,
            (position.x, position.y, position.z),
            self._params.dir_freq,
        )
        raw_dir = Vector3(raw_x, raw_y, raw_z)
        if raw_dir.length() < 1e-6:
            return Vector3.unit_z()
        return raw_dir.normalized()

    def _apply_jolt(self, direction: Vector3, step_index: int, arc_length: float) -> Vector3:
        params = self._params
        if params.jolt_every_meters <= 0.0 or params.jolt_strength <= 0.0:
            return direction

        # Each step decides deterministically whether a jolt happens by
        # hashing its global index and the chunk-scaled arc length.
        hashed = _hash64(params.world_seed, step_index)
        threshold = 1.0 - math.exp(-arc_length / max(1e-5, params.jolt_every_meters))
        if (hashed & 0xFFFFFFFF) / 0xFFFFFFFF > threshold:
            return direction

        unit = _pseudo_random_unit(hashed ^ 0xABCDEF)
        jolted = (direction + unit * params.jolt_strength).normalized()
        return jolted


@dataclass(frozen=True)
class _FrameState:
    origin: Vector3
    forward: Vector3
    up: Vector3
    right: Vector3


class _Segment:
    def __init__(self, start_frame: _FrameState, length: float) -> None:
        self._start = start_frame
        self.length = length

    def sample(self, local_s: float) -> _FrameState:
        raise NotImplementedError

    def end_frame(self) -> _FrameState:
        return self.sample(self.length)


class _StraightSegment(_Segment):
    def __init__(self, start_frame: _FrameState, length: float) -> None:
        super().__init__(start_frame, length)

    def sample(self, local_s: float) -> _FrameState:
        start = self._start
        distance = max(0.0, min(self.length, local_s))
        origin = start.origin + start.forward * distance
        return _FrameState(origin=origin, forward=start.forward, up=start.up, right=start.right)


class _ArcSegment(_Segment):
    def __init__(
        self,
        start_frame: _FrameState,
        radius: float,
        angle_rad: float,
        axis: Vector3,
    ) -> None:
        length = abs(radius * angle_rad)
        super().__init__(start_frame, length)
        if radius <= 0.0:
            raise ValueError("Arc radius must be positive")
        self._radius = radius
        self._angle = angle_rad
        self._axis = axis.normalized()
        start = start_frame
        cross = self._axis.cross(start.forward)
        cross_len = cross.length()
        if cross_len < 1e-6:
            raise ValueError("Arc axis must not be parallel to the forward direction")
        self._radius_dir = cross / cross_len
        self._center = start.origin + self._radius_dir * radius
        self._start = start

    def sample(self, local_s: float) -> _FrameState:
        clamped = max(0.0, min(self.length, local_s))
        theta = 0.0 if self.length <= 0.0 else self._angle * (clamped / self.length)
        start = self._start
        axis = self._axis
        offset = start.origin - self._center
        origin = self._center + _rotate_vector(offset, axis, theta)
        forward = _rotate_vector(start.forward, axis, theta)
        up_rot = _rotate_vector(start.up, axis, theta)
        forward, up, right = orthonormalize(forward, up_rot)
        return _FrameState(origin=origin, forward=forward, up=up, right=right)


class _HelixSegment(_Segment):
    def __init__(
        self,
        start_frame: _FrameState,
        turns: float,
        pitch_per_turn: float,
        radius: float,
    ) -> None:
        if turns <= 0.0:
            raise ValueError("turns must be positive")
        if pitch_per_turn <= 0.0:
            raise ValueError("pitch_per_turn must be positive")
        if radius <= 0.0:
            raise ValueError("radius must be positive")
        total_theta = turns * math.tau
        self._total_theta = total_theta
        self._start = start_frame
        a = pitch_per_turn / math.tau
        forward = start_frame.forward
        up_hint = start_frame.up
        perp = up_hint
        # Ensure perpendicular vector is not degenerate.
        if abs(perp.dot(forward)) > 0.95:
            perp = start_frame.right
        perp = (perp - forward * forward.dot(perp)).normalized()
        phi = math.atan2(-radius, a)
        cos_phi = math.cos(phi)
        sin_phi = math.sin(phi)
        axis = (forward * cos_phi + perp * sin_phi).normalized()
        v = (forward * (-sin_phi) + perp * cos_phi).normalized()
        u = axis.cross(v).normalized()
        scale = math.sqrt(a * a + radius * radius)
        length = scale * total_theta
        super().__init__(start_frame, length)
        self._length_scale = scale
        self._axis = axis
        self._u = u
        self._v = v
        self._a = a
        self._radius = radius
        self._pitch_per_turn = pitch_per_turn
        self._base = start_frame.origin - u * radius

    def sample(self, local_s: float) -> _FrameState:
        clamped = max(0.0, min(self.length, local_s))
        if self.length <= 0.0:
            theta = 0.0
        else:
            theta = self._total_theta * (clamped / self.length)
        axis = self._axis
        radius = self._radius
        a = self._a
        pitch_per_turn = self._pitch_per_turn
        u = self._u
        v = self._v
        base = self._base
        origin = (
            base
            + axis * (pitch_per_turn * (theta / math.tau))
            + u * radius * math.cos(theta)
            + v * radius * math.sin(theta)
        )
        tangent_raw = axis * a + (u * (-radius * math.sin(theta)) + v * (radius * math.cos(theta)))
        tangent = tangent_raw / self._length_scale
        up_dir = u * math.cos(theta) + v * math.sin(theta)
        forward, up, right = orthonormalize(tangent, up_dir)
        return _FrameState(origin=origin, forward=forward, up=up, right=right)


class PipeNetworkField:
    """Deterministic network of straight pipes, arcs, and helixes."""

    def __init__(self, params: FieldParams, pipe_params: PipeNetworkParams) -> None:
        self._params = params
        self._pipe = pipe_params
        forward, up, right = orthonormalize(Vector3.unit_z(), Vector3(0.0, 1.0, 0.0))
        self._initial_frame = _FrameState(Vector3.zero(), forward, up, right)
        self._segments: List[tuple[_Segment, float]] = []
        self._segment_end_s: List[float] = []
        self._total_length = 0.0
        self._module_index = 0
        self._module_plan = self._build_module_plan()

    def next_direction(
        self,
        position: Vector3,
        previous_direction: Vector3,
        step_index: int,
        arc_length: float,
    ) -> Vector3:
        state = self._sample(arc_length)
        return rotate_towards(previous_direction, state.forward, self._params.max_turn_per_step_rad)

    def position_at(self, arc_length: float) -> Vector3:
        return self._sample(arc_length).origin

    def _sample(self, arc_length: float) -> _FrameState:
        if arc_length <= 0.0 and self._segments:
            return self._segments[0][0].sample(0.0)
        target = max(0.0, arc_length)
        self._ensure_length(target + self._pipe.straight_length)
        if not self._segments:
            return self._initial_frame
        idx = bisect_left(self._segment_end_s, target)
        idx = min(idx, len(self._segments) - 1)
        segment, start_s = self._segments[idx]
        local_s = target - start_s
        return segment.sample(local_s)

    def _ensure_length(self, length: float) -> None:
        while self._total_length < length:
            self._append_segment()

    def _append_segment(self) -> None:
        start_frame = self._segments[-1][0].end_frame() if self._segments else self._initial_frame
        selector = self._select_module_type()
        if selector == 0:
            segment = _StraightSegment(start_frame, self._pipe.straight_length)
        elif selector == 1:
            angle_seed = _hash64(self._params.world_seed + 32000, self._module_index)
            angle_sign = -1.0 if (angle_seed & 0x1) else 1.0
            angle = math.radians(self._pipe.junction_angle_deg) * angle_sign
            segment = _ArcSegment(start_frame, self._pipe.junction_radius, angle, start_frame.up)
        elif selector == 2:
            pitch_seed = _hash64(self._params.world_seed + 33000, self._module_index)
            pitch_variation = ((pitch_seed >> 16) & 0xFFFF) / 0xFFFF * 0.5 - 0.25
            pitch = max(0.5, self._pipe.helix_pitch + pitch_variation)
            turns_seed = _hash64(self._params.world_seed + 34000, self._module_index)
            turns_variation = ((turns_seed >> 32) & 0xFFFF) / 0xFFFF * 0.5 - 0.25
            turns = max(0.75, self._pipe.helix_turns + turns_variation)
            radius = max(1.0, self._pipe.helix_radius)
            segment = _HelixSegment(start_frame, turns=turns, pitch_per_turn=pitch, radius=radius)
        else:
            angle_seed = _hash64(self._params.world_seed + 35000, self._module_index)
            angle_sign = -1.0 if (angle_seed & 0x1) else 1.0
            angle = math.radians(self._pipe.junction_angle_deg) * angle_sign
            segment = _ArcSegment(start_frame, self._pipe.junction_radius, angle, start_frame.right)

        start_s = self._total_length
        self._segments.append((segment, start_s))
        self._total_length += segment.length
        self._segment_end_s.append(self._total_length)
        self._module_index += 1

    def _build_module_plan(self) -> tuple[int, ...]:
        """Pre-compute a deterministic module plan for repeatable layouts."""

        count = max(0, int(self._pipe.module_count_hint))
        if count == 0:
            return ()
        plan: List[int] = []
        seed_base = self._params.world_seed + 30000
        for idx in range(count):
            hashed = _hash64(seed_base, idx)
            plan.append(hashed % 4)

        if count >= 4:
            # Ensure each module type shows up at least once in the cycle so
            # the layout contains straights, arcs, and helixes.
            type_counts = [0, 0, 0, 0]
            for module in plan:
                type_counts[module] += 1
            missing = [module for module, seen in enumerate(type_counts) if seen == 0]
            if missing:
                for replace_idx, module in zip(range(len(plan)), missing):
                    plan[replace_idx] = module

        return tuple(plan)

    def _select_module_type(self) -> int:
        if not self._module_plan:
            selector_seed = _hash64(self._params.world_seed + 31000, self._module_index)
            return selector_seed % 4
        cycle_index = self._module_index % len(self._module_plan)
        return self._module_plan[cycle_index]


def _rotate_vector(vector: Vector3, axis: Vector3, angle: float) -> Vector3:
    axis_norm = axis.normalized()
    cos_theta = math.cos(angle)
    sin_theta = math.sin(angle)
    return (
        vector * cos_theta
        + axis_norm.cross(vector) * sin_theta
        + axis_norm * axis_norm.dot(vector) * (1.0 - cos_theta)
    )


def _hash64(seed: int, value: int) -> int:
    v = seed ^ (value + 0x9E3779B97F4A7C15)
    v = (v ^ (v >> 30)) * 0xBF58476D1CE4E5B9
    v = (v ^ (v >> 27)) * 0x94D049BB133111EB
    v = v ^ (v >> 31)
    return v & 0xFFFFFFFFFFFFFFFF


def _pseudo_random_unit(hash_value: int) -> Vector3:
    x = ((hash_value >> 0) & 0xFFFF) / 0xFFFF * 2.0 - 1.0
    y = ((hash_value >> 16) & 0xFFFF) / 0xFFFF * 2.0 - 1.0
    z = ((hash_value >> 32) & 0xFFFF) / 0xFFFF * 2.0 - 1.0
    vec = Vector3(x, y, z)
    length = vec.length()
    if length < 1e-5:
        return Vector3.unit_z()
    return vec / length
