# Casual Flight Control Scheme (Fixed Camera)

This scheme targets new pilots in a casual aviation game. It pairs an accessible keyboard layout with a horizon-aligned chase camera so players can appreciate every roll and bank without wrestling with simulator-grade controls.

## Key Bindings

| Action | Key(s) | Notes |
| --- | --- | --- |
| Pitch up / climb | `S` | Pulls the nose up. Gradually ramps pitch over ~0.6 s to avoid abrupt stalls. |
| Pitch down / dive | `W` | Lowers the nose. Auto-stabilization arrests the dive when released. |
| Roll left | `A` | Banks up to ±45° for dramatic but comfortable turns. |
| Roll right | `D` | Same roll rate limits as left roll. |
| Gentle yaw left (optional) | `←` (Left Arrow) | Applies a coordinated rudder slip to help line up turns without heavy roll input. |
| Gentle yaw right (optional) | `→` (Right Arrow) | Mirrors the left yaw behaviour; blend automatically with roll when both are held. |
| Throttle up | `↑` (Up Arrow) | Increases airspeed in 5% increments with soft acceleration smoothing. |
| Throttle down | `↓` (Down Arrow) | Decreases throttle in 5% steps; never cuts below 20% while airborne to maintain lift. |
| Auto aerobatics “stunt mode” | `Space` (tap) | Triggers a canned loop or barrel roll with built-in recovery. Lock controls until maneuver completes. |
| Camera zoom in | `Z` | Moves the camera 10 m closer (floor at 20 m). |
| Camera zoom out | `X` | Moves the camera 10 m farther (ceiling at 150 m). |
| Reset camera distance | `C` | Snaps the camera back to the default follow distance (80 m). |

> Tip: echo these bindings in a concise HUD panel so beginners always have the reference within view.

## Camera Placement & Presentation

* **Fixed, horizon-aligned framing:** The camera never rolls with the aircraft. Because the horizon stays level, players clearly see the wings tilting during a bank, which heightens the sense of motion and makes it easy to judge orientation.
* **Chase offset:** Park the camera 80 m behind and 15 m above the aircraft by default, easing toward the target position with critically damped smoothing. Clamp the adjustable distance between 20 m (close-up for aerobatics) and 150 m (wide scenic shots).
* **Field of view:** Keep a 65°–70° vertical FOV. It shows enough surrounding scenery while keeping the plane large enough to read motion cues.
* **Plane silhouette:** Use a light prop plane or small jet with a wingspan that fills ~25% of the screen width at the default distance. High-contrast wing tips or stripes make roll angles obvious against the sky.

## Forgiving Flight Model

* **Auto-stabilization:** When the player releases roll or pitch inputs, ease the aircraft back to level over ~1.5 s. Blend this with a mild pitch-up bias at low speeds to prevent inadvertent descents.
* **Roll angle guardrails:** If the bank angle exceeds 60°, smoothly apply opposite aileron and yaw to recover. This keeps newcomers from tumbling.
* **Throttle safety net:** Enforce a minimum throttle floor (e.g., 20%) and apply gentle lift boosts as speed approaches stall thresholds. The plane should mush forward rather than fall.
* **Crash prevention:** Tie ground collision to auto-recovery—if a descent nears the terrain, gradually pitch up and add throttle before triggering a fail state.

## Smooth Input Implementation

* **Input filtering:** Use exponential smoothing or critically damped spring equations so a full roll command reaches its target angle in ~0.5–0.7 s. This prevents twitchy reactions while keeping controls responsive.
* **Coordinated turns:** Blend yaw automatically during roll to keep the nose tracking with the turn. Manual yaw keys only fine-tune heading.
* **Throttle blending:** Instead of instant jumps, lerp engine power toward the requested setting at ~15% per second. Pair this with gentle camera FOV shifts (±5°) to sell acceleration.
* **Stunt mode safety:** When the player taps `Space`, script the aerobatic sequence with fixed duration and exit velocity, then hand control back with auto-level applied so orientation is predictable.

## Visual & Gameplay Touches

* **Environment palette:** Favor bright skies with scattered clouds and colorful landscapes (verdant valleys, coastal cliffs, or desert sunsets) so the non-rolling camera always showcases a stable horizon behind the plane.
* **HUD clarity:** Show throttle percentage, airspeed, and a slim control reminder. Fade in a “Auto-Leveling…” banner when the stability system intervenes so players understand the assist.
* **Progressive onboarding:** Start new players at moderate speed (55% throttle) with control tooltips. Unlock stunt mode after a short guided flight to build confidence.

This setup slots neatly into Unity, Unreal Engine, or any in-house engine: the key bindings map directly to input actions, while the camera rig uses standard follow and damping components. The fixed camera, medium-sized aircraft, and forgiving physics give beginners a cinematic experience without sacrificing readability or fun.
