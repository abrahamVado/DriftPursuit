# Vehicle and Client Capabilities Overview

## Procedural Vehicle Content
- The roster is defined through static gameplay configuration rather than procedurally generated meshes. Entries in `vehicleRoster.ts` enumerate the available craft (with only the Skiff selectable and ground vehicles marked as placeholders) and tie each one to hand-authored stats and loadouts, without any procedural mesh data.
- Vehicle stats and loadouts derive from `gameplayConfig.ts`, again providing authored numbers instead of parametric geometry. As such, the project currently lacks a system that would synthesize vehicle 3D models on the fly.

## Python-Only Playability
- The Python SDK ships gRPC helpers such as `IntentClient` for publishing throttle/steer commands at a fixed cadence and `StateStreamReceiver` companions that deliver world diffs, letting a Python program pilot vehicles without the browser UI.
- Sample bots like `GRPCBot` and the FSM CLI showcase full control loops entirely in Python: they subscribe to the broker diff stream, emit intents, and expose CLI options to tune behaviour. You can adapt these implementations for interactive control or automation without needing to extend the core functionality first.

## Required Extensions
- Because the broker and SDK already expose control surfaces and diff streams, you can play from Python today. Further expansion is only necessary if you want richer vehicle assets (e.g., importing authored meshes) or custom client features beyond what the sample bots provide.
