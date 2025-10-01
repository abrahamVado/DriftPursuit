"""Orthonormal frame utilities for the cave path."""
from __future__ import annotations

import math
from dataclasses import dataclass

from .vector import Vector3, orthonormalize


@dataclass(frozen=True)
class OrthonormalFrame:
    """Coordinate frame that travels along the tunnel path."""

    origin: Vector3
    forward: Vector3
    right: Vector3
    up: Vector3

    def transport(self, new_origin: Vector3, new_forward: Vector3) -> "OrthonormalFrame":
        """Move the frame using parallel transport.

        The method keeps the in-plane axes free of unnecessary spins by
        rotating them only by the minimal rotation that maps the old
        forward direction into the new forward direction.
        """

        old_forward = self.forward
        new_forward_norm = new_forward.normalized()
        dot = max(-1.0, min(1.0, old_forward.dot(new_forward_norm)))
        angle = math.acos(dot)
        if angle < 1e-6:
            return OrthonormalFrame(new_origin, new_forward_norm, self.right, self.up)

        axis = old_forward.cross(new_forward_norm)
        axis_length = axis.length()
        if axis_length < 1e-8:
            # The directions are opposite. We rotate around a stable axis
            # that depends only on the forward vector to avoid sudden flips.
            axis = self.right if abs(old_forward.dot(self.right)) < 0.9 else self.up
            axis_length = axis.length()
        axis = axis / axis_length

        right_rotated = _rotate_vector(self.right, axis, angle)
        up_rotated = _rotate_vector(self.up, axis, angle)
        return OrthonormalFrame(new_origin, new_forward_norm, right_rotated, up_rotated)

    @staticmethod
    def initial(origin: Vector3, forward: Vector3) -> "OrthonormalFrame":
        fwd, up, right = orthonormalize(forward, Vector3(0.0, 1.0, 0.0))
        return OrthonormalFrame(origin, fwd, right, up)


def _rotate_vector(vector: Vector3, axis: Vector3, angle: float) -> Vector3:
    """Rotate ``vector`` around ``axis`` by ``angle`` radians."""

    sin_theta = math.sin(angle)
    cos_theta = math.cos(angle)
    axis = axis.normalized()
    return (
        vector * cos_theta
        + axis.cross(vector) * sin_theta
        + axis * axis.dot(vector) * (1.0 - cos_theta)
    )
