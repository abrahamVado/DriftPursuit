# Spawn Safety QA Scenarios

## Late Joiner Spawn Validation

1. Load a replay or sandbox session with at least three active pilots in the tunnel loop.
2. Force one participant to spectate and rejoin while the rest maintain race pace.
3. Observe the respawn telemetry to confirm the broker places the reconnecting pilot at a ring whose safe volume lies within ±300 m of the anchor.
4. Verify that no other craft occupy the sampled safe volume and that the rejoining pilot inherits a forward vector aligned with traffic flow.

## Heavy Combat Spawn Shield Verification

1. Stage a firefight around a known respawn ring using live pilots or combat bots.
2. Eliminate a participant and trigger an immediate respawn request while explosions and projectiles continue nearby.
3. Inspect the published spawn event metadata and ensure the `spawn_shield_ms` value reports `1500`.
4. Confirm that combat logs show no damage applied to the respawned craft for the first 1.5 s, after which normal damage resumes.

## Regression Sweep

1. Replay previous QA captures focused on spawn collisions to confirm they now resolve without overlaps.
2. Run automated spawn selection unit tests and ensure they pass alongside combat event stream validations.
3. Capture telemetry for each scenario and archive it with notes so future regressions can reference the evidence.
