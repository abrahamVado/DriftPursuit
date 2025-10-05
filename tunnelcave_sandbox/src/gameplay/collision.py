"""Collision detection helpers for the gameplay flight model."""
from __future__ import annotations

import math
from dataclasses import dataclass

from . import vector
from .placeables import PlaceableChunk, PlaceableField
from .terrain import TerrainSample, TerrainSampler
from .vector import Vector3


# //1.- Capture collision state for the vehicle capsule sweep.
@dataclass(frozen=True)
class CollisionResult:
    hit: bool
    contact_point: Vector3
    contact_normal: Vector3
    hazard: str
    kill: bool
    new_velocity: Vector3
    penetration_depth: float
    skid: bool
    damage: float
    yaw_kick: float


# //2.- Represent the capsule used to approximate the fuselage.
@dataclass(frozen=True)
class Capsule:
    nose: Vector3
    tail: Vector3
    radius: float

    def lerp(self, other: "Capsule", t: float) -> "Capsule":
        return Capsule(
            nose=vector.lerp(self.nose, other.nose, t),
            tail=vector.lerp(self.tail, other.tail, t),
            radius=self.radius * (1 - t) + other.radius * t,
        )

    @property
    def midpoint(self) -> Vector3:
        return vector.scale(vector.add(self.nose, self.tail), 0.5)


# //3.- Compute the closest point on a segment for distance checks.
def _closest_point_on_segment(point: Vector3, a: Vector3, b: Vector3) -> Vector3:
    ap = vector.subtract(point, a)
    ab = vector.subtract(b, a)
    denom = vector.dot(ab, ab)
    if denom == 0:
        return a
    t = max(0.0, min(1.0, vector.dot(ap, ab) / denom))
    return vector.add(a, vector.scale(ab, t))


# //4.- Determine intersection depth between a capsule and a sphere proxy.
def _capsule_sphere_penetration(capsule: Capsule, center: Vector3, radius: float) -> float:
    closest = _closest_point_on_segment(center, capsule.nose, capsule.tail)
    distance = vector.length(vector.subtract(center, closest))
    return radius + capsule.radius - distance


# //5.- Approximate vertical altitude of the capsule above ground.
def _altitude(sample: TerrainSample, capsule: Capsule) -> float:
    return capsule.midpoint[1] - sample.ground_height - capsule.radius


# //6.- Project a velocity vector against the contact normal applying restitution and friction.
def _resolve_ground_velocity(velocity: Vector3, normal: Vector3, restitution: float, friction: float) -> Vector3:
    normal_component = vector.project(velocity, normal)
    if vector.dot(normal_component, normal) > 0:
        return velocity
    tangential = vector.subtract(velocity, normal_component)
    bounce = vector.scale(normal, -vector.dot(velocity, normal) * max(restitution, 0.0))
    damp_tangent = vector.scale(tangential, max(0.0, 1.0 - friction))
    return vector.add(damp_tangent, bounce)


# //7.- Collision system coordinating terrain and prop queries.
class CollisionSystem:
    def __init__(
        self,
        sampler: TerrainSampler,
        field: PlaceableField,
        clearance: float = 1.5,
        max_slope: float = math.radians(60),
        hazard_speed: float = 60.0,
    ) -> None:
        self._sampler = sampler
        self._field = field
        self._clearance = float(clearance)
        self._max_slope = float(max_slope)
        self._hazard_speed = float(hazard_speed)

    def _chunk_for_point(self, point: Vector3) -> PlaceableChunk:
        size = self._field.chunk_size
        chunk_x = int(math.floor(point[0] / size))
        chunk_z = int(math.floor(point[2] / size))
        return self._field.chunk(chunk_x, chunk_z)

    def _terrain_contact(self, sample: TerrainSample, capsule: Capsule, velocity: Vector3) -> CollisionResult | None:
        altitude = _altitude(sample, capsule)
        if altitude > self._clearance:
            return None
        normal = sample.surface_normal
        skid = sample.slope_radians > self._max_slope
        new_velocity = _resolve_ground_velocity(velocity, normal, restitution=0.08, friction=0.35)
        penetration = self._clearance - altitude
        return CollisionResult(
            hit=True,
            contact_point=capsule.midpoint,
            contact_normal=normal,
            hazard="ground",
            kill=False,
            new_velocity=new_velocity,
            penetration_depth=penetration,
            skid=skid,
            damage=0.1 if skid else 0.0,
            yaw_kick=0.0,
        )

    def _ceiling_contact(self, sample: TerrainSample, capsule: Capsule, velocity: Vector3) -> CollisionResult | None:
        top = max(capsule.nose[1], capsule.tail[1]) + capsule.radius
        if top + self._clearance < sample.ceiling_height:
            return None
        normal = (0.0, -1.0, 0.0)
        reflected = list(velocity)
        reflected[1] = -reflected[1] * 0.2
        return CollisionResult(
            hit=True,
            contact_point=(capsule.midpoint[0], sample.ceiling_height, capsule.midpoint[2]),
            contact_normal=normal,
            hazard="ceiling",
            kill=False,
            new_velocity=(reflected[0], reflected[1], reflected[2]),
            penetration_depth=top - sample.ceiling_height,
            skid=False,
            damage=0.0,
            yaw_kick=0.0,
        )

    def _lake_contact(self, sample: TerrainSample, capsule: Capsule, speed: float) -> CollisionResult | None:
        if not sample.is_water:
            return None
        water_depth = capsule.midpoint[1] - sample.water_height
        if water_depth >= self._clearance:
            return None
        kill = speed > 45.0
        return CollisionResult(
            hit=True,
            contact_point=(capsule.midpoint[0], sample.water_height, capsule.midpoint[2]),
            contact_normal=(0.0, 1.0, 0.0),
            hazard="water",
            kill=kill,
            new_velocity=(0.0, 0.0, 0.0),
            penetration_depth=self._clearance - water_depth,
            skid=False,
            damage=0.5 if not kill else 1.0,
            yaw_kick=0.0,
        )

    def _rock_contact(self, capsule: Capsule, chunk: PlaceableChunk, velocity: Vector3, speed: float) -> CollisionResult | None:
        for rock in chunk.rocks:
            depth = _capsule_sphere_penetration(capsule, rock.center, rock.radius)
            if depth <= 0:
                continue
            kill = speed >= self._hazard_speed
            normal = vector.normalize(vector.subtract(capsule.midpoint, rock.center), (0.0, 1.0, 0.0))
            new_velocity = _resolve_ground_velocity(velocity, normal, restitution=0.05, friction=0.5)
            return CollisionResult(
                hit=True,
                contact_point=rock.center,
                contact_normal=normal,
                hazard="rock",
                kill=kill,
                new_velocity=new_velocity,
                penetration_depth=depth,
                skid=False,
                damage=0.8 if not kill else 1.0,
                yaw_kick=0.4,
            )
        return None

    def _tree_contact(self, capsule: Capsule, chunk: PlaceableChunk, velocity: Vector3, speed: float) -> CollisionResult | None:
        for tree in chunk.trees:
            trunk_radius = max(1.0, tree.crown_radius * 0.2)
            trunk_top = vector.add(tree.base_center, (0.0, tree.trunk_height, 0.0))
            closest = _closest_point_on_segment(capsule.midpoint, tree.base_center, trunk_top)
            distance = vector.length(vector.subtract(capsule.midpoint, closest))
            if distance > trunk_radius + capsule.radius:
                continue
            depth = trunk_radius + capsule.radius - distance
            kill = speed >= self._hazard_speed * 0.8
            normal = vector.normalize(vector.subtract(capsule.midpoint, closest), (0.0, 1.0, 0.0))
            new_velocity = _resolve_ground_velocity(velocity, normal, restitution=0.05, friction=0.4)
            return CollisionResult(
                hit=True,
                contact_point=closest,
                contact_normal=normal,
                hazard="tree",
                kill=kill,
                new_velocity=new_velocity,
                penetration_depth=depth,
                skid=False,
                damage=0.5 if not kill else 1.0,
                yaw_kick=0.6,
            )
        return None

    def sweep(
        self,
        previous: Capsule,
        current: Capsule,
        velocity: Vector3,
        speed: float,
    ) -> CollisionResult | None:
        steps = 8
        for step in range(1, steps + 1):
            t = step / steps
            capsule = previous.lerp(current, t)
            sample = self._sampler.sample(capsule.midpoint[0], capsule.midpoint[2])
            chunk = self._chunk_for_point(capsule.midpoint)
            for resolver in (
                lambda: self._lake_contact(sample, capsule, speed),
                lambda: self._terrain_contact(sample, capsule, velocity),
                lambda: self._ceiling_contact(sample, capsule, velocity),
                lambda: self._rock_contact(capsule, chunk, velocity, speed),
                lambda: self._tree_contact(capsule, chunk, velocity, speed),
            ):
                result = resolver()
                if result:
                    return result
        return None
