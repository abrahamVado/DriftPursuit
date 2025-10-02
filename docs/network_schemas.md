# Vehicle state schema

//1.- Review the message definition

| Field | Type | Purpose |
| ----- | ---- | ------- |
| `schema_version` | `string` | Identifies the protocol version carried with every payload. |
| `vehicle_id` | `string` | Stable identifier for the vehicle supplying the snapshot. When omitted on input the broker substitutes the websocket envelope id. |
| `position` | `Vector3` | Latest location in metres relative to the simulation origin. |
| `velocity` | `Vector3` | Linear velocity vector in metres per second. |
| `orientation` | `Orientation` | Euler angles in degrees that follow the aerospace yaw, pitch, roll convention. |
| `angular_velocity` | `Vector3` | Instantaneous rotational velocity in degrees per second across the XYZ axes. |
| `speed_mps` | `double` | Forward speed magnitude in metres per second. |
| `throttle_pct` | `double` | Commanded forward thrust in the range [-1, 1]. |
| `vertical_thrust_pct` | `double` | Vertical thruster command in the range [-1, 1], where positive values climb. |
| `boost_pct` | `double` | Available boost energy reported as a 0-1 fraction. |
| `boost_active` | `bool` | Signals that boost is currently firing during this frame. |
| `flight_assist_enabled` | `bool` | Indicates the assisted flight mode is engaged. |
| `energy_remaining_pct` | `double` | Remaining energy or fuel as a 0-1 fraction of capacity. |
| `updated_at_ms` | `int64` | UTC timestamp in milliseconds describing when the state was sampled. |

//2.- Craft update payloads

Clients transmit vehicle state as JSON when publishing to the broker websocket. The broker validates the payload against the generated bindings before broadcasting and caching it for snapshot replay.

```json
{
  "type": "vehicle_state",
  "id": "veh-001",
  "schema_version": "0.2.0",
  "position": { "x": 1.0, "y": 2.0, "z": 3.0 },
  "velocity": { "x": 4.0, "y": 5.0, "z": 6.0 },
  "orientation": { "yaw_deg": 10.0, "pitch_deg": 5.0, "roll_deg": 1.0 },
  "angular_velocity": { "x": 0.1, "y": 0.2, "z": 0.3 },
  "speed_mps": 123.4,
  "throttle_pct": 0.5,
  "vertical_thrust_pct": -0.25,
  "boost_pct": 0.9,
  "boost_active": true,
  "flight_assist_enabled": true,
  "energy_remaining_pct": 0.75,
  "updated_at_ms": 123456789
}
```

The generated bindings streamline deserialisation in each language:

- **Go** — `protojson.Unmarshal` fills a `pb.VehicleState`. The broker stores the most recent clone in memory and replays it after restarts.
- **Python** — `vehicle_pb2.VehicleState.FromString` provides the strongly typed view needed by automation tools.
- **TypeScript** — The ts-proto bindings expose `VehicleState.encode`, `VehicleState.decode`, and JSON helpers so browser and Node clients can validate their payloads before delivery.
