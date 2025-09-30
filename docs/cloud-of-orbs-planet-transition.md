# Cloud of Orbs → Planet Surface Transition Architecture

This document describes how the solar system sandbox (`viewer/cloud-of-orbs`) transitions into the instanced planetary sandboxes powered by the Terra terrain systems. It includes an audit of the current orbital content, the state machine that orchestrates the flow, the inputs that trigger transitions, and a manual validation plan.

## 1. Solar System Content Audit

Orbital bodies live in `viewer/cloud-of-orbs/planets`. Each module exports `metadata` with a relative radius (Earth = 1) and orbit distance (astronomical units). `SolarSystemWorld` scales these values by `radiusScale = 120` and `orbitScale = 3200` when building meshes, so the in-scene size and spacing are predictable.

| ID       | Label    | Radius (Earth = 1) | Radius in Scene (≈ units) | Orbit Distance (AU) | Orbit Distance in Scene (≈ units) | Trigger Notes |
|----------|----------|--------------------|----------------------------|---------------------|------------------------------------|---------------|
| `sun`    | Sun      | 109                | 13 080                     | 0                   | 0                                  | Central body; selectable but no orbital travel. |
| `mercury`| Mercury  | 0.383              | 45.96                      | 0.39                | 1 248                              | Planet trigger. |
| `venus`  | Venus    | 0.949              | 113.88                     | 0.72                | 2 304                              | Planet trigger. |
| `earth`  | Earth    | 1                  | 120                        | 1                   | 3 200                              | Planet trigger (default focus). |
| `mars`   | Mars     | 0.532              | 63.84                      | 1.52                | 4 864                              | Planet trigger. |
| `jupiter`| Jupiter  | 11.21              | 1 345.2                    | 5.2                 | 16 640                             | Planet trigger. |
| `saturn` | Saturn   | 9.45               | 1 134                      | 9.58                | 30 656                             | Planet trigger. |
| `uranus` | Uranus   | 4.01               | 481.2                      | 19.2                | 61 440                             | Planet trigger. |
| `neptune`| Neptune  | 3.88               | 465.6                      | 30.05               | 96 160                             | Planet trigger. |

* Player vehicle: `OrbitalPlayerShip` (`viewer/cloud-of-orbs/OrbitalPlayerShip.js`) scales the Terra plane mesh to 2.6× and orbits planets at ~3–6× their radius, so every planet sphere is significantly larger than the ship. The ship controller provides yaw/pitch/roll controls with maximum speeds around 9 600 units/second.
* Camera: `SolarSystemWorld` exposes a chase/orbit rig that keeps the ship framed at distances between ~260 and 3 600 units while respecting zoom limits per planet.

## 2. Transition State Machine

`PlanetSurfaceManager` (`viewer/cloud-of-orbs/PlanetSurfaceManager.js`) owns the high-level state machine:

```
SYSTEM_VIEW → APPROACH → SURFACE → DEPARTING → SYSTEM_VIEW
```

* **SYSTEM_VIEW** – orbital sandbox active, ship visible, HUD uses system preset. Planets spin and animate.
* **APPROACH** – after entering the planet’s `approachEnter` threshold (computed from planet radius). The chase camera engages, orbital HUD switches to approach preset, and surface assets begin preloading.
* **SURFACE** – when distance reaches `surfaceEnter`. The manager spins up Terra world streaming (`worldFactory.initializeWorldForMap`) and spawns vehicles. HUD switches to surface preset, and the chase camera follows the active Terra vehicle.
* **DEPARTING** – triggered when altitude exceeds `departLeave`. Used both for organic ascents and manual exits. HUD switches to departure preset until `systemLeave` is met.
* **Return** – once `systemLeave` is reached (or a manual exit override occurs), the surface world is torn down, and the solar-system view resumes near the original planet.

Distance thresholds default to `{ approachEnter: 6000, surfaceEnter: 1400, departLeave: 2600, systemLeave: 5200 }`, but are dynamically scaled per planet inside `SolarSystemWorld._computeThresholds`. Metrics are derived from the orbital ship’s range to the focused planet when the system view is active, or cached last-known distances when the orbital view is hidden.

## 3. Player Triggers and Controls

* **Approach trigger** – passive; getting within the computed `approachEnter` distance of the focused planet moves the state machine into APPROACH. Players can orbit-hop using bracket keys or HUD map selection.
* **Manual planet selection** – calling `selectPlanet` (via HUD or API) preloads assets and updates focus but does not force a state change.
* **Planet entry** – occurs automatically when closing to `surfaceEnter`. Orbital meshes are hidden via `SolarSystemWorld.exitSystemView()`, so no other spheres remain visible.
* **Manual exit** – pressing **O** (bound to `systemExitPlanet`) issues `requestSystemView({ reason: 'manual' })`, flagging a departure override. The manager immediately transitions into DEPARTING then SYSTEM_VIEW without waiting for altitude thresholds.
* **Automatic exit** – climbing above `departLeave` in the surface sandbox triggers DEPARTING; reaching `systemLeave` finishes the exit. Both manual and automatic exits restore the orbital view near the planet that was visited.

## 4. Scene Loading Responsibilities

* **Orbital scene** – `SolarSystemWorld` builds meshes for all registered bodies, updates rotation/orbit animation, and keeps the orbital ship state cached while the surface session is active.
* **Surface scene** – `PlanetSurfaceManager` activates Terra worlds on demand. It delegates to `initializeWorldForMap`, wires the collision, projectile, and vehicle systems, and resets vehicle populations on entry.
* **Environment swaps** – `applySpaceEnvironment()` in `viewer/cloud-of-orbs/main.js` resets the renderer background, fog, document background, and lighting when returning to space. Terra world activation applies environment overrides defined by the planet descriptor.
* **State logging** – both the manager and bootstrap now emit `console.debug` traces for state changes, aiding manual verification during development.

## 5. Adding New Planets

1. Create a module in `viewer/cloud-of-orbs/planets/` exporting `metadata`, `createOrbitalMesh`, and optionally `createSurfaceDescriptor`/`loadDetailAssets`.
2. Include the module in `PLANETS_IN_RENDER_ORDER` (`viewer/cloud-of-orbs/planets/index.js`).
3. Provide `metadata.radius` and `metadata.orbitDistance` for proper scaling; the orbital ship and thresholds automatically adapt.
4. (Optional) Supply a custom surface descriptor to load bespoke Terra terrain. Otherwise, the shared default descriptor (`DEFAULT_SURFACE_DESCRIPTOR`) seeds a procedural endless landscape.

## 6. Manual Test Plan

Execute these scenarios in a local viewer session (`npm run viewer` and open `viewer/cloud-of-orbs/index.html`):

1. **Orbital audit**
   - Verify each planet mesh appears at increasing distances according to the table above.
   - Confirm the orbital ship spawns near Earth with HUD in “Orbital Overview”.

2. **Planet entry flow**
   - Focus Earth via HUD or `[`. Fly toward the planet until the APPROACH preset activates.
   - Continue toward the planet; observe the SURFACE transition, Terra world loading, and absence of orbital spheres.

3. **Surface exploration**
   - Switch between plane/car modes, ensuring the chase camera follows correctly.
   - Fire projectiles and observe HUD updates.

4. **Automatic ascent exit**
   - From the surface, climb above the sky ceiling (`skyCeiling ≈ 1 800`) until the DEPARTING preset shows and the system view resumes. Confirm the ship respawns near the entry planet.

5. **Manual exit shortcut**
   - Re-enter any planet and press **O**. The manager should log a manual exit (`exitReason: 'manual'`), tear down the Terra world, and restore the orbital scene instantly.
   - Repeat entry/exit on another planet (e.g., Mars) to confirm state resets correctly.

6. **Re-entry regression check**
   - After returning to space, immediately approach the same planet again. Confirm assets reload, HUD presets cycle, and controls remain responsive.

7. **Performance spot check**
   - Monitor DevTools performance while entering two different planets consecutively. The Terra streamer should only load assets for the active planet, and `console.debug` output should confirm activation/disposal events.

## 7. Performance Considerations

* Terra terrain streaming is demand-driven; only one world exists at a time. Entry triggers `loadDetailAssets` (if provided) and spawns up to `maxDefaultVehicles` (default 5). Consider lowering this number for very large maps or mobile builds.
* Returning to space frees collision, projectile, and vehicle resources and reapplies the lightweight space environment to keep draw calls minimal.
* Manual exits bypass the altitude thresholds to shorten wait time—useful for debugging or for players who want immediate orbital travel.

This architecture supports repeated hops between planets with consistent camera, vehicle, and HUD behaviour while isolating heavy Terra assets to the moments when the player explores a surface.
