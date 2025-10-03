# Combat ECM Determinism

The electronic countermeasures (ECM) pipeline now derives all decoy resolution
rolls from a deterministic seed so that combat outcomes are perfectly
replayable. The seed is constructed with the following recipe:

1. Start with the authoritative match seed broadcast at match creation time.
2. Append the unique missile identifier assigned by the projectile store.
3. Append the target vehicle identifier being evaluated for spoofing.
4. Hash the concatenated payload with `SHA-256` using null-byte separators to
   avoid accidental collisions between identifiers.
5. Use the first non-zero 64-bit little-endian segment of the digest as the
   seed for Go's `math/rand` package.

Because the match seed, missile ID, and target ID are deterministic within a
replay, every call to `combat.ShouldDecoyBreak` produces the same outcome across
servers, QA captures, and bot simulations. Bot developers can now author
training scenarios that rely on stable ECM behaviour, and QA can reproduce
misfires by replaying the same tick stream.

When new ECM mechanics are introduced, ensure any additional entropy joins the
hash payload **before** hashing so the deterministic guarantee remains intact.

## Time-Windowed ECM Resolution

To model the 65% to 20% spoof decay across a three second decoy window, the Go
runtime exposes `combat.MissileECMTracker`. The tracker keeps a seeded random
number generator per missile engagement so every elapsed-time query consumes the
next deterministic roll from the shared stream. Replaying the same match seed,
missile identifier, and target identifier therefore produces identical spoof
timelines regardless of how many times the simulation checks the decoy window.

1. `combat.DefaultECMProbabilityWindow()` encodes the plateau at 65% for the
   first 1.5 seconds and the linear decay to 20% by the three second mark.
2. `tracker.Resolve(seed, missileID, targetID, elapsed, window)` returns the
   deterministic spoof outcome for the provided elapsed timestamp.
3. `tracker.Release(...)` and `tracker.Reset()` allow callers to recycle state
   after missiles complete their engagements, keeping long-running matches from
   growing unbounded maps.

These primitives allow the bot interface and combat server to observe the same
ECM behaviour while maintaining deterministic replays.
