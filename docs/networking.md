# Gameplay networking contract

The websocket contract between the broker, gameplay clients, and automation
systems is formalised in the Protocol Buffers stored under
[`go-broker/internal/proto`](../go-broker/internal/proto). Generated Go bindings
live in `internal/proto/pb` and the Python artefacts used by simulation tools are
located in [`python-sim/driftpursuit_proto`](../python-sim/driftpursuit_proto).

Every payload contains a `schema_version` field with tag `1`. The canonical
version is tracked in [`proto/SCHEMA_VERSION`](../proto/SCHEMA_VERSION). The
current release is **v0.2.0** and follows the versioning workflow captured in
[`docs/networking_versioning.md`](./networking_versioning.md).

## Message families

| File | Purpose |
| ---- | ------- |
| `types.proto` | Common primitives such as `Vector3`, `Orientation`, and the `InterestTier` enum shared by the rest of the schema. |
| `snapshots.proto` | Entity state payloads (`EntitySnapshot`, `WorldSnapshot`) and the `ObserverState` message used by clients to express their point of view. |
| `events.proto` | Discrete `GameEvent` records that accompany the high frequency state stream. |
| `radar.proto` | `RadarFrame` envelopes that carry down-sampled sensor contacts for far away actors. |

The generated JSON representation matches the `protojson` camelCase defaults.
For example, `schema_version` appears as `schemaVersion` on the wire.

## Interest tier heuristics

The broker maintains per-client subscription buckets so that nearby actors
receive full-fidelity updates while far-away contacts fall back to radar or
summary feeds. The implementation lives in
[`internal/networking/tiers.go`](../go-broker/internal/networking/tiers.go) and
follows these rules:

- **Self (`SELF`)** — The observer always receives their own state.
- **Nearby (`NEARBY`)** — Entities within `nearby_range_m` (default 600m) are
  streamed with full snapshots.
- **Radar (`RADAR`)** — Entities within `radar_range_m` (default 3km) receive
  radar-rate updates with reduced payloads.
- **Extended (`EXTENDED`)** — Active entities outside the radar bubble but
  within `extended_range_m` (default 9km) are summarised for situational
  awareness.
- **Passive (`PASSIVE`)** — Inactive or destroyed entities only appear in global
  summaries.

`RadarFrame` payloads can suggest tighter buckets. When a contact supplies a
`SuggestedTier`, the broker applies the most restrictive tier between the radar
hint and the distance-based heuristic.

Clients should periodically send an `observer_state` message (using the
`ObserverState` schema) so the broker can keep the subscription buckets aligned
with the player's position.
