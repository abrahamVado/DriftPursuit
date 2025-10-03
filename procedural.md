// lib/vehicles.ts
import * as THREE from "three";

/** Forward (+Z), Up (+Y), Right (+X) coordinate frame */
export type VehicleOptions = {
  noseLen: number;
  baseZ: number;
  topZ: number;
  baseWidth: number;
  topYOffset: number;

  wingSpan: number;
  wingChord: number;
  wingThickness: number;
  wingSweepDeg: number;     // yaw/sweep (positive = sweep back)
  wingDihedralDeg: number;  // roll/dihedral (positive = tips higher)
  wingIncidenceDeg: number; // pitch/incidence (positive = leading edge up)
  wingZ: number;
  wingY: number;

  tailDonutCount: number;
  frontDonutCount: number;
  frontConeTiltDeg: number;
};

export type SpinFx = { mesh: THREE.Object3D; mat?: THREE.MeshStandardMaterial; spinCoef: number };
export type Ring = { mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial; offsetZ: number };
export type ChainState = { rings: Ring[]; activations: number[] };

const DFLT: VehicleOptions = {
  noseLen: 1.5,
  baseZ: -1.0,
  topZ: -0.5,
  baseWidth: 0.8,
  topYOffset: 0.45,

  wingSpan: 4.8,
  wingChord: 2.0,
  wingThickness: 0.06,
  wingSweepDeg: 22,
  wingDihedralDeg: 10,
  wingIncidenceDeg: 0,
  wingZ: (-1.0 + -0.5) / 2,
  wingY: 0.02,

  tailDonutCount: 7,
  frontDonutCount: 5,
  frontConeTiltDeg: 0,
};

export function buildArrowhead(opts?: Partial<VehicleOptions>): THREE.Group {
  const o = { ...DFLT, ...(opts ?? {}) };

  const group = new THREE.Group();

  // ---------- Arrowhead hull as indexed BufferGeometry ----------
  const hullGeo = new THREE.BufferGeometry();
  const verts = new Float32Array([
    0, 0,  o.noseLen,          // 0 nose
   -o.baseWidth, 0, o.baseZ,   // 1 left-base
    o.baseWidth,  0, o.baseZ,   // 2 right-base
    0,  o.topYOffset, o.topZ,   // 3 top
    0, -o.topYOffset, o.topZ,   // 4 bottom
  ]);
  const idx = new Uint16Array([
    0,1,3,  0,3,2,
    0,2,4,  0,4,1,
    1,4,3,  3,4,2,
    2,1,3,
  ]);
  hullGeo.setAttribute("position", new THREE.BufferAttribute(verts, 3));
  hullGeo.setIndex(new THREE.BufferAttribute(idx, 1));
  hullGeo.computeVertexNormals();

  const hullMat = new THREE.MeshStandardMaterial({ color: 0xf97316, metalness: 0.35, roughness: 0.5 });
  const hull = new THREE.Mesh(hullGeo, hullMat);
  hull.castShadow = hull.receiveShadow = true;
  group.add(hull);

  // ---------- Pointy wings via 2D Shape + Extrude ----------
  function makePointyWing(sign: 1 | -1) {
    const halfSpan = o.wingSpan * 0.5;
    const tipChord       = Math.max(0.2, o.wingChord * 0.22);
    const forwardSpike   = o.wingChord * 0.78;
    const trailingNotchZ = o.wingChord * 0.20;
    const rootLeadingZ   = 0.0;
    const rootZMid       = (rootLeadingZ + trailingNotchZ) * 0.5;

    const sx = sign;
    const shape = new THREE.Shape();
    shape.moveTo(0, rootLeadingZ);
    shape.lineTo(sx * (halfSpan * 0.38), -forwardSpike);
    shape.lineTo(sx * halfSpan,          -tipChord * 0.55);
    shape.lineTo(sx * halfSpan,           tipChord * 0.45);
    shape.lineTo(sx * (halfSpan * 0.30),  trailingNotchZ);
    shape.lineTo(0,                        rootLeadingZ);

    const extrude = new THREE.ExtrudeGeometry(shape, { depth: o.wingThickness, bevelEnabled: false, steps: 1 });
    extrude.computeBoundingBox();
    const bb = extrude.boundingBox!;
    const shiftY = - (bb.min.y + bb.max.y) / 2; // center about Y
    extrude.translate(0, shiftY, -rootZMid);    // center nose↔trailing

    const wingMat = new THREE.MeshStandardMaterial({
      color: 0x9ca3af, metalness: 0.6, roughness: 0.3, side: THREE.DoubleSide
    });
    const wing = new THREE.Mesh(extrude, wingMat);
    wing.castShadow = wing.receiveShadow = true;

    const rootInset = Math.max(0.02, o.wingThickness * 0.5);
    wing.position.set(sign * (o.baseWidth + rootInset), o.wingY, o.wingZ);
    wing.rotation.x = THREE.MathUtils.degToRad(o.wingIncidenceDeg);
    wing.rotation.y = -sign * THREE.MathUtils.degToRad(o.wingSweepDeg);
    wing.rotation.z =  sign * THREE.MathUtils.degToRad(o.wingDihedralDeg);
    return wing;
  }
  const leftWing  = makePointyWing(-1);
  const rightWing = makePointyWing( 1);
  group.add(leftWing, rightWing);

  // ---------- Nose FX ring ----------
  const noseMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: new THREE.Color(0x00eaff),
    emissiveIntensity: 1.2,
    roughness: 0.25,
    metalness: 0.1,
    transparent: true,
    opacity: 0.95,
  });
  const noseRing = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.07, 12, 40), noseMat);
  noseRing.position.z = o.noseLen + 0.1;
  group.add(noseRing);

  // ---------- Tail exhaust donuts ----------
  const tailBaseZ = o.baseZ - 1.2;
  const tailRings: Ring[] = [];
  const tailMainRadius = 0.70;
  const tailMainTube   = 0.15;
  const tailRadiusDecay = 0.80;
  const tailTubeDecay   = 0.82;
  const tailStepZ       = 0.48;

  for (let i = 0; i < Math.max(4, o.tailDonutCount); i++) {
    const r = i === 0 ? tailMainRadius : tailMainRadius * Math.pow(tailRadiusDecay, i);
    const t = i === 0 ? tailMainTube   : tailMainTube   * Math.pow(tailTubeDecay, i);
    const offsetZ = -tailStepZ * i;

    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: new THREE.Color(i === 0 ? 0xaa00ff : 0xff5500),
      emissiveIntensity: i === 0 ? 1.0 : 0.55,
      roughness: 0.3,
      metalness: 0.2,
      transparent: true,
      opacity: i === 0 ? 0.8 : 0.0,
      depthWrite: false,
    });

    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, t, 16, 64), mat);
    ring.position.z = tailBaseZ + offsetZ;
    ring.castShadow = false;
    ring.receiveShadow = false;
    group.add(ring);
    tailRings.push({ mesh: ring, mat, offsetZ });
  }

  // ---------- Front deceleration donuts ----------
  const frontBaseZ = noseRing.position.z + 0.22;
  const frontRings: Ring[] = [];
  const frontMainRadius = 0.32;
  const frontMainTube   = 0.065;
  const frontShrink     = 0.76;
  const frontStepZ      = 0.24;
  const frontTiltRad    = THREE.MathUtils.degToRad(o.frontConeTiltDeg);

  for (let i = 0; i < Math.max(3, o.frontDonutCount); i++) {
    const r = frontMainRadius * Math.pow(frontShrink, i);
    const t = frontMainTube   * Math.pow(frontShrink, i);
    const offsetZ = frontStepZ * i;

    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: new THREE.Color(0x33ccff),
      emissiveIntensity: 0.5,
      roughness: 0.25,
      metalness: 0.15,
      transparent: true,
      opacity: 0.0,
      depthWrite: false,
    });

    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, t, 14, 56), mat);
    ring.position.z = frontBaseZ + offsetZ;
    if (frontTiltRad !== 0) ring.rotation.x = frontTiltRad;
    ring.castShadow = ring.receiveShadow = false;
    group.add(ring);
    frontRings.push({ mesh: ring, mat, offsetZ });
  }

  // ---------- Animation metadata (your render loop expects these) ----------
  (group as any).userData.spinParts = [
    { mesh: noseRing, mat: noseMat, spinCoef: 2.0 },
    ...tailRings.map((r, i) => ({ mesh: r.mesh, mat: r.mat, spinCoef: i === 0 ? -1.0 : -0.8 })),
    ...frontRings.map((r, i) => ({ mesh: r.mesh, mat: r.mat, spinCoef:  0.9 + 0.1 * i })),
  ] as SpinFx[];

  (group as any).userData.tailState = {
    rings: tailRings,
    activations: tailRings.map((_, i) => (i === 0 ? 0.4 : 0.0)),
  } as ChainState;

  (group as any).userData.frontState = {
    rings: frontRings,
    activations: frontRings.map(() => 0.0),
  } as ChainState;

  (group as any).userData.frontRings = frontRings;
  (group as any).userData.noseRing = noseRing;

  return group;
}

/** Handy presets so you can “generate” variants without new code */
export const VEHICLE_PRESETS = {
  arrowhead: (o?: Partial<VehicleOptions>) => buildArrowhead(o),

  // Rough F-35-ish: more sweep, smaller dihedral, slight positive incidence.
  f35ish: (o?: Partial<VehicleOptions>) =>
    buildArrowhead({
      wingSpan: 5.2,
      wingChord: 2.2,
      wingSweepDeg: 34,
      wingDihedralDeg: 4,
      wingIncidenceDeg: 3,
      frontConeTiltDeg: 6,
      ...(o ?? {}),
    }),

  // Glider-ish: long span, tiny sweep/dihedral, no FX donuts up front
  glider: (o?: Partial<VehicleOptions>) =>
    buildArrowhead({
      wingSpan: 8.5,
      wingChord: 1.2,
      wingSweepDeg: 5,
      wingDihedralDeg: 3,
      frontDonutCount: 0,
      ...(o ?? {}),
    }),
};

export type VehicleName = keyof typeof VEHICLE_PRESETS;

export function buildVehicle(name: VehicleName, opts?: Partial<VehicleOptions>) {
  return VEHICLE_PRESETS[name](opts);
}
