"""Divergence-free noise utilities for cave generation."""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import List, Sequence, Tuple

from .config import GenerationSeeds


# //1.- Describe a harmonic component used to assemble curl noise.
@dataclass
class CurlHarmonic:
    wave_vector: Tuple[float, float, float]
    generator_vector: Tuple[float, float, float]
    phase: float
    weight: float

    # //2.- Precompute the curl direction ensuring divergence-free contributions.
    def curl_direction(self) -> Tuple[float, float, float]:
        direction = _cross(self.wave_vector, self.generator_vector)
        norm = _norm(direction)
        if norm == 0:
            # //3.- Degenerate case fallback by rotating generator vector.
            axis = (
                self.wave_vector[1],
                -self.wave_vector[0],
                self.wave_vector[2],
            )
            direction = _cross(self.wave_vector, axis)
            norm = _norm(direction)
        return _scale(direction, self.weight / max(norm, 1e-9))


# //4.- Helper generating harmonics from seeded random state.
def _create_harmonics(
    rng,
    count: int,
    frequency_range: Sequence[float] = (0.3, 2.5),
) -> List[CurlHarmonic]:
    harmonics: List[CurlHarmonic] = []
    low, high = frequency_range
    for _ in range(count):
        wave = tuple(rng.uniform(low, high) for _ in range(3))
        orient = tuple(rng.uniform(-1.0, 1.0) for _ in range(3))
        phase = rng.uniform(0, 2 * math.pi)
        weight = rng.uniform(0.4, 1.0)
        harmonics.append(
            CurlHarmonic(
                wave_vector=wave,
                generator_vector=orient,
                phase=phase,
                weight=weight,
            )
        )
    return harmonics


# //5.- Divergence-free field assembled as a sum of curl harmonics.
@dataclass
class DivergenceFreeField:
    harmonics: Sequence[CurlHarmonic]

    # //6.- Sample the vector field at a single 3D position.
    def sample(self, position: Sequence[float]) -> Tuple[float, float, float]:
        pos = _vector(position)
        total = (0.0, 0.0, 0.0)
        for harmonic in self.harmonics:
            curl_dir = harmonic.curl_direction()
            argument = _dot(harmonic.wave_vector, pos) + harmonic.phase
            total = _add(total, _scale(curl_dir, math.cos(argument)))
        return total

    # //7.- Vectorized sampling across multiple positions for efficiency.
    def batch_sample(self, positions: Sequence[Sequence[float]]) -> List[Tuple[float, float, float]]:
        return [self.sample(pos) for pos in positions]

    # //8.- Derive deterministic field from configured seeds.
    @classmethod
    def from_seeds(cls, seeds: GenerationSeeds, harmonic_count: int = 6) -> "DivergenceFreeField":
        generators = seeds.create_generators()
        harmonics = _create_harmonics(generators["divergence"], harmonic_count)
        return cls(harmonics=harmonics)


# //9.- Utility approximating divergence using central differences for validation.
def finite_difference_divergence(
    field: DivergenceFreeField,
    position: Sequence[float],
    epsilon: float = 1e-3,
) -> float:
    pos = _vector(position)
    offsets = (
        (epsilon, 0.0, 0.0),
        (0.0, epsilon, 0.0),
        (0.0, 0.0, epsilon),
    )
    divergence = 0.0
    for axis in range(3):
        forward = field.sample(_add(pos, offsets[axis]))
        backward = field.sample(_subtract(pos, offsets[axis]))
        divergence += (forward[axis] - backward[axis]) / (2 * epsilon)
    return float(divergence)


# //10.- Convenience method generating field trajectories for seeded paths.
def integrate_streamline(
    field: DivergenceFreeField,
    *,
    seed: Sequence[float],
    steps: int,
    step_size: float,
) -> List[Tuple[float, float, float]]:
    pos = list(_vector(seed))
    points: List[Tuple[float, float, float]] = [tuple(pos)]
    for _ in range(steps):
        direction = field.sample(pos)
        norm = _norm(direction)
        if norm < 1e-6:
            direction = (1.0, 0.0, 0.0)
            norm = 1.0
        step_vec = _scale(direction, step_size / norm)
        pos = list(_add(pos, step_vec))
        points.append(tuple(pos))
    return points


# //11.- Vector helper operations replacing NumPy dependencies.
def _vector(values: Sequence[float]) -> Tuple[float, float, float]:
    a, b, c = values
    return float(a), float(b), float(c)


def _add(a: Sequence[float], b: Sequence[float]) -> Tuple[float, float, float]:
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def _subtract(a: Sequence[float], b: Sequence[float]) -> Tuple[float, float, float]:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _scale(a: Sequence[float], scalar: float) -> Tuple[float, float, float]:
    return (a[0] * scalar, a[1] * scalar, a[2] * scalar)


def _dot(a: Sequence[float], b: Sequence[float]) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _cross(a: Sequence[float], b: Sequence[float]) -> Tuple[float, float, float]:
    return (
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    )


def _norm(a: Sequence[float]) -> float:
    return math.sqrt(_dot(a, a))
