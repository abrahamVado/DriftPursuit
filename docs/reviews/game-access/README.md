# DriftPursuit Web Client Capabilities

## Docker Availability
- The repository ships a `docker-compose.yml` configuration that builds three services (`broker`, `bot-runner`, `web-client`).
- The `web-client` service exposes port 3000, depends on the broker, and injects the `NEXT_PUBLIC_BROKER_URL` needed for the Next.js front-end to connect.

## Three.js Game Client
- The Next.js client in `tunnelcave_sandbox_web` mounts the game shell inside `<div id="canvas-root">`, creating a deterministic canvas for rendering.
- `ClientBootstrap` dynamically imports the runtime shell and mounts it once the broker URL is resolved, ensuring the HUD and 3D renderer initialize when the page loads.

## Procedural Vehicle Geometry
- The shared TypeScript client (`typescript-client`) includes a `VehicleSceneManager` that generates vehicle meshes from procedural geometry, assembles wheels and spoilers, and keeps them synchronised with server telemetry.
- Unit tests in `vehicleSceneManager.test.ts` confirm that the scene manager updates positions/orientations and dispatches control intents to a simulation bridge.

## Conclusion
- Running `docker compose up` starts the stack and serves the playable client on `http://localhost:3000`, complete with a Three.js-rendered vehicle that responds to state updates.
