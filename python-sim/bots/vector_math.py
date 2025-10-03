"""Lightweight 2D vector helpers for bot navigation logic."""

from __future__ import annotations

from math import atan2, hypot
from typing import Iterable, Tuple


def distance(a: Iterable[float], b: Iterable[float]) -> float:
    """Compute the Euclidean distance between two points."""

    ax, ay = a
    bx, by = b
    # //1.- Use hypot so floating point precision stays robust for long patrol paths.
    return hypot(bx - ax, by - ay)


def direction(a: Iterable[float], b: Iterable[float]) -> Tuple[float, float]:
    """Return a unit vector pointing from a to b."""

    ax, ay = a
    bx, by = b
    dx = bx - ax
    dy = by - ay
    mag = hypot(dx, dy) or 1.0
    # //2.- Normalise to keep the vector safe for multiplication with speed factors.
    return (dx / mag, dy / mag)


def heading_to(a: Iterable[float], b: Iterable[float]) -> float:
    """Compute the signed steering input required to face target b from a."""

    ax, ay, heading = a
    tx, ty = b
    desired = atan2(ty - ay, tx - ax)
    delta = desired - heading
    # //3.- Wrap the delta into the [-pi, pi] range for consistent steering decisions.
    while delta > 3.141592653589793:
        delta -= 2 * 3.141592653589793
    while delta < -3.141592653589793:
        delta += 2 * 3.141592653589793
    # //4.- Convert the angle into a steer value by dividing by pi.
    return max(-1.0, min(1.0, delta / 3.141592653589793))


def velocity_towards(speed: float, direction_vector: Iterable[float]) -> Tuple[float, float]:
    """Scale a unit direction vector by the requested speed."""

    dx, dy = direction_vector
    # //5.- Multiply components individually to keep the helper branch-free.
    return (dx * speed, dy * speed)


__all__ = ["distance", "direction", "heading_to", "velocity_towards"]
