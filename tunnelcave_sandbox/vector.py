"""Lightweight 3D vector math utilities.

The sandbox keeps vector arithmetic extremely small and explicit so
that every deterministic step in the cave generation is easy to audit.
The functions offered here are intentionally minimal: only what the
rest of the sandbox needs is implemented.
"""
from __future__ import annotations

from dataclasses import dataclass
import math
from typing import Iterable


@dataclass(frozen=True)
class Vector3:
    """Immutable 3D vector with a handful of math helpers."""

    x: float
    y: float
    z: float

    def __add__(self, other: "Vector3") -> "Vector3":
        return Vector3(self.x + other.x, self.y + other.y, self.z + other.z)

    def __sub__(self, other: "Vector3") -> "Vector3":
        return Vector3(self.x - other.x, self.y - other.y, self.z - other.z)

    def __mul__(self, scalar: float) -> "Vector3":
        return Vector3(self.x * scalar, self.y * scalar, self.z * scalar)

    __rmul__ = __mul__

    def __truediv__(self, scalar: float) -> "Vector3":
        return Vector3(self.x / scalar, self.y / scalar, self.z / scalar)

    def dot(self, other: "Vector3") -> float:
        return self.x * other.x + self.y * other.y + self.z * other.z

    def cross(self, other: "Vector3") -> "Vector3":
        return Vector3(
            self.y * other.z - self.z * other.y,
            self.z * other.x - self.x * other.z,
            self.x * other.y - self.y * other.x,
        )

    def length(self) -> float:
        return math.sqrt(self.dot(self))

    def normalized(self) -> "Vector3":
        length = self.length()
        if length == 0.0:
            raise ValueError("Cannot normalize zero-length vector")
        return self / length

    def lerp(self, other: "Vector3", t: float) -> "Vector3":
        return self * (1.0 - t) + other * t

    def clamp_length(self, max_length: float) -> "Vector3":
        length = self.length()
        if length <= max_length:
            return self
        if length == 0.0:
            return self
        return self * (max_length / length)

    @staticmethod
    def zero() -> "Vector3":
        return Vector3(0.0, 0.0, 0.0)

    @staticmethod
    def unit_z() -> "Vector3":
        return Vector3(0.0, 0.0, 1.0)

    @staticmethod
    def from_iter(values: Iterable[float]) -> "Vector3":
        x, y, z = values
        return Vector3(float(x), float(y), float(z))


def orthonormalize(forward: Vector3, up_hint: Vector3) -> tuple[Vector3, Vector3, Vector3]:
    """Return a right-handed orthonormal basis given a forward vector.

    The function follows the classic "Gram-Schmidt with fallback"
    approach: project the hint vector out of the forward component and
    renormalize. Should the hint happen to be parallel to the forward
    vector, a simple deterministic fallback axis is used instead.
    """

    fwd = forward.normalized()
    up_projected = up_hint - fwd * fwd.dot(up_hint)
    length = up_projected.length()
    if length < 1e-6:
        # Deterministic fallback based solely on the forward components.
        fallback = Vector3(1.0, 0.0, 0.0) if abs(fwd.z) > 0.707 else Vector3(0.0, 0.0, 1.0)
        up_projected = fallback - fwd * fwd.dot(fallback)
        length = up_projected.length()
    up = up_projected / length
    right = fwd.cross(up)
    return fwd, up, right


def rotate_towards(vector: Vector3, target: Vector3, max_angle_rad: float) -> Vector3:
    """Rotate ``vector`` toward ``target`` without exceeding ``max_angle_rad``.

    The rotation is carried out in the plane spanned by ``vector`` and
    ``target``. When the angle already falls within the limit no change
    is applied. This helper is used to clamp the direction field
    updates so the curve cannot fold onto itself between two rings.
    """

    if max_angle_rad <= 0.0:
        return vector

    v_norm = vector.normalized()
    t_norm = target.normalized()
    dot = max(-1.0, min(1.0, v_norm.dot(t_norm)))
    angle = math.acos(dot)
    if angle <= max_angle_rad:
        return t_norm

    axis = v_norm.cross(t_norm)
    axis_len = axis.length()
    if axis_len < 1e-8:
        # Vectors are parallel or antiparallel. When antiparallel we
        # pick a deterministic perpendicular axis.
        if dot < 0.0:
            if abs(v_norm.z) < 0.9:
                axis = v_norm.cross(Vector3.unit_z())
            else:
                axis = v_norm.cross(Vector3(0.0, 1.0, 0.0))
            axis_len = axis.length()
            if axis_len < 1e-8:
                return v_norm
        else:
            return v_norm
    axis = axis / axis_len
    sin_theta = math.sin(max_angle_rad)
    cos_theta = math.cos(max_angle_rad)
    return (
        v_norm * cos_theta
        + axis.cross(v_norm) * sin_theta
        + axis * axis.dot(v_norm) * (1.0 - cos_theta)
    )
