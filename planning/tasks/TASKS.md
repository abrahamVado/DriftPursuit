# Integration Tasks for Web-Based Vehicle Control

## Objective
Enable interactive control of existing 3D vehicle simulations from a Next.js web application by leveraging assets and logic already available in the `python-sim` and `tunnelcave_sandbox` projects. Assess alternative interaction options (such as a pure Python control surface) as contingency paths.

## Task Breakdown

### 1. Audit Existing Simulation Assets and Interfaces
- [ ] Inventory 3D models and simulation logic currently available in `python-sim`, `tunnelcave_sandbox`, and `tunnelcave_sandbox_web`.
- [ ] Document asset formats, physics/update loops, and any existing APIs or sockets exposed by the simulation.
- [ ] Verify licensing and size constraints for transferring assets to the web client.

### 2. Define Communication Layer Between Simulation and Web Client
- [ ] Evaluate whether the simulation should run server-side (Python) with a real-time data stream or be ported to run entirely in the browser.
- [ ] Select a transport protocol (e.g., WebSockets, WebRTC, REST) to synchronize state between Python back end and Next.js front end.
- [ ] Prototype a minimal handshake between Python simulation process and a dummy Next.js endpoint to validate connectivity.

### 3. Prepare 3D Assets for Web Consumption
- [ ] Convert or export required models to browser-friendly formats (e.g., glTF/GLB) while keeping polycount manageable.
- [ ] Establish a shared asset pipeline so updates in `python-sim` can be mirrored to the Next.js project automatically.
- [ ] Create documentation that details asset conversion steps and storage locations in the repo.

### 4. Implement Next.js Front-End Rendering and Controls
- [ ] Integrate a 3D rendering library (such as Three.js or react-three-fiber) into the Next.js application.
- [ ] Load converted models and ensure they render correctly with lighting and materials that match the simulation aesthetic.
- [ ] Implement vehicle control UI and map control inputs (keyboard, gamepad, or on-screen) to simulation commands.
- [ ] Add client-side tests covering rendering initialization and basic control input handling.

### 5. Implement Back-End Simulation Control API
- [ ] Expose simulation state and control endpoints in Python (e.g., FastAPI or Flask service) that relay commands to the vehicles.
- [ ] Ensure synchronization of state updates (position, velocity, etc.) and broadcast to connected web clients.
- [ ] Add automated tests validating command routing and state update payloads.

### 6. Synchronize Simulation State to Browser
- [ ] Establish streaming updates (WebSocket channels or polling) to push vehicle telemetry to the Next.js app.
- [ ] Implement client-side state reconciliation to avoid jitter (e.g., interpolation/extrapolation).
- [ ] Add tests to verify correct handling of incoming telemetry and update loops.

### 7. Explore Alternative Interaction Surfaces
- [ ] Prototype a Python-native control interface (CLI or desktop) that uses the same back-end API, ensuring flexibility beyond the browser.
- [ ] Document pros/cons, performance characteristics, and maintenance implications of each interaction approach.

### 8. Deployment and DevOps Considerations
- [ ] Define local development workflow (Docker Compose or scripts) for running simulation back end alongside Next.js front end.
- [ ] Plan deployment targets (e.g., containerized services) and ensure network/security configurations support real-time control.
- [ ] Add CI steps for linting, tests, and integration checks across Python and Next.js components.

### 9. Documentation and Knowledge Transfer
- [ ] Produce setup guides for developers covering asset conversion, environment configuration, and running the integrated system.
- [ ] Create user documentation describing how to control vehicles via the web interface and any alternative clients.
- [ ] Schedule walkthrough sessions or recordings to onboard the team to the new interaction model.

## Deliverables
- Task completion checklist with owner assignments and timelines.
- Working prototype demonstrating browser-based vehicle control with synchronized simulation state.
- Supporting documentation, automated tests, and deployment artifacts.
