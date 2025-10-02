"""Spawn selection utilities that leverage spline metadata descriptors."""
from __future__ import annotations

from typing import Sequence

from ..generation.swept_tube import SweptTube
from ..world import SPAWN_TAG, SplineNodeDescriptor, WorldDescriptor


# //1.- Sample clearance by querying the swept tube's signed distance field.
def _node_clearance(tube: SweptTube, node: SplineNodeDescriptor) -> float:
    return float(-tube.sdf(node.position))


# //2.- Select a spawn node constrained by clearance safety thresholds.
def select_spawn_node(
    descriptor: WorldDescriptor,
    tube: SweptTube,
    *,
    clearance_threshold: float,
) -> SplineNodeDescriptor:
    spawn_nodes: Sequence[SplineNodeDescriptor] = descriptor.tagged(SPAWN_TAG)
    if not spawn_nodes:
        raise ValueError("Descriptor does not contain any spawn-tagged nodes")
    safe_nodes = [node for node in spawn_nodes if _node_clearance(tube, node) >= clearance_threshold]
    if not safe_nodes:
        raise ValueError("No spawn nodes satisfy the clearance threshold")
    return max(safe_nodes, key=lambda node: node.radius)
