"""Arcade-leaning flight dynamics model for the gameplay prototype."""
from __future__ import annotations

import math
from dataclasses import dataclass
from enum import Enum, auto

from . import vector
from .terrain import TerrainSampler
from .vector import Vector3


# //1.- Describe the selectable control schemes.
class ControlMode(Enum):
    ARCADE = auto()
    DIRECT = auto()


# //2.- Bundle tunable parameters for the flight model.
@dataclass(frozen=True)
class FlightParameters:
    mass: float = 3200.0
    thrust_max: float = 180000.0
    drag_forward: float = 0.3
    drag_lateral: float = 0.7
    drag_vertical: float = 0.8
    lift_coefficient: float = 320.0
    induced_drag: float = 0.08
    control_authority: float = 2.5
    angular_damping: float = 1.2
    boost_thrust: float = 90000.0
    boost_duration: float = 2.0
    boost_cooldown: float = 5.0
    nose_radius: float = 2.5
    body_radius: float = 3.5


# //3.- Collect pilot input in a consistent structure.
@dataclass(frozen=True)
class FlightInput:
    mode: ControlMode
    aim_direction: Vector3 = (0.0, 0.0, 1.0)
    pitch: float = 0.0
    roll: float = 0.0
    yaw: float = 0.0
    throttle_delta: float = 0.0
    boost: bool = False
    airbrake: bool = False


# //4.- Maintain orientation using orthonormal basis vectors.
@dataclass(frozen=True)
class Orientation:
    forward: Vector3
    up: Vector3

    def normalized(self) -> "Orientation":
        forward = vector.normalize(self.forward, (0.0, 0.0, 1.0))
        up = vector.normalize(self.up, (0.0, 1.0, 0.0))
        right = vector.normalize(vector.cross(forward, up), (1.0, 0.0, 0.0))
        corrected_up = vector.normalize(vector.cross(right, forward), (0.0, 1.0, 0.0))
        return Orientation(forward=forward, up=corrected_up)

    def right(self) -> Vector3:
        ortho = self.normalized()
        return vector.normalize(vector.cross(ortho.forward, ortho.up), (1.0, 0.0, 0.0))


# //5.- Persist aircraft state between simulation ticks.
@dataclass(frozen=True)
class VehicleState:
    position: Vector3
    velocity: Vector3
    angular_velocity: Vector3
    orientation: Orientation
    throttle: float
    boost_timer: float
    boost_cooldown: float
    damage: float
    altitude_agl: float
    bank_angle: float
    stall_level: float

    def capsule_points(self, parameters: FlightParameters) -> tuple[Vector3, Vector3]:
        orientation = self.orientation.normalized()
        forward = orientation.forward
        tail_offset = vector.scale(forward, -7.5)
        nose_offset = vector.scale(forward, 8.5)
        tail = vector.add(self.position, tail_offset)
        nose = vector.add(self.position, nose_offset)
        return nose, tail


# //6.- Utility computing aerodynamic drag per axis.
def _quadratic_drag(component: float, coefficient: float) -> float:
    return -math.copysign(component * component * coefficient, component)


# //7.- Evaluate aerodynamic forces for the aircraft body.
def _aerodynamic_forces(state: VehicleState, params: FlightParameters) -> Vector3:
    orientation = state.orientation.normalized()
    forward = orientation.forward
    up = orientation.up
    right = orientation.right()
    v_forward = vector.dot(state.velocity, forward)
    v_up = vector.dot(state.velocity, up)
    v_right = vector.dot(state.velocity, right)
    drag_forward = _quadratic_drag(v_forward, params.drag_forward)
    drag_up = _quadratic_drag(v_up, params.drag_vertical)
    drag_right = _quadratic_drag(v_right, params.drag_lateral)
    drag = vector.add(
        vector.scale(forward, drag_forward),
        vector.add(vector.scale(up, drag_up), vector.scale(right, drag_right)),
    )
    aoa = math.atan2(v_up, abs(v_forward) + 1e-5)
    lift = params.lift_coefficient * v_forward * v_forward * aoa
    lift_vector = vector.scale(up, lift)
    induced_drag = vector.scale(forward, -params.induced_drag * aoa * aoa * v_forward * v_forward)
    return vector.add(drag, vector.add(lift_vector, induced_drag))


# //8.- Apply ground effect modifiers as the vehicle nears the ground.
def _apply_ground_effect(force: Vector3, altitude: float) -> Vector3:
    if altitude >= 5.0:
        return force
    multiplier = 1.0 + (5.0 - altitude) * 0.08
    drag_scale = 1.0 + (5.0 - altitude) * 0.05
    up_component = vector.project(force, (0.0, 1.0, 0.0))
    tangential = vector.subtract(force, up_component)
    return vector.add(vector.scale(up_component, multiplier), vector.scale(tangential, drag_scale))


# //9.- Update angular velocity given pilot input and control scheme.
def _update_angular_velocity(state: VehicleState, inputs: FlightInput, params: FlightParameters, dt: float) -> Vector3:
    orientation = state.orientation.normalized()
    angular_velocity = vector.scale(state.angular_velocity, max(0.0, 1.0 - params.angular_damping * dt))
    if inputs.mode is ControlMode.ARCADE:
        desired = vector.normalize(inputs.aim_direction, orientation.forward)
        axis = vector.cross(orientation.forward, desired)
        alignment = vector.dot(orientation.forward, desired)
        rate = (1.0 - alignment) * params.control_authority * 1.2
        correction = vector.scale(axis, rate)
        angular_velocity = vector.lerp(angular_velocity, correction, min(1.0, dt * 4.0))
    else:
        right = orientation.right()
        forward = orientation.forward
        up = orientation.up
        airspeed = vector.length(state.velocity)
        authority_scale = min(1.0, airspeed / 80.0)
        pitch = vector.scale(right, inputs.pitch * params.control_authority * authority_scale)
        yaw = vector.scale(up, inputs.yaw * params.control_authority * authority_scale)
        roll = vector.scale(forward, inputs.roll * params.control_authority)
        angular_velocity = vector.add(angular_velocity, vector.add(pitch, vector.add(yaw, roll)))
    return angular_velocity


# //10.- Integrate orientation using angular velocity and re-orthonormalize the basis.
def _integrate_orientation(orientation: Orientation, angular_velocity: Vector3, dt: float) -> Orientation:
    omega = angular_velocity
    forward = orientation.forward
    up = orientation.up
    delta_forward = vector.cross(omega, forward)
    delta_up = vector.cross(omega, up)
    new_forward = vector.add(forward, vector.scale(delta_forward, dt))
    new_up = vector.add(up, vector.scale(delta_up, dt))
    return Orientation(forward=new_forward, up=new_up).normalized()


# //11.- Compute throttle and boost state transitions.
def _update_propulsion(state: VehicleState, inputs: FlightInput, params: FlightParameters, dt: float) -> tuple[float, float, float, float]:
    throttle = min(1.0, max(0.0, state.throttle + inputs.throttle_delta * dt))
    boost_timer = max(0.0, state.boost_timer - dt)
    boost_cooldown = max(0.0, state.boost_cooldown - dt)
    boost_active = False
    if inputs.boost and boost_timer <= 0.0 and boost_cooldown <= 0.0 and throttle > 0.5:
        boost_timer = params.boost_duration
        boost_cooldown = params.boost_cooldown + params.boost_duration
        boost_active = True
    elif boost_timer > 0.0:
        boost_active = True
    return throttle, boost_timer, boost_cooldown, (params.boost_thrust if boost_active else 0.0)


# //12.- Integrate the vehicle state applying aerodynamic forces and collisions externally.
def integrate_flight(
    state: VehicleState,
    inputs: FlightInput,
    terrain: TerrainSampler,
    params: FlightParameters,
    dt: float,
) -> VehicleState:
    orientation = state.orientation.normalized()
    angular_velocity = _update_angular_velocity(state, inputs, params, dt)
    orientation = _integrate_orientation(orientation, angular_velocity, dt)
    throttle, boost_timer, boost_cooldown, boost_force = _update_propulsion(state, inputs, params, dt)
    forward = orientation.forward
    forces = _aerodynamic_forces(state, params)
    altitude = terrain.sample(state.position[0], state.position[2]).ground_height
    agl = state.position[1] - altitude
    forces = _apply_ground_effect(forces, agl)
    thrust = vector.scale(forward, params.thrust_max * throttle + boost_force)
    net_force = vector.add(forces, thrust)
    acceleration = vector.scale(net_force, 1.0 / params.mass)
    velocity = vector.add(state.velocity, vector.scale(acceleration, dt))
    if inputs.airbrake:
        velocity = vector.scale(velocity, max(0.0, 1.0 - dt * 2.5))
    position = vector.add(state.position, vector.scale(velocity, dt))
    speed = vector.length(velocity)
    stall_level = max(0.0, 1.0 - speed / 60.0)
    bank_angle = math.atan2(vector.dot(orientation.right(), (0.0, 1.0, 0.0)), vector.dot(orientation.up, (0.0, 1.0, 0.0)))
    damage = min(1.0, state.damage + stall_level * 0.01 * dt)
    return VehicleState(
        position=position,
        velocity=velocity,
        angular_velocity=angular_velocity,
        orientation=orientation,
        throttle=throttle,
        boost_timer=boost_timer,
        boost_cooldown=boost_cooldown,
        damage=damage,
        altitude_agl=agl,
        bank_angle=bank_angle,
        stall_level=stall_level,
    )


# //13.- Initialize vehicle state with sensible defaults at spawn time.
def spawn_state(position: Vector3 = (0.0, 120.0, 0.0)) -> VehicleState:
    orientation = Orientation(forward=(0.0, 0.0, 1.0), up=(0.0, 1.0, 0.0))
    return VehicleState(
        position=position,
        velocity=(0.0, 0.0, 0.0),
        angular_velocity=(0.0, 0.0, 0.0),
        orientation=orientation,
        throttle=0.6,
        boost_timer=0.0,
        boost_cooldown=0.0,
        damage=0.0,
        altitude_agl=position[1],
        bank_angle=0.0,
        stall_level=0.0,
    )
