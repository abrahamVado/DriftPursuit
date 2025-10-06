//1.- Re-export the networking interpolator from the shared client package so Vite resolves a single source of truth.
export {
  SnapshotInterpolator,
  type InterpolatedState,
  type SnapshotSample
} from '@client/networking/interpolator';
