DriftPursuit Protocol (minimal)

Messages are JSON. Key types used in the starter:

1) Telemetry (sim -> broker -> viewers)
{ "type":"telemetry", "id":"plane-1", "t": 12.34, "pos":[x,y,z], "vel":[vx,vy,vz], "ori":[yaw,pitch,roll], "tags":["pastel:turq"] }

2) Cake drop (sim -> broker -> viewers)
{ "type":"cake_drop", "id":"cake-1", "from":"plane-1", "pos":[x,y,z], "landing_pos":[x2,y2,z2], "status":"in_flight" }

3) Command (viewer -> sim)
{ "type":"command", "cmd":"drop_cake", "from":"viewer-A", "target_id":"target-3", "params":{} }

The broker simply relays messages to all connected clients in this starter.

## Broker liveness

The broker performs WebSocket liveness checks by sending periodic ping
messages (default every 30 seconds, configurable via the
`--ping-interval` flag). Each pong extends the connection deadline. If a
peer fails to reply, the broker closes the connection and frees the
associated resources so operators do not need to restart the process to
recover stuck sessions.
