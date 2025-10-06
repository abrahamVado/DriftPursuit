import type { CubeTileKey } from "./cubedSphere";
import type { PlanetSpec } from "./planetSpec";

export interface LodSelection {
  //1.- List of tiles to render at the evaluated viewpoint.
  selected: CubeTileKey[];
  //2.- Tiles that should be evicted from caches due to over-refinement.
  dropped: CubeTileKey[];
}

export interface CameraState {
  //1.- Position of the camera in planet-fixed coordinates.
  position: { x: number; y: number; z: number };
  //2.- Horizontal field of view in radians used to estimate screen error.
  fov: number;
  //3.- Pixel height of the viewport.
  viewportHeight: number;
}

interface Node {
  key: CubeTileKey;
  error: number;
  children?: Node[];
}

function screenSpaceError(
  spec: PlanetSpec,
  key: CubeTileKey,
  camera: CameraState,
  cameraDistance: number,
): number {
  //1.- Derive geometric error based on tile size and distance to viewpoint.
  const worldSize = (spec.radius * Math.PI) / (1 << key.lod);
  const projected = (worldSize / cameraDistance) * camera.viewportHeight * (2 / camera.fov);
  return projected;
}

export class CubeQuadtreeLod {
  private readonly spec: PlanetSpec;

  constructor(spec: PlanetSpec) {
    //1.- Keep the specification handy so LOD thresholds remain reproducible.
    this.spec = spec;
  }

  select(camera: CameraState): LodSelection {
    //1.- Evaluate each cube face independently and merge the resulting tile keys.
    const selected: CubeTileKey[] = [];
    const dropped: CubeTileKey[] = [];
    const cameraDistance = Math.max(
      Math.hypot(camera.position.x, camera.position.y, camera.position.z) - this.spec.radius,
      1e-3,
    );
    for (let face = 0; face < 6; face += 1) {
      this.traverse({ face: face as CubeTileKey["face"], i: 0, j: 0, lod: 0 }, camera, cameraDistance, selected, dropped);
    }
    return { selected, dropped };
  }

  private traverse(
    key: CubeTileKey,
    camera: CameraState,
    cameraDistance: number,
    selected: CubeTileKey[],
    dropped: CubeTileKey[],
  ): void {
    //1.- Determine the threshold for the current level and whether we must refine the node.
    const threshold = this.spec.lodScreenError[Math.min(key.lod, this.spec.lodScreenError.length - 1)];
    const error = screenSpaceError(this.spec, key, camera, cameraDistance);
    if (error <= threshold || key.lod + 1 >= this.spec.lodScreenError.length) {
      selected.push(key);
      return;
    }
    //2.- Split into four children maintaining edge consistency across neighbouring tiles.
    const nextLod = key.lod + 1;
    const childI = key.i * 2;
    const childJ = key.j * 2;
    const children: CubeTileKey[] = [
      { face: key.face, i: childI, j: childJ, lod: nextLod },
      { face: key.face, i: childI + 1, j: childJ, lod: nextLod },
      { face: key.face, i: childI, j: childJ + 1, lod: nextLod },
      { face: key.face, i: childI + 1, j: childJ + 1, lod: nextLod },
    ];
    for (const child of children) {
      this.traverse(child, camera, cameraDistance, selected, dropped);
    }
    dropped.push(key);
  }
}
