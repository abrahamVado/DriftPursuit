"""Descriptor helpers annotating spline nodes with gameplay metadata."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Sequence, Tuple

SPAWN_TAG = "spawn"
SET_DRESSING_TAG = "set_dressing"


# //1.- Represent metadata for a single spline node within the generated loop.
@dataclass(frozen=True)
class SplineNodeDescriptor:
    index: int
    position: Tuple[float, float, float]
    radius: float
    tags: Tuple[str, ...]

    # //2.- Provide convenience helpers to query tag membership quickly.
    def has_tag(self, tag: str) -> bool:
        return tag in self.tags


# //3.- Aggregate spline node descriptors for downstream systems.
@dataclass(frozen=True)
class WorldDescriptor:
    nodes: Tuple[SplineNodeDescriptor, ...]

    # //4.- Filter nodes by metadata tag preserving ordering along the spline.
    def tagged(self, tag: str) -> Tuple[SplineNodeDescriptor, ...]:
        return tuple(node for node in self.nodes if node.has_tag(tag))


# //5.- Pick a stable spawn index prioritizing authored room locations.
def _select_spawn_index(radii: Sequence[float], room_indices: Sequence[int]) -> int:
    if room_indices:
        return int(room_indices[0])
    if not radii:
        raise ValueError("Cannot choose spawn index from empty radii profile")
    max_index = max(range(len(radii)), key=lambda idx: radii[idx])
    return int(max_index)


# //6.- Normalize tag tuples ensuring determinism for serialization and hashing.
def _finalize_tags(tags: Iterable[str]) -> Tuple[str, ...]:
    unique = sorted({tag for tag in tags})
    return tuple(unique)


# //7.- Build world descriptor aligning positions, radii, and metadata tags.
def build_loop_descriptor(
    path: Sequence[Sequence[float]],
    radii: Sequence[float],
    room_indices: Sequence[int],
) -> WorldDescriptor:
    if len(path) != len(radii):
        raise ValueError("Path and radii must contain the same number of entries")
    spawn_index = _select_spawn_index(radii, room_indices)
    room_lookup = set(int(index) for index in room_indices)
    nodes = []
    for index, position in enumerate(path):
        tags = []
        if index == spawn_index:
            tags.append(SPAWN_TAG)
        if index in room_lookup:
            tags.append(SET_DRESSING_TAG)
        descriptor = SplineNodeDescriptor(
            index=int(index),
            position=tuple(float(component) for component in position),
            radius=float(radii[index]),
            tags=_finalize_tags(tags),
        )
        nodes.append(descriptor)
    return WorldDescriptor(nodes=tuple(nodes))
