# Next.js + Three.js Infinite World (Scaffold)

A ready-to-run scaffold for an **infinite, textured** procedural world with a **rect corridor** onboarding,
**five vehicles**, shared weapon slots, enemies (stellated octahedra), boss stub, chase camera, HUD, and inputs.
Built for **Next.js App Router** + **Three.js**.

## Quickstart
```bash
pnpm i
pnpm dev
# open http://localhost:3000/gameplay
```

### Controls
- Mouse: aim (plane steers toward reticle)
- W/S: throttle • Shift: boost
- Q/E: roll • A/D: yaw
- Space: fire • F: bomb
- 1..4: switch weapon (Gatling, Missile, Laser, Bomb)
- (Dev) Cycle vehicle: wire later via api

## Where to add your logic
- Terrain: `src/world/chunks/*` (height fields, textures, props)
- Corridor: `src/spawn/corridor.ts`
- Enemies: `src/enemies/stellated-octahedron/*`
- Boss: `src/enemies/bosses/poly-boss/*`
- Vehicles: `src/vehicles/{arrowhead,octahedron,pyramid,icosahedron,cube}/*`
- Player control: `src/vehicles/shared/simpleController.ts`
- Weapons: `src/vehicles/shared/weapons/*`

## Notes
- The scaffold uses lightweight FBM noise and a 5×5 chunk ring for performance.
- Replace placeholder geometry with glTF models when ready (keep folders).
- Add compressed KTX2 textures into `/public/textures` when you have them.
