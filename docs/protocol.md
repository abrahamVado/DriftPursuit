DriftPursuit Protocol (minimal)

Messages are JSON. Key types used in the starter:

1) Telemetry (sim -> broker -> viewers)
{ "type":"telemetry", "id":"plane-1", "t": 12.34, "pos":[x,y,z], "vel":[vx,vy,vz], "ori":[yaw,pitch,roll], "tags":["pastel:turq"] }

2) Cake drop (sim -> broker -> viewers)
{ "type":"cake_drop", "id":"cake-1", "from":"plane-1", "pos":[x,y,z], "landing_pos":[x2,y2,z2], "status":"in_flight" }

3) Command (viewer -> sim)
{ "type":"command", "cmd":"drop_cake", "from":"viewer-A", "target_id":"target-3", "params":{} }

## Commands

The simulator understands a small set of verbs sent through ``type":"command``
messages. All commands are acknowledged with a ``command_status`` response (see
below) so tooling can confirm whether a payload was applied successfully.

### ``drop_cake``

Triggers a cake drop event. Optional fields:

* ``params.landing_pos`` – override landing coordinates ``[x, y, z]``.

### ``set_waypoints``

Updates the autopilot route managed by ``FlightPathPlanner``. The viewer's new
"Cycle Autopilot Route" button emits this verb with preset loops so the plane
reacts immediately without manual editing.

Required fields:

* ``params.waypoints`` – array of ``[x, y, z]`` triplets. At least one waypoint
  is required.

Optional fields:

* ``params.loop`` – boolean override to enable/disable looped navigation.
* ``params.arrival_tolerance`` – numeric distance threshold in simulation units
  that determines when the planner advances to the next waypoint.

### ``set_speed``

Adjusts the ``CruiseController`` tuning at runtime. The viewer toggles this
command whenever the forward acceleration control is engaged so the simulated
aircraft speeds up in sync with on-screen thrust cues.

At least one of the following fields must be supplied:

* ``params.max_speed`` – new cruise speed cap.
* ``params.acceleration`` – acceleration magnitude applied while ramping up to
  ``max_speed``.

## Command acknowledgements

Every command elicits a ``command_status`` message. ``status`` is ``"ok"`` for
successes and ``"error"`` otherwise. ``command_id`` echoes the optional
identifier supplied by the sender to simplify correlation.

Example:

{ "type":"command_status", "cmd":"set_waypoints", "status":"ok",
  "from":"plane-1", "target_id":"plane-1", "command_id":"viewer-4",
  "detail":"updated flight path", "result":{"waypoint_count":4,
  "loop":true, "arrival_tolerance":80.0} }

The broker simply relays messages to all connected clients in this starter.

## Broker liveness

The broker performs WebSocket liveness checks by sending periodic ping
messages (default every 30 seconds, configurable via the
`--ping-interval` flag). Each pong extends the connection deadline. If a
peer fails to reply, the broker closes the connection and frees the
associated resources so operators do not need to restart the process to
recover stuck sessions.
