"""Entrance constraint logic ensuring vehicles do not exit against station normals."""
from __future__ import annotations

from typing import Sequence, Tuple, cast


# //1.- Compute dot products without introducing numpy as a dependency.
def _dot(a: Sequence[float], b: Sequence[float]) -> float:
    return sum(x * y for x, y in zip(a, b))


# //2.- Convert arbitrary sequences into concrete 3-tuples for arithmetic.
def _to_tuple(vector: Sequence[float]) -> Tuple[float, float, float]:
    components = tuple(float(component) for component in vector)
    if len(components) != 3:
        raise ValueError("Entrance physics expects three-dimensional vectors")
    return cast(Tuple[float, float, float], components)


# //3.- Subtract vectors component-wise for velocity correction.
def _subtract(a: Sequence[float], b: Sequence[float]) -> Tuple[float, float, float]:
    ax, ay, az = _to_tuple(a)
    bx, by, bz = _to_tuple(b)
    return (ax - bx, ay - by, az - bz)


# //4.- Scale a vector by a scalar value while preserving dimensionality.
def _scale(vector: Sequence[float], scalar: float) -> Tuple[float, float, float]:
    vx, vy, vz = _to_tuple(vector)
    return (vx * scalar, vy * scalar, vz * scalar)


# //5.- Clip the outward velocity component aligned with the provided normal.
def clip_velocity_outward(
    velocity: Sequence[float],
    normal: Sequence[float],
) -> Tuple[float, float, float]:
    normal_length_sq = _dot(normal, normal)
    if normal_length_sq == 0:
        return _to_tuple(velocity)
    projection = _dot(velocity, normal)
    if projection <= 0:
        return _to_tuple(velocity)
    scale = projection / normal_length_sq
    correction = _scale(normal, scale)
    return _subtract(velocity, correction)
