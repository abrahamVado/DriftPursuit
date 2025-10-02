# Battle Royale Implementation Tasks

These tasks were extracted from `docs/battle_royale_plan.md` so the detailed plan can be archived while we execute on the actionable work.

## Core Services & Networking (Go)
- [ ] Add a 60 Hz authoritative simulation loop with state management to the Go broker.
- [ ] Define protobuf schemas and interest tiers for snapshots, events, and radar streams.
- [ ] Implement bandwidth prioritization, per-client LOD streaming, and the drop policy order.
- [ ] Expose compressed gRPC streams for Python bot state diffs and intent submissions.
- [ ] Broadcast server time offsets every 2 s and smooth clients to within ±50 ms skew.
- [ ] Support 100–150 ms reconciliation buffers and keyframe snapping when error exceeds 2 m / 15°.
- [ ] Enforce input hygiene (sequence IDs, duplicate/late drop >250 ms, ≤60 Hz input cap, intent validation).
- [ ] Hold average bandwidth at ≤48 kbps per client with 48 actors and record authoritative replays.
- [ ] Secure WebSocket clients with signed tokens and protect gRPC bots via mTLS/shared secrets.
- [ ] Deliver a reliable event channel for combat, radar contacts, respawns, and match lifecycle events.
- [ ] Emit replay logs combining events and 5 Hz world frames at match end.

### Schemas v0.1
- [ ] Finalize `VehicleState` with pose, velocity, health, ammo, and flag fields.
- [ ] Finalize `CombatEvent` covering identifiers, damage metadata, and directional data.
- [ ] Finalize `RadarContact` with contact details including confidence and occlusion.
- [ ] Finalize `Intent` covering throttles, rotation axes, boost, assist, and reset flags.

## Bot Interface (Python)
- [ ] Stream 20 Hz compressed state diffs to bots over gRPC.
- [ ] Accept 10–20 Hz gRPC intent messages from bots with ≤40 ms loop latency.
- [ ] Provide deterministic ECM resolution with seeded RNG per missile engagement.
- [ ] Ship reference patrol, chaser, coward, and ambusher bots using rate-limited FSMs.

## World & Map Generation
- [ ] Build a seeded divergence-free noise generator producing swept tube caves with analytic SDF.
- [ ] Cover 8–12 km loops with 12–25 m radius averages, 50 m rooms, and 10–35 m clearance constraints.
- [ ] Stream 150–250 m arc chunks around each player using world-position chunking.
- [ ] Drive collision via SDF sampling for vehicles and ray/sphere tests for projectiles.
- [ ] Tag 3–5 special spline stations for spawn/set-dressing and enforce entrance constraints.
- [ ] Resolve penetrations using SDF normals and zero inward velocity components.

## Vehicles, Controls & Physics
- [ ] Deliver free-flight physics integrating linear velocity and angular rates with assist alignment.
- [ ] Map controls (W/S throttle, A/D roll, I/K pitch, J/L yaw, N/M vertical, Shift boost, F assist, R reset).
- [ ] Configure the Aerial Skiff stats (speed, acceleration, rotation rates, vertical thrust, boost values).
- [ ] Reserve ground vehicle parameters for future work while keeping them surface-bound.
- [ ] Implement 3 s respawn delay, safe ring placement ahead, and spectator view during countdown.

### Vehicle Loadouts (v1)
- [ ] Define Arrow Head loadout (shells, missiles, decoys; ammo counts; +10% boost accel, light armor).
- [ ] Define Freedom Dorito loadout (shells, laser, missiles; ammo counts; +12% top speed, −10% HP).
- [ ] Reserve Tank class parameters for future heavy loadouts.
- [ ] Define SPAA loadout (AA missiles, laser, decoys; ammo counts; +20% radar gain, low agility).

## Combat & Sensors
- [ ] Implement shells, missiles, lasers, and decoys consistent with v1 loadouts.
- [ ] Model ECM deterministic guidance with seeded decoy break probability (65% → 20% window).
- [ ] Apply damage model for hits, splash, terrain collisions, and >30 m/s fatal impacts.
- [ ] Build radar with 600–900 m range, 4 Hz refresh, SDF occlusion, and last-known caches.
- [ ] Render HUD last-known contacts with fade, dashed mode, timestamp, and 1 s ghost trails.

## Client Experience (three.js)
- [ ] Implement WebSocket networking with interpolation/extrapolation and keyframe correction thresholds.
- [ ] Hook chase camera, shake, and FX to vehicle motion and combat impacts.
- [ ] Build HUD elements (health, ammo, boost/heat, radar, locks, speed, altitude, compass, scoreboard).
- [ ] Add accessibility features such as rebindable keys and color-safe radar palette.

## Session Model
- [ ] Maintain a single continuous drop-in/out match with configurable 48-actor capacity.
- [ ] Fill with bots until humans join, draining bots per human arrival.
- [ ] Guarantee late-join spawn safety with ±300 m probes and 1.5 s grace shields.

## Storage & Replay
- [ ] Define replay files (JSONL events + 5 Hz binary frames compressed via snappy/zstd).
- [ ] Persist match headers with seed, terrain parameters, schema version, and replay pointer.
- [ ] Manage retention for last 50 matches or 7 days, configurable via settings.

## Tooling & Ops
- [ ] Provide `/live`, `/ready`, `/metrics`, and `/replay/dump` endpoints.
- [ ] Emit structured JSON logs with trace IDs and rotation/compression.
- [ ] Add crash-safe recovery and join rejection during recovery windows.
- [ ] Drive configuration via environment variables for rates, caps, ports, and seeds.
- [ ] Package Docker images for Go server, Python bots, and web client with minimal Compose support.

## Acceptance Tests
- [ ] Validate 20 Hz snapshots with smooth interpolation under 2% packet loss.
- [ ] Verify bot loop latency ≤40 ms with reliable 10–20 Hz intents and minimal frame drops.
- [ ] Check combat tuning (missile decoy break curve, laser bypass, damage parity).
- [ ] Confirm radar occlusion, last-known visualization, and respawn safety behaviour.
- [ ] Measure bandwidth (≤48 kbps/client at 48 actors), replay file generation, and performance budgets (server ≤4 ms tick, client 60 FPS).

## Configuration & Versioning Notes
- [ ] Centralize all tunable numbers in `gameplayConfig.ts` with config-driven overrides.
- [ ] Version network schemas with backward-compatible additions in the `v0.x` series.
