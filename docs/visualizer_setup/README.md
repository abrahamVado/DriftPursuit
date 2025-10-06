# Visualizer Sandbox Setup

## Supported global tool versions
- **Node.js**: Use a release compatible with the Vite toolchain (`^18.0.0 || >=20.0.0`). Node 20.19.4 has been verified locally and comfortably meets this requirement while also covering Vitest's `^18.0.0 || >=20.0.0` range and TypeScript 5.9.3's `>=14.17` floor.
- **pnpm**: Use pnpm 10.18.x as declared in `package.json`. Corepack can pin the version via `corepack use pnpm@10.18.0` before installing dependencies.

## Verification steps
1. **Inspect versions**
   - Confirm the dependency ranges in `planet_sandbox_web/package.json` to ensure they align with the Node.js and pnpm targets above.
   - Validate engine constraints directly from installed packages:
     - TypeScript 5.9.3 lists `node: >=14.17`.
     - Vitest 1.6.1 lists `node: ^18.0.0 || >=20.0.0`.
2. **Install dependencies**
   - From `planet_sandbox_web/`, run `pnpm install`. Approve any optional build scripts only if they are required for local workflows.
3. **Validate the baseline**
   - Run `pnpm test` to execute the Vitest suite (`vitest run`).

## Notes
- The repository already contains an up-to-date `pnpm-lock.yaml`. Rerunning `pnpm install` with pnpm 10.18.0 confirms the lockfile without changes, so no additional snapshot is necessary under matching tool versions.
