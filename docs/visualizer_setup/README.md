# Visualizer Sandbox Setup

## Supported global tool versions
- **Node.js**: Use a release compatible with the Next.js toolchain (`^18.17.0 || >=20.0.0`). Node 20.19.4 has been verified locally and comfortably meets this requirement while also covering Vitest's `^18.0.0 || >=20.0.0` range and TypeScript 5.4.5's `>=14.17` floor.
- **npm**: The project scripts assume npm 8+ with Corepack-enabled alternatives also supported.

## Verification steps
1. **Inspect versions**
   - Confirm the dependency ranges in `game/package.json` to ensure they align with the Node.js and npm targets above.
   - Validate engine constraints directly from installed packages:
     - TypeScript 5.9.3 lists `node: >=14.17`.
     - Vitest 1.6.1 lists `node: ^18.0.0 || >=20.0.0`.
2. **Install dependencies**
   - From `game/`, run `npm install`. Approve any optional build scripts only if they are required for local workflows.
3. **Validate the baseline**
   - Run `npm test` to execute the Vitest suite (`vitest run`).

## Notes
- The repository already contains deterministic dependency ranges. Rerunning `npm install` with Node 20.19.4 confirms the resulting `package-lock.json` content without changes, so no additional snapshot is necessary under matching tool versions.
