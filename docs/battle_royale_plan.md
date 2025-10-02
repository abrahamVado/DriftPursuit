# Battle Royale Feature Plan — DriftPursuit

> **Mode:** Single continuous match, drop‑in/out  
> **Authority:** Go server authoritative @ 60 Hz simulation, 20 Hz client snapshots  
> **Bots:** Python over gRPC (state stream + intents)  
> **Pickups:** Disabled for v1  
> **Customization:** Deferred (no skins/perks in v1)

---

## Completed
- [x] Gather core gameplay and technical requirements (authority model, networking, map generation, vehicles, combat, UX).

## In Progress / Outstanding

### Core Services & Networking (Go)
- [ ] Extend Go broker with an internal **60 Hz** simulation loop and authoritative state management.
- [ ] Implement **Protobuf schemas** and **interest management tiers** for state snapshots, events, and radar channels.
- [ ] Add **bandwidth prioritization** and per‑client **LOD streaming** logic.
- [ ] Provide **gRPC** interface for Python bot **state/intents** with compressed diffs.
- [ ] **Time sync:** Broadcast server time offset every **2 s**; clients smooth to within **±50 ms** skew.
- [ ] **Client reconciliation:** **100–150 ms** interpolation buffer; snap only on keyframes if error > **2 m / 15°**.
- [ ] **Input hygiene:** Sequence IDs; drop dupes/late inputs (> **250 ms** old); cap client input rate at **≤60 Hz**.
- [ ] **Bandwidth budget:** Target **≤48 kbps** average per client @ 48 actors.
- [ ] **Drop policy (priority):** far **radar** → **cosmetics** → **mid‑range orientation** → **mid‑range velocity** → (**never**) nearby state.
- [ ] **Server validation:** Clamp intent ranges; reject impossible deltas; cooldown on spam bursts.
- [ ] **Auth:** Short‑lived signed token for **WebSocket**; **gRPC** bots use mTLS or shared secret in dev.
- [ ] **Event channel:** Reliable stream for `CombatEvent`, `RadarContact`, `RespawnEvent`, `MatchEvent` (join/leave/kill).
- [ ] **Replay log:** Append events + **5 Hz** low‑rate world frames; emit file on match end.

#### Schemas (Protobuf, v0.1)
- [ ] `VehicleState { id, t_ms, pos(vec3f), vel(vec3f), rot(quatf), angVel(vec3f), hp(u16), ammo(u16), flags(u16) }`
- [ ] `CombatEvent { id, kind(enum), srcId, dstId, pos, dir, damage, meta(map) }`
- [ ] `RadarContact { at_ms, srcId, list<contact{targetId, pos, vel, confidence, occluded(bool)}>} `
- [ ] `Intent { id, t_ms, throttle(f), roll(f), pitch(f), yaw(f), vertical(f), boost(bool), assist(bool), reset(bool) }`

---

### Bot Interface (Python)
- [ ] **gRPC state stream:** **20 Hz** compressed diffs → bot.
- [ ] **gRPC intents:** **10–20 Hz** control messages ← bot.
- [ ] **Seeded RNG for ECM:** Ensure determinism per missile engagement.  
      **Seed recipe:** `seed = hash64(matchSeed, missileId, targetId)` (fixed per engagement for replay‑safe outcomes).
- [ ] **Reference bots:** Patrol, chaser, coward, and ambusher (finite state machines) with rate‑limited planning.
- [ ] **Latency budget:** End‑to‑end bot loop **≤ 40 ms** (receive → decide → send).

---

### World & Map Generation
- [ ] **Generator:** Divergence‑free noise → swept tube → ring stations + analytic **SDF**. Seeded & reproducible.
- [ ] **Scale:** **8–12 km** loop, avg radius **12–25 m** (rooms to **50 m**), clearance **20–35 m** (min **10 m**).
- [ ] **Chunking:** **150–250 m** arc chunks; keep **±3** around player. Streaming by **world position**.
- [ ] **Collision:** Sample **SDF** for cave; vehicles use capsule/sphere tests; projectiles use ray/sphere intersection.
- [ ] **Special zones (3–5):** Tag spline stations with metadata for spawn and set‑dressing. **No pickups** in v1.
- [ ] **Mouth/entrance constraint:** Keep craft inside entrance cushion; clip outward velocity along mouth normal.
- [ ] **Penetration resolve:** Push out along SDF normal; zero inward velocity component next frame.

---

### Vehicles, Controls & Physics
- [ ] **Free‑flight physics:** Integrate linear velocity + angular rates (roll/pitch/yaw). Assist mode can snap to spline when enabled.
- [ ] **Control mapping (client):** W/S throttle, A/D roll, I/K pitch, J/L yaw, N/M vertical, Shift boost, F assist toggle, R reset.
- [ ] **Aerial Skiff baseline:** max **120 m/s**, accel **45 m/s²** (+55 boost), yaw **0.6π**, pitch **0.8π**, roll **1.1π**, vertical **38 m/s²**.
- [ ] **Ground (future):** Reserve parameters; restrict to **lower surface only** in v1.
- [ ] **Respawn:** **3 s** delay; respawn at nearest safe ring ahead; spectator during timer.

**Vehicle classes & loadouts (v1):**
- **Arrow Head:** Shells, Missiles, Decoys · Ammo: Shells×300, Missiles×4, Decoys×2 · Passive: +10% boost accel, light armor  
- **Freedom Dorito:** Shells, Laser, Missiles · Shells×250, Laser(heat), Missiles×2 · Passive: +12% top speed, −10% HP  
- **Tank (future):** Heavy Shells, Bombs · Heavy×80, Bombs×2 · Passive: +40% armor, −25% accel/speed  
- **SPAA:** Missiles(AA), Laser, Decoys · Missiles×6, Laser(heat), Decoys×3 · Passive: +20% radar gain, low agility

---

### Combat & Sensors
- [ ] **Weapons:** Shells (hitscan/fast proj), Missiles (guided), Laser (DPS/heat). Decoys available per loadout.
- [ ] **ECM:** Deterministic guidance; **seeded probabilistic decoy break**—**65%** within first **1.5 s**, decays to **20%** over next **3 s**.
- [ ] **Damage model:** Per‑hit + splash; terrain collision applies speed‑scaled damage; hard kill above **30 m/s** impact.
- [ ] **Radar:** **600–900 m** range, **4 Hz** refresh, terrain occlusion via SDF occlusion test. Maintain “last known” cache per contact.
- [ ] **HUD last‑known:** Fade over **6 s**; dashed after **2 s**; display “t–Δt”; **1 s** ghost trail along last velocity.

---

### Client Experience (three.js)
- [ ] **Networking:** WebSocket client; interpolation/extrapolation with keyframe corrections (threshold > **2 m/15°**).
- [ ] **Camera:** Chase cam bound to free‑flight transform; shake/FX hooks for impacts/boost.
- [ ] **HUD:** Health, ammo, boost/heat, radar panel, target lock widget, speed/altitude, compass; scoreboard overlay (Tab).
- [ ] **Accessibility:** Rebindable keys, color‑safe radar palette.

---

### Session Model
- [ ] **Single continuous match:** **Drop‑in/out** while capacity allows; no lobby ready gate.
- [ ] **Capacity:** Start with **48** actors (mix human/bot); configurable cap.
- [ ] **Bot fill/drain:** Spawn bots to fill to capacity; despawn one bot per human join.
- [ ] **Late‑join spawn safety:** Probe **±300 m** along ring; grant **1.5 s** grace shield on spawn.

---

### Storage & Replay
- [ ] **Replay format:** JSONL **events** + **5 Hz** binary state frames (snappy/zstd).
- [ ] **Match header:** Persist seed, terrain params, schema version, and replay pointer (if storage enabled).
- [ ] **Retention:** Keep last **50 matches** or **7 days** (configurable).

---

### Tooling & Ops (no telemetry stack)
- [ ] **Health endpoints:** `/live`, `/ready`, `/metrics` (text counters optional), and an admin `/replay/dump` for end‑of‑match export.
- [ ] **Logs:** Structured JSON logs with trace/request IDs; rotate & compress on server.
- [ ] **Crash‑safe:** Auto‑recover continuous match; reject joins during recovery window.
- [ ] **Config via env:** Tick rate, snapshot rate, caps, ports, seeds; single WS port + gRPC port.
- [ ] **Packaging:** Docker images for Go server, Python bots, web client; minimal Compose; optional Postgres for match history.

---

## Acceptance Tests (high level)
- [ ] **Networking:** 20 Hz snapshots; interpolation smooth under **2%** packet loss.
- [ ] **Bots:** Median bot loop latency **≤40 ms**; intents at **10–20 Hz**; no >2 skipped frames in 60 s.
- [ ] **Combat:** Missile decoy break follows **65%→20%** window; lasers bypass ECM; damage numbers match config.
- [ ] **Radar:** Occlusion works; last‑known visuals match spec.
- [ ] **Respawn:** **3 s** delay & safe placement; no stuck spawns.
- [ ] **Bandwidth:** Avg/client **≤48 kbps** at 48 actors; drop policy triggers in correct order.
- [ ] **Replay:** File produced on match end; replayer loads with matching schema version.
- [ ] **Performance:** Server tick **≤4 ms** @ 48 actors; client stable **60 FPS** on mid‑tier GPU.

---

## Notes
- All numbers are **config‑driven**; ship a single `gameplayConfig.ts` to centralize tuning.
- Version all network schemas with **backward‑compatible** additions only in `v0.x`.
