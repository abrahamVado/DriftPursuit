"""Deterministic vector helpers avoiding external math dependencies."""
from __future__ import annotations

import math
from typing import Iterable, Tuple

Vector3 = Tuple[float, float, float]


# //1.- Convert iterables into normalized three-component tuples for safety.
def _to_vector(components: Iterable[float]) -> Vector3:
    values = tuple(float(component) for component in components)
    if len(values) != 3:
        raise ValueError("Vector3 requires exactly three components")
    return values  # type: ignore[return-value]


# //2.- Add vectors component-wise returning a new tuple.
def add(a: Iterable[float], b: Iterable[float]) -> Vector3:
    ax, ay, az = _to_vector(a)
    bx, by, bz = _to_vector(b)
    return (ax + bx, ay + by, az + bz)


# //3.- Subtract vectors component-wise returning a new tuple.
def subtract(a: Iterable[float], b: Iterable[float]) -> Vector3:
    ax, ay, az = _to_vector(a)
    bx, by, bz = _to_vector(b)
    return (ax - bx, ay - by, az - bz)


# //4.- Multiply a vector by a scalar value.
def scale(vector: Iterable[float], scalar: float) -> Vector3:
    vx, vy, vz = _to_vector(vector)
    factor = float(scalar)
    return (vx * factor, vy * factor, vz * factor)


# //5.- Compute the dot product between two vectors.
def dot(a: Iterable[float], b: Iterable[float]) -> float:
    ax, ay, az = _to_vector(a)
    bx, by, bz = _to_vector(b)
    return ax * bx + ay * by + az * bz


# //6.- Compute the cross product following right-hand rule.
def cross(a: Iterable[float], b: Iterable[float]) -> Vector3:
    ax, ay, az = _to_vector(a)
    bx, by, bz = _to_vector(b)
    return (ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx)


# //7.- Calculate the Euclidean length of a vector.
def length(vector: Iterable[float]) -> float:
    vx, vy, vz = _to_vector(vector)
    return math.sqrt(vx * vx + vy * vy + vz * vz)


# //8.- Normalize a vector guarding against zero length inputs.
def normalize(vector: Iterable[float], fallback: Vector3 = (0.0, 0.0, 0.0)) -> Vector3:
    vx, vy, vz = _to_vector(vector)
    magnitude = math.sqrt(vx * vx + vy * vy + vz * vz)
    if magnitude == 0:
        return fallback
    inv = 1.0 / magnitude
    return (vx * inv, vy * inv, vz * inv)


# //9.- Clamp vector length to a maximum magnitude while preserving direction.
def clamp_length(vector: Iterable[float], maximum: float) -> Vector3:
    vx, vy, vz = _to_vector(vector)
    max_len = float(maximum)
    current = math.sqrt(vx * vx + vy * vy + vz * vz)
    if current <= max_len or current == 0:
        return (vx, vy, vz)
    scale_factor = max_len / current
    return (vx * scale_factor, vy * scale_factor, vz * scale_factor)


# //10.- Linearly interpolate between two vectors using parameter t.
def lerp(a: Iterable[float], b: Iterable[float], t: float) -> Vector3:
    ax, ay, az = _to_vector(a)
    bx, by, bz = _to_vector(b)
    factor = float(t)
    return (ax + (bx - ax) * factor, ay + (by - ay) * factor, az + (bz - az) * factor)


# //11.- Project vector a onto vector b returning the projection component.
def project(a: Iterable[float], b: Iterable[float]) -> Vector3:
    bx, by, bz = _to_vector(b)
    denom = bx * bx + by * by + bz * bz
    if denom == 0:
        return (0.0, 0.0, 0.0)
    scale_factor = dot(a, b) / denom
    return (bx * scale_factor, by * scale_factor, bz * scale_factor)
