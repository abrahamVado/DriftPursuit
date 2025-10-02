# Networking schema versioning

The websocket payloads exchanged between the broker, gameplay clients, and bot
runner are formally defined in [`go-broker/internal/proto`](../go-broker/internal/proto),
with generated artefacts checked in for Go (`internal/proto/pb`) and Python
(`python-sim/driftpursuit_proto`). Every message
carries a `schema_version` field so clients can detect incompatible upgrades
before attempting to decode the payload. While the networking contract is still
in flux we follow a `v0.x.y` versioning scheme:

- The **major** component is pinned to `0` until the schema is proven stable.
- The **minor** component increments for additive (backwards compatible)
  changes, such as introducing new optional fields.
- The **patch** component increments for bug fixes or documentation-only
  adjustments that do not alter the on-the-wire representation.

## Bumping the schema version

1. Update the relevant `.proto` files with the new fields or rules. Every
   message **must** keep the `schema_version` field as tag `1`.
2. Run the automated compatibility checks locally:

   ```bash
   buf lint
   buf breaking --against '.git#branch=main'
   ./scripts/check_schema_version.py
   ```

3. Edit [`proto/SCHEMA_VERSION`](../proto/SCHEMA_VERSION) to the next
   `0.x.y` value. Schema updates will fail CI if the version file is not
   changed alongside the `.proto` definitions or if the version regresses.
4. Regenerate any language-specific bindings as necessary.
5. Note the new schema version in release notes when tagging a build. The Docker
   CI workflow will automatically create a `schema/v0.x.y` tag that points at the
   commit which introduced the change.

## Migrating clients

When bumping the schema version, follow these steps to roll out the change
safely:

1. **Audit consumers.** Identify all gameplay clients, bot runners, and tools
   that deserialize the affected messages. Ensure they tolerate the new fields
   or are updated concurrently.
2. **Stage in non-production.** Deploy the broker changes to a staging
   environment and verify both old and new clients continue to operate with the
   updated payloads.
3. **Roll out gradually.** Release the updated clients first. Once the majority
   of consumers understand the new schema version, deploy the broker change to
   production.
4. **Monitor logs and metrics.** The broker logs any schema negotiation issues
   surfaced by clients. Watch error rates closely during rollout and be prepared
   to roll back to the previous `schema/v0.x.y` tag if needed.

By maintaining strict version discipline in `proto/SCHEMA_VERSION` and enforcing
compatibility checks in CI, we can iterate rapidly on the networking contract
without destabilising existing gameplay sessions.
