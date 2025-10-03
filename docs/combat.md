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
