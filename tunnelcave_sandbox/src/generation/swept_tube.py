"""Swept tube construction around divergence-free streamlines."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, List, Sequence, Tuple

from .divergence_free import DivergenceFreeField, integrate_streamline


# //1.- Basic vector helpers for arithmetic without external dependencies.
def _vec_add(a: Sequence[float], b: Sequence[float]) -> Tuple[float, float, float]:
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def _vec_sub(a: Sequence[float], b: Sequence[float]) -> Tuple[float, float, float]:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _vec_scale(a: Sequence[float], scalar: float) -> Tuple[float, float, float]:
    return (a[0] * scalar, a[1] * scalar, a[2] * scalar)


def _vec_dot(a: Sequence[float], b: Sequence[float]) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _vec_norm(a: Sequence[float]) -> float:
    return (_vec_dot(a, a)) ** 0.5


# //2.- Represent a single tube segment storing analytic SDF evaluation.
@dataclass
class TubeSegment:
    start: Tuple[float, float, float]
    end: Tuple[float, float, float]
    radius_start: float
    radius_end: float

    # //3.- Compute minimum distance from point to the segment centerline.
    def distance_to_point(self, point: Tuple[float, float, float]) -> float:
        segment = _vec_sub(self.end, self.start)
        length_sq = _vec_dot(segment, segment)
        if length_sq == 0:
            return _vec_norm(_vec_sub(point, self.start))
        t = _vec_dot(_vec_sub(point, self.start), segment) / length_sq
        t_clamped = max(0.0, min(1.0, t))
        projection = _vec_add(self.start, _vec_scale(segment, t_clamped))
        return _vec_norm(_vec_sub(point, projection))

    # //4.- Interpolate radius along the segment for varying thickness.
    def radius_at(self, point: Tuple[float, float, float]) -> float:
        segment = _vec_sub(self.end, self.start)
        length_sq = _vec_dot(segment, segment)
        if length_sq == 0:
            return self.radius_start
        t = _vec_dot(_vec_sub(point, self.start), segment) / length_sq
        t_clamped = max(0.0, min(1.0, t))
        return self.radius_start + (self.radius_end - self.radius_start) * t_clamped

    # //5.- Signed distance function using analytic closest point evaluation.
    def sdf(self, point: Sequence[float]) -> float:
        pos = tuple(float(v) for v in point)
        distance = self.distance_to_point(pos)
        radius = self.radius_at(pos)
        return distance - radius


# //6.- Complete swept tube storing ordered segments with evaluation utilities.
@dataclass
class SweptTube:
    segments: Sequence[TubeSegment]

    # //7.- Signed distance function defined as minimum distance across segments.
    def sdf(self, point: Sequence[float]) -> float:
        pos = tuple(float(v) for v in point)
        return min(segment.sdf(pos) for segment in self.segments)

    # //8.- Expose analytic SDF definition for sampling functions.
    def analytic_sdf(self) -> Callable[[Sequence[float]], float]:
        return lambda p: self.sdf(p)

    # //9.- Generate dense sampling for visualization or testing.
    def sample_along_path(self, resolution: int) -> List[Tuple[float, float, float]]:
        samples: List[Tuple[float, float, float]] = []
        for segment in self.segments:
            for step in range(resolution):
                ratio = step / max(1, resolution)
                point = _vec_add(segment.start, _vec_scale(_vec_sub(segment.end, segment.start), ratio))
                samples.append(point)
        samples.append(self.segments[-1].end)
        return samples


# //10.- Build swept tube from path points and radius definition.
def build_swept_tube(path: Sequence[Sequence[float]], radius: Callable[[int, int], float]) -> SweptTube:
    segments: List[TubeSegment] = []
    for idx in range(len(path) - 1):
        start = tuple(float(v) for v in path[idx])
        end = tuple(float(v) for v in path[idx + 1])
        radius_start = float(radius(idx, len(path)))
        radius_end = float(radius(idx + 1, len(path)))
        segments.append(
            TubeSegment(start=start, end=end, radius_start=radius_start, radius_end=radius_end)
        )
    return SweptTube(segments=segments)


# //11.- Helper synthesizing swept tube directly from divergence-free field seeds.
def generate_seeded_tube(
    field: DivergenceFreeField,
    *,
    seed: Sequence[float],
    steps: int,
    step_size: float,
    base_radius: float,
    radius_variation: float,
) -> SweptTube:
    path = integrate_streamline(field, seed=seed, steps=steps, step_size=step_size)

    def radius(index: int, total: int) -> float:
        if total <= 1:
            return base_radius
        ratio = index / (total - 1)
        return base_radius + radius_variation * (0.5 - abs(ratio - 0.5))

    return build_swept_tube(path, radius=radius)
