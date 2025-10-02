"""Penetration resolution utilities for signed distance field collisions."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence, Tuple, cast

from .sdf import SignedDistanceField

Vector3 = Tuple[float, float, float]


@dataclass(frozen=True)
class BodyState:
    """State of a spherical body tracked by the simulation."""

    position: Vector3
    velocity: Vector3


def _to_vec3(value: Sequence[float]) -> Vector3:
    # //1.- Coerce arbitrary sequences into strict three-component tuples.
    components = tuple(float(component) for component in value)
    if len(components) != 3:
        raise ValueError("BodyState physics expects three-dimensional vectors")
    return cast(Vector3, components)


def _add(a: Sequence[float], b: Sequence[float]) -> Vector3:
    # //1.- Combine vectors component-wise for position integration.
    ax, ay, az = _to_vec3(a)
    bx, by, bz = _to_vec3(b)
    return (ax + bx, ay + by, az + bz)


def _scale(vector: Sequence[float], scalar: float) -> Vector3:
    # //1.- Multiply vectors by scalars to scale velocity by the timestep.
    vx, vy, vz = _to_vec3(vector)
    return (vx * scalar, vy * scalar, vz * scalar)


def _dot(a: Sequence[float], b: Sequence[float]) -> float:
    # //1.- Dot product facilitates velocity projection along contact normals.
    ax, ay, az = _to_vec3(a)
    bx, by, bz = _to_vec3(b)
    return ax * bx + ay * by + az * bz


def advance_body(
    state: BodyState,
    field: SignedDistanceField,
    *,
    radius: float,
    dt: float,
    normal_epsilon: float = 1e-3,
) -> BodyState:
    """Advance a body and resolve penetration against the signed distance field."""

    # //1.- Integrate the body's position forward using explicit Euler integration.
    predicted_position = _add(state.position, _scale(state.velocity, dt))
    intersects, clearance = field.sphere_intersection(predicted_position, radius)
    if not intersects:
        # //2.- Early exit when no penetration occurs after integration.
        return BodyState(position=predicted_position, velocity=state.velocity)

    # //3.- Derive the contact normal from the SDF gradient at the penetrated point.
    normal = field.surface_normal(predicted_position, epsilon=normal_epsilon)
    penetration_depth = -clearance
    corrected_position = _add(
        predicted_position,
        _scale(normal, penetration_depth),
    )

    # //4.- Remove inward normal velocity components to prevent re-penetration next frame.
    inward_speed = _dot(state.velocity, normal)
    if inward_speed < 0.0:
        corrected_velocity = _add(state.velocity, _scale(normal, -inward_speed))
    else:
        corrected_velocity = state.velocity

    return BodyState(position=corrected_position, velocity=corrected_velocity)


def advance_surface_bound_body(
    state: BodyState,
    field: SignedDistanceField,
    *,
    radius: float,
    dt: float,
    normal_epsilon: float = 1e-3,
) -> BodyState:
    """Advance a body while constraining it to remain attached to the surface."""

    # //1.- Reuse the standard integrator to resolve any downward penetration first.
    advanced = advance_body(state, field, radius=radius, dt=dt, normal_epsilon=normal_epsilon)
    _, clearance = field.sphere_intersection(advanced.position, radius)
    if clearance <= 0.0:
        # //2.- Already touching or intersecting the surface so no additional clamping is required.
        return advanced

    # //3.- Project the body back onto the surface to stop it from leaving the ground plane.
    normal = field.surface_normal(advanced.position, epsilon=normal_epsilon)
    corrected_position = _add(advanced.position, _scale(normal, -clearance))

    # //4.- Remove any upward velocity so the next frame remains glued to the track.
    upward_speed = _dot(advanced.velocity, normal)
    if upward_speed > 0.0:
        corrected_velocity = _add(advanced.velocity, _scale(normal, -upward_speed))
    else:
        corrected_velocity = advanced.velocity

    return BodyState(position=corrected_position, velocity=corrected_velocity)
