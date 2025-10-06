"""Physics utilities for collision detection using signed distance fields."""

from .sdf import (
    SignedDistanceField,
    SphereField,
    PlaneField,
    RayHit,
)
from .penetration import BodyState, advance_body, advance_surface_bound_body
from .planet import (
    CubedSphereTile,
    PlanetSDF,
    PlanetSpec,
    TileScatterer,
    TileStreamer,
)

__all__ = [
    "SignedDistanceField",
    "SphereField",
    "PlaneField",
    "RayHit",
    "BodyState",
    "advance_body",
    "advance_surface_bound_body",
    "PlanetSpec",
    "PlanetSDF",
    "CubedSphereTile",
    "TileStreamer",
    "TileScatterer",
]
