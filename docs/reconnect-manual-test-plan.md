# Reconnection Manual Test Plan

This checklist verifies that the viewer recovers gracefully when the WebSocket broker is stopped and restarted.

## Prerequisites

- A running build of the Go broker (`go-broker`) serving the viewer at `http://localhost:8080`.
- The DriftPursuit viewer opened in a modern browser tab that can remain focused during the test.
- Terminal access to start and stop the broker process.

## Test Steps

1. **Baseline connection**
   - Confirm the HUD shows `Connected to broker` and aircraft telemetry is updating.
   - Toggle manual control on and off once to ensure the UI is responsive.

2. **Interrupt the broker**
   - Stop or kill the broker process (for example with `Ctrl+C`).
   - Observe the HUD update within a second to display a reconnect spinner and countdown message.
   - Verify the manual/thrust buttons remain clickable but manual movement stops and the HUD shows `Manual (idle)`.

3. **Observe retry behaviour**
   - Keep the broker offline for at least two reconnect attempts (about 10–15 seconds).
   - Confirm the countdown decreases once per second and the attempt number increments across retries.

4. **Restore the broker**
   - Restart the broker process.
   - Watch the HUD transition from the countdown to `Connecting…` and then to `Connected to broker` without refreshing the page.
   - Ensure telemetry resumes and the camera re-locks onto the active aircraft.

5. **Manual control regression check**
   - Re-enable manual control after reconnection.
   - Verify manual overrides send correctly (aircraft responds to WASD/arrow keys and thrust).
   - Disable manual control and confirm the HUD returns to telemetry mode.

## Expected Results

- The HUD always communicates connection state (connecting, reconnect countdown with spinner, connected).
- Manual control state resets to an idle baseline during outages and is re-sent on reconnection.
- No manual reload of the viewer is required; the socket reconnects automatically once the broker is back online.
