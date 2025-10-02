"""Signed distance field sampling and collision helpers."""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Callable, Sequence, Tuple

Vector3 = Tuple[float, float, float]


@dataclass(frozen=True)
class RayHit:
    """Result from ray marching against an SDF."""

    hit: bool
    distance: float
    position: Vector3


class SignedDistanceField:
    """Signed distance field exposing sampling and collision routines."""

    def __init__(self, sampler: Callable[[Vector3], float]):
        if sampler is None:
            raise ValueError("sampler must be provided")
        self._sampler = sampler

    def sample(self, point: Sequence[float]) -> float:
        """Sample the field at the provided point."""

        vec = _to_vec3(point)
        return float(self._sampler(vec))

    def gradient(self, point: Sequence[float], epsilon: float = 1e-3) -> Vector3:
        """Approximate the field gradient via central differences."""

        center = _to_vec3(point)
        offsets = (
            (epsilon, 0.0, 0.0),
            (0.0, epsilon, 0.0),
            (0.0, 0.0, epsilon),
        )
        # //1.- Sample at positive and negative offsets to estimate partial derivatives.
        dx = (
            self.sample(_add(center, offsets[0]))
            - self.sample(_sub(center, offsets[0]))
        ) / (2.0 * epsilon)
        dy = (
            self.sample(_add(center, offsets[1]))
            - self.sample(_sub(center, offsets[1]))
        ) / (2.0 * epsilon)
        dz = (
            self.sample(_add(center, offsets[2]))
            - self.sample(_sub(center, offsets[2]))
        ) / (2.0 * epsilon)
        return (dx, dy, dz)

    def surface_normal(self, point: Sequence[float], epsilon: float = 1e-3) -> Vector3:
        """Compute a unit surface normal using the SDF gradient."""

        gradient = self.gradient(point, epsilon=epsilon)
        magnitude = _length(gradient)
        if magnitude == 0.0:
            # //1.- Fall back to a sensible default when the gradient is degenerate.
            return (0.0, 1.0, 0.0)
        inv = 1.0 / magnitude
        # //2.- Normalize the gradient to produce a unit-length surface normal.
        return (gradient[0] * inv, gradient[1] * inv, gradient[2] * inv)

    def ray_intersection(
        self,
        origin: Sequence[float],
        direction: Sequence[float],
        *,
        max_distance: float = 200.0,
        epsilon: float = 1e-3,
        max_steps: int = 128,
    ) -> RayHit:
        """Perform sphere tracing to intersect a ray with the field."""

        ray_origin = _to_vec3(origin)
        ray_dir = _normalize(direction)
        distance = 0.0
        current = ray_origin
        for _ in range(max_steps):
            sample = self.sample(current)
            # //1.- Report a hit once the ray is sufficiently close to the surface.
            if sample < epsilon:
                return RayHit(True, distance, current)
            distance += sample
            # //2.- Abort when marching beyond the configured distance budget.
            if distance > max_distance:
                break
            current = _add(ray_origin, _scale(ray_dir, distance))
        final_pos = _add(ray_origin, _scale(ray_dir, min(distance, max_distance)))
        return RayHit(False, min(distance, max_distance), final_pos)

    def sphere_intersection(
        self,
        center: Sequence[float],
        radius: float,
    ) -> Tuple[bool, float]:
        """Check whether a bounding sphere intersects the field surface."""

        sphere_center = _to_vec3(center)
        sdf_distance = self.sample(sphere_center) - float(radius)
        # //1.- Negative signed distance indicates penetration with the surface.
        return sdf_distance <= 0.0, sdf_distance


class SphereField(SignedDistanceField):
    """Analytic sphere SDF."""

    def __init__(self, center: Sequence[float], radius: float):
        center_vec = _to_vec3(center)
        radius = float(radius)

        def sampler(point: Vector3) -> float:
            # //1.- Euclidean distance from the center determines the signed value.
            return _length(_sub(point, center_vec)) - radius

        super().__init__(sampler)


class PlaneField(SignedDistanceField):
    """Half-space represented by a normalized plane."""

    def __init__(self, point: Sequence[float], normal: Sequence[float]):
        origin = _to_vec3(point)
        normal_vec = _normalize(normal)

        def sampler(position: Vector3) -> float:
            # //1.- Dot product projects the point onto the plane normal.
            return _dot(_sub(position, origin), normal_vec)

        super().__init__(sampler)


def _to_vec3(value: Sequence[float]) -> Vector3:
    iterator = iter(value)
    try:
        x = float(next(iterator))
        y = float(next(iterator))
        z = float(next(iterator))
    except StopIteration as exc:  # pragma: no cover - defensive guard.
        raise ValueError("expected three components") from exc
    # //1.- Convert the input sequence into a canonical tuple for downstream math.
    return (x, y, z)


def _length(vector: Sequence[float]) -> float:
    # //1.- Compute the Euclidean norm without numpy dependencies.
    return math.sqrt(sum(component * component for component in vector))


def _normalize(value: Sequence[float]) -> Vector3:
    vec = _to_vec3(value)
    norm = _length(vec)
    if norm == 0:
        raise ValueError("direction vector must be non-zero")
    # //1.- Scale the vector by its magnitude to prevent unstable ray marching.
    return (vec[0] / norm, vec[1] / norm, vec[2] / norm)


def _add(a: Sequence[float], b: Sequence[float]) -> Vector3:
    # //1.- Vector addition composes marching steps and offsets.
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def _sub(a: Sequence[float], b: Sequence[float]) -> Vector3:
    # //1.- Differences between vectors support distance and projection operations.
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _scale(vector: Sequence[float], scalar: float) -> Vector3:
    # //1.- Scalar multiplication adjusts traversal distances along a direction.
    return (vector[0] * scalar, vector[1] * scalar, vector[2] * scalar)


def _dot(a: Sequence[float], b: Sequence[float]) -> float:
    # //1.- Dot product supplies projection helpers for the plane SDF.
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
