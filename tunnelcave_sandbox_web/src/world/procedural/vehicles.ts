import {
  BufferGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  Material,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  Shape,
  TorusGeometry,
  Vector3,
} from "three";

//1.- Define shared option structures and utility helpers for procedural vehicle assembly.
export interface VehicleOptions {
  name: string;
  hull: {
    length: number;
    width: number;
    height: number;
    noseLength: number;
    tailWidth: number;
    tailHeight: number;
  };
  wings: {
    span: number;
    sweep: number;
    dihedral: number;
    thickness: number;
    rootChord: number;
    tipChord: number;
    position: { x: number; y: number; z: number };
  };
  tail: {
    span: number;
    sweep: number;
    dihedral: number;
    thickness: number;
    rootChord: number;
    tipChord: number;
    position: { x: number; y: number; z: number };
  };
  fx: {
    spinSpeed: number;
    front: {
      ringCount: number;
      radius: number;
      tube: number;
      separation: number;
    };
    tail: {
      chainCount: number;
      radius: number;
      tube: number;
      separation: number;
    };
  };
  materials?: {
    hull?: Material;
    wing?: Material;
    tail?: Material;
    fx?: Material;
  };
}

export interface Ring {
  mesh: Mesh;
  radius: number;
  tube: number;
}

export interface SpinFx {
  rings: Ring[];
  speed: number;
  axis: Vector3;
}

export interface ChainState {
  rings: Ring[];
  spacing: number;
  speed: number;
}

type MaterialBundle = {
  hull: Material;
  wing: Material;
  tail: Material;
  fx: Material;
};

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

interface VehicleBuildPreset {
  preset: keyof typeof VEHICLE_PRESETS;
  overrides?: DeepPartial<VehicleOptions>;
}

//2.- Craft reusable BufferGeometry and Shape-based builders to match the required vehicle silhouette.
const DEFAULT_MATERIAL_FACTORIES: Record<keyof MaterialBundle, () => Material> = {
  hull: () => new MeshStandardMaterial({ color: 0x5b6cff, metalness: 0.6, roughness: 0.3 }),
  wing: () => new MeshStandardMaterial({ color: 0xdde1ff, metalness: 0.4, roughness: 0.2 }),
  tail: () => new MeshStandardMaterial({ color: 0xc1c8ff, metalness: 0.4, roughness: 0.2 }),
  fx: () =>
    new MeshStandardMaterial({
      color: 0x9fffff,
      metalness: 0.1,
      roughness: 0.1,
      transparent: true,
      opacity: 0.8,
      emissive: 0x6fffff,
      emissiveIntensity: 0.6,
    }),
};

function createHullGeometry(options: VehicleOptions["hull"]): BufferGeometry {
  const { length, width, height, noseLength, tailHeight, tailWidth } = options;
  const geometry = new BufferGeometry();

  const halfLength = length / 2;
  const midX = halfLength - noseLength;
  const rearX = -halfLength;
  const halfWidth = width / 2;
  const tailHalfWidth = tailWidth / 2;
  const halfHeight = height / 2;
  const tailHalfHeight = tailHeight / 2;

  const positions = new Float32Array([
    halfLength, 0, 0, // 0 nose tip
    midX, halfHeight, halfWidth, // 1 mid top right
    midX, halfHeight, -halfWidth, // 2 mid top left
    midX, -halfHeight, halfWidth, // 3 mid bottom right
    midX, -halfHeight, -halfWidth, // 4 mid bottom left
    rearX, tailHalfHeight, tailHalfWidth, // 5 tail top right
    rearX, tailHalfHeight, -tailHalfWidth, // 6 tail top left
    rearX, -tailHalfHeight, tailHalfWidth, // 7 tail bottom right
    rearX, -tailHalfHeight, -tailHalfWidth, // 8 tail bottom left
  ]);

  const indices = [
    0, 1, 2,
    0, 3, 1,
    0, 2, 4,
    0, 4, 3,
    1, 5, 6,
    1, 6, 2,
    3, 7, 5,
    1, 3, 5,
    2, 6, 8,
    2, 8, 4,
    3, 8, 7,
    3, 4, 8,
    5, 7, 8,
    5, 8, 6,
  ];

  geometry.setIndex(indices);
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();

  return geometry;
}

function createWingGeometry(surface: VehicleOptions["wings" | "tail"]): ExtrudeGeometry {
  const { rootChord, tipChord, sweep, span, thickness } = surface;
  const halfRoot = rootChord / 2;
  const halfTip = tipChord / 2;
  const halfSpan = span / 2;

  const shape = new Shape();
  shape.moveTo(-halfRoot, 0);
  shape.lineTo(halfRoot, 0);
  shape.lineTo(halfRoot + sweep, halfSpan);
  shape.lineTo(-halfTip, halfSpan);
  shape.lineTo(-halfRoot, 0);

  const geometry = new ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: false,
    steps: 1,
  });

  geometry.translate(0, -thickness / 2, 0);
  geometry.center();
  geometry.computeVertexNormals();

  return geometry;
}

function applySurfacePlacement(mesh: Mesh, surface: VehicleOptions["wings" | "tail"]): void {
  const { position, dihedral } = surface;
  mesh.position.set(position.x, position.y, position.z);
  mesh.rotation.x = -MathUtils.degToRad(dihedral);
}

function mirrorSurface(mesh: Mesh, material: Material): Mesh {
  const mirrored = mesh.clone();
  mirrored.material = material;
  mirrored.scale.z *= -1;
  mirrored.updateMatrixWorld();
  return mirrored;
}

function buildSurfaceMeshes(surface: VehicleOptions["wings" | "tail"], material: Material): Mesh[] {
  const geometry = createWingGeometry(surface);
  const rightMesh = new Mesh(geometry, material);
  applySurfacePlacement(rightMesh, surface);

  const leftMesh = mirrorSurface(rightMesh, material);

  return [rightMesh, leftMesh];
}

function createRing(radius: number, tube: number, material: Material): Ring {
  const geometry = new TorusGeometry(radius, tube, 12, 48);
  const mesh = new Mesh(geometry, material);
  mesh.rotation.y = Math.PI / 2;
  return { mesh, radius, tube };
}

function buildFxChain(
  count: number,
  radius: number,
  tube: number,
  separation: number,
  material: Material,
  basePosition: Vector3,
): ChainState {
  const rings: Ring[] = [];
  for (let i = 0; i < count; i += 1) {
    const ring = createRing(radius, tube, material);
    ring.mesh.position.copy(basePosition);
    ring.mesh.position.x += i * separation;
    rings.push(ring);
  }

  return {
    rings,
    spacing: separation,
    speed: 0,
  };
}

function mergeOptions(base: VehicleOptions, overrides?: DeepPartial<VehicleOptions>): VehicleOptions {
  if (!overrides) {
    return base;
  }

  const clone: VehicleOptions = JSON.parse(JSON.stringify(base));

  const assign = (target: any, source: any): void => {
    Object.entries(source).forEach(([key, value]) => {
      if (value === undefined) {
        return;
      }
      if (value && typeof value === "object" && !Array.isArray(value)) {
        if (!target[key]) {
          target[key] = {};
        }
        assign(target[key], value);
      } else {
        target[key] = value;
      }
    });
  };

  assign(clone, overrides);
  return clone;
}

function resolveMaterials(options: VehicleOptions): MaterialBundle {
  return {
    hull: options.materials?.hull ?? DEFAULT_MATERIAL_FACTORIES.hull(),
    wing: options.materials?.wing ?? DEFAULT_MATERIAL_FACTORIES.wing(),
    tail: options.materials?.tail ?? DEFAULT_MATERIAL_FACTORIES.tail(),
    fx: options.materials?.fx ?? DEFAULT_MATERIAL_FACTORIES.fx(),
  };
}

//3.- Define the Arrowhead preset builder and expose the preset collection for easy extension.
export function buildArrowhead(): VehicleOptions {
  return {
    name: "arrowhead",
    hull: {
      length: 14,
      width: 6,
      height: 4,
      noseLength: 4,
      tailWidth: 3,
      tailHeight: 3,
    },
    wings: {
      span: 12,
      sweep: 1.5,
      dihedral: 12,
      thickness: 0.4,
      rootChord: 6,
      tipChord: 2,
      position: { x: -1, y: 0, z: 0 },
    },
    tail: {
      span: 6,
      sweep: 0.8,
      dihedral: 18,
      thickness: 0.3,
      rootChord: 3,
      tipChord: 1.2,
      position: { x: -5.5, y: 0.2, z: 0 },
    },
    fx: {
      spinSpeed: Math.PI / 3,
      front: {
        ringCount: 2,
        radius: 1.6,
        tube: 0.16,
        separation: 0.8,
      },
      tail: {
        chainCount: 3,
        radius: 1.1,
        tube: 0.2,
        separation: 0.7,
      },
    },
  };
}

//4.- Expand the preset catalogue with themed variants so the lobby can offer meaningful choices.
export const VEHICLE_PRESETS = {
  arrowhead: buildArrowhead(),
  aurora: mergeOptions(buildArrowhead(), {
    name: "aurora",
    materials: {
      hull: new MeshStandardMaterial({ color: 0x65b7ff, metalness: 0.55, roughness: 0.32 }),
      wing: new MeshStandardMaterial({ color: 0xd4f1ff, metalness: 0.38, roughness: 0.18 }),
      tail: new MeshStandardMaterial({ color: 0xa2d7ff, metalness: 0.4, roughness: 0.24 }),
      fx: new MeshStandardMaterial({
        color: 0x9fffff,
        metalness: 0.08,
        roughness: 0.12,
        transparent: true,
        opacity: 0.85,
        emissive: 0x8fffff,
        emissiveIntensity: 0.7,
      }),
    },
  }),
  duskfall: mergeOptions(buildArrowhead(), {
    name: "duskfall",
    materials: {
      hull: new MeshStandardMaterial({ color: 0x522b81, metalness: 0.62, roughness: 0.28 }),
      wing: new MeshStandardMaterial({ color: 0xc7b4ff, metalness: 0.36, roughness: 0.22 }),
      tail: new MeshStandardMaterial({ color: 0x8e6bff, metalness: 0.5, roughness: 0.26 }),
      fx: new MeshStandardMaterial({
        color: 0xffa07a,
        metalness: 0.12,
        roughness: 0.14,
        transparent: true,
        opacity: 0.82,
        emissive: 0xff7f50,
        emissiveIntensity: 0.75,
      }),
    },
  }),
  steelwing: mergeOptions(buildArrowhead(), {
    name: "steelwing",
    materials: {
      hull: new MeshStandardMaterial({ color: 0x5c646c, metalness: 0.72, roughness: 0.3 }),
      wing: new MeshStandardMaterial({ color: 0xe5ecf2, metalness: 0.34, roughness: 0.2 }),
      tail: new MeshStandardMaterial({ color: 0x9ca6af, metalness: 0.58, roughness: 0.22 }),
      fx: new MeshStandardMaterial({
        color: 0x9fffff,
        metalness: 0.16,
        roughness: 0.1,
        transparent: true,
        opacity: 0.78,
        emissive: 0x9fffff,
        emissiveIntensity: 0.6,
      }),
    },
  }),
};

export type VehiclePresetName = keyof typeof VEHICLE_PRESETS;

//4.- Assemble the procedural vehicle, populating userData with spin and chain metadata for animation systems.
export type VehicleBuildTarget = keyof typeof VEHICLE_PRESETS | VehicleOptions | VehicleBuildPreset;

export function buildVehicle(target: VehicleBuildTarget): Group {
  let options: VehicleOptions;
  if (typeof target === "string") {
    const preset = VEHICLE_PRESETS[target];
    if (!preset) {
      throw new Error(`Unknown vehicle preset: ${target}`);
    }
    options = JSON.parse(JSON.stringify(preset));
  } else if ("preset" in target) {
    const preset = VEHICLE_PRESETS[target.preset];
    if (!preset) {
      throw new Error(`Unknown vehicle preset: ${target.preset}`);
    }
    options = mergeOptions(JSON.parse(JSON.stringify(preset)), target.overrides);
  } else {
    options = target;
  }

  const materials = resolveMaterials(options);
  const group = new Group();
  group.name = options.name;

  const hullGeometry = createHullGeometry(options.hull);
  const hullMesh = new Mesh(hullGeometry, materials.hull);
  group.add(hullMesh);

  buildSurfaceMeshes(options.wings, materials.wing).forEach((mesh) => group.add(mesh));
  buildSurfaceMeshes(options.tail, materials.tail).forEach((mesh) => group.add(mesh));

  const spinFx: SpinFx = {
    rings: [],
    speed: options.fx.spinSpeed,
    axis: new Vector3(1, 0, 0),
  };

  const hullHalfLength = options.hull.length / 2;
  const frontBase = new Vector3(hullHalfLength + options.fx.front.radius * 0.5, 0, 0);
  const tailBase = new Vector3(-hullHalfLength - options.fx.tail.radius * 0.5, 0, 0);

  const frontRings: Ring[] = [];
  for (let i = 0; i < options.fx.front.ringCount; i += 1) {
    const ring = createRing(options.fx.front.radius, options.fx.front.tube, materials.fx);
    ring.mesh.position.copy(frontBase);
    ring.mesh.position.x += i * options.fx.front.separation;
    group.add(ring.mesh);
    spinFx.rings.push(ring);
    frontRings.push(ring);
  }

  const tailState = buildFxChain(
    options.fx.tail.chainCount,
    options.fx.tail.radius,
    options.fx.tail.tube,
    options.fx.tail.separation,
    materials.fx,
    tailBase,
  );
  tailState.rings.forEach((ring) => {
    group.add(ring.mesh);
    spinFx.rings.push(ring);
  });

  const frontState: ChainState = {
    rings: frontRings,
    spacing: options.fx.front.separation,
    speed: options.fx.spinSpeed,
  };

  group.userData.spinParts = spinFx;
  group.userData.tailState = tailState;
  group.userData.frontState = frontState;

  return group;
}

