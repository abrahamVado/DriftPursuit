"""Deterministic smooth noise helpers used throughout the sandbox."""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Tuple


@dataclass(frozen=True)
class NoiseConfig:
    seed: int
    frequency: float


# -- Hash helpers ---------------------------------------------------------

def _hash3(seed: int, x: int, y: int, z: int) -> int:
    value = seed ^ (x * 374761393) ^ (y * 668265263) ^ (z * 2147483647)
    value = (value ^ (value >> 13)) * 1274126177
    value = value ^ (value >> 16)
    return value & 0xFFFFFFFF


def _gradient(seed: int, x: int, y: int, z: int) -> Tuple[float, float, float]:
    h = _hash3(seed, x, y, z)
    # Use the low bits to generate a normalized gradient vector.
    hx = ((h >> 0) & 0xFF) / 255.0 * 2.0 - 1.0
    hy = ((h >> 8) & 0xFF) / 255.0 * 2.0 - 1.0
    hz = ((h >> 16) & 0xFF) / 255.0 * 2.0 - 1.0
    length = math.sqrt(hx * hx + hy * hy + hz * hz) or 1.0
    return hx / length, hy / length, hz / length


def _fade(t: float) -> float:
    return t * t * t * (t * (t * 6 - 15) + 10)


def _lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


# -- Noise evaluators -----------------------------------------------------

def noise3(seed: int, x: float, y: float, z: float) -> float:
    """Classic Perlin-style gradient noise in 3D."""

    xi = math.floor(x)
    yi = math.floor(y)
    zi = math.floor(z)

    xf = x - xi
    yf = y - yi
    zf = z - zi

    gradients = {}
    dot_vals = {}
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                gx, gy, gz = _gradient(seed, xi + dx, yi + dy, zi + dz)
                dot = (xf - dx) * gx + (yf - dy) * gy + (zf - dz) * gz
                gradients[(dx, dy, dz)] = (gx, gy, gz)
                dot_vals[(dx, dy, dz)] = dot

    u = _fade(xf)
    v = _fade(yf)
    w = _fade(zf)

    x1 = _lerp(dot_vals[(0, 0, 0)], dot_vals[(1, 0, 0)], u)
    x2 = _lerp(dot_vals[(0, 1, 0)], dot_vals[(1, 1, 0)], u)
    x3 = _lerp(dot_vals[(0, 0, 1)], dot_vals[(1, 0, 1)], u)
    x4 = _lerp(dot_vals[(0, 1, 1)], dot_vals[(1, 1, 1)], u)

    y1 = _lerp(x1, x2, v)
    y2 = _lerp(x3, x4, v)

    return _lerp(y1, y2, w)


def noise3_periodic(seed: int, x: float, y: float, z: float, period: float) -> float:
    """3D noise with a period along the ``z`` axis.

    The function wraps the coordinate in a sine/cosine space so that
    samples at ``angle`` and ``angle + 2π`` are identical. This is used
    for the angular roughness to avoid seams when stitching rings.
    """

    sin_a = math.sin(z)
    cos_a = math.cos(z)
    scale = 1.0 / max(1e-5, period)
    return noise3(seed, x * scale + sin_a, y * scale + cos_a, z * scale)


def curl_noise(seed: int, position: Tuple[float, float, float], frequency: float) -> Tuple[float, float, float]:
    """Curl of a vector potential made of three independent noise fields."""

    px, py, pz = position
    scale = frequency
    sample = (px * scale, py * scale, pz * scale)
    eps = 0.01

    ax = noise3(seed + 101, *sample)
    ay = noise3(seed + 257, *sample)
    az = noise3(seed + 409, *sample)

    d_az_dy = (noise3(seed + 409, sample[0], sample[1] + eps, sample[2]) - noise3(seed + 409, sample[0], sample[1] - eps, sample[2])) / (2 * eps)
    d_ay_dz = (noise3(seed + 257, sample[0], sample[1], sample[2] + eps) - noise3(seed + 257, sample[0], sample[1], sample[2] - eps)) / (2 * eps)
    d_ax_dz = (noise3(seed + 101, sample[0], sample[1], sample[2] + eps) - noise3(seed + 101, sample[0], sample[1], sample[2] - eps)) / (2 * eps)
    d_az_dx = (noise3(seed + 409, sample[0] + eps, sample[1], sample[2]) - noise3(seed + 409, sample[0] - eps, sample[1], sample[2])) / (2 * eps)
    d_ay_dx = (noise3(seed + 257, sample[0] + eps, sample[1], sample[2]) - noise3(seed + 257, sample[0] - eps, sample[1], sample[2])) / (2 * eps)
    d_ax_dy = (noise3(seed + 101, sample[0], sample[1] + eps, sample[2]) - noise3(seed + 101, sample[0], sample[1] - eps, sample[2])) / (2 * eps)

    curl_x = d_az_dy - d_ay_dz
    curl_y = d_ax_dz - d_az_dx
    curl_z = d_ay_dx - d_ax_dy

    return curl_x, curl_y, curl_z
