# Pipe Network Direction Field

The tunnel sandbox now supports a deterministic pipe-layout field in addition to
its original divergence-free curl-noise field. The `PipeNetworkField` stitches
straight runs, junction arcs, and smooth helixes into a repeatable sequence that
stays connected across long distances.

## Selecting the field

Choose the field by setting `TunnelParams.field_type` to `"pipe_network"`. The
field accepts an optional `PipeNetworkParams` structure that controls the basic
module lengths and curvature. The defaults already produce a varied layout, but
explicit configuration makes the sequence easier to reason about:

```python
from tunnelcave_sandbox.direction_field import PipeNetworkParams
from tunnelcave_sandbox.terrain_generator import TunnelParams

params = TunnelParams(
    world_seed=2024,
    chunk_length=24.0,
    ring_step=3.0,
    tube_sides=8,
    dir_freq=0.05,
    dir_blend=0.5,
    radius_base=5.0,
    radius_var=0.6,
    radius_freq=0.02,
    rough_amp=0.25,
    rough_freq=0.12,
    rough_smoothness=0.55,
    rough_filter_kernel=(0.2, 0.6, 0.2),
    jolt_every_meters=0.0,
    jolt_strength=0.0,
    max_turn_per_step_rad=0.85,
    mode="mesh+sdf",
    field_type="pipe_network",
    pipe_network=PipeNetworkParams(
        straight_length=10.0,
        helix_turns=1.5,
        helix_pitch=2.5,
        helix_radius=7.5,
        junction_angle_deg=60.0,
        junction_radius=8.0,
    ),
)
```

With this configuration the `TunnelTerrainGenerator` follows the deterministic
pipe network and emits rings exactly on the analytic path.

## Expected characteristics

* **Repeatable** – The path only depends on `world_seed` and the
  `PipeNetworkParams`, so re-instantiating the generator recreates the same
  topology.
* **Smoothly connected** – Straight segments, helical coils, and junction arcs
  share tangents at their boundaries to avoid kinks, which keeps ring frames
  aligned chunk-to-chunk.
* **Position hints** – `PipeNetworkField` exposes `position_at(arc_length)` so
  the terrain generator places each ring directly on the analytic curve rather
  than integrating the direction numerically.
