// SandboxCanvas.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { defaultParams } from "../lib/config";
import { createSimulation, updateSimulation, type SimulationParams } from "../lib/world";
import type { SimulationState } from "../lib/world";
import type { ChunkData } from "../lib/terrain";
import { ControlsOverlay } from "./ControlsOverlay";

interface InputState {
  throttle: number;
  roll: number;
  boost: boolean;
  resetRoll: boolean;
}

type SpinFx = {
  mesh: THREE.Object3D;
  mat?: THREE.MeshStandardMaterial;
  spinCoef: number;
};

type Ring = {
  mesh: THREE.Mesh;
  mat: THREE.MeshStandardMaterial;
  offsetZ: number; // local Z offset from anchor
};

type ChainState = {
  rings: Ring[];
  activations: number[]; // 0..1 with lingering decay
};

function buildCraftMesh(opts?: {
  noseLen?: number;
  baseZ?: number;
  topZ?: number;
  baseWidth?: number;
  topYOffset?: number;
  wingSpan?: number;
  wingChord?: number;
  wingThickness?: number;
  wingSweepDeg?: number;
  wingDihedralDeg?: number;
  wingIncidenceDeg?: number;
  wingZ?: number;
  wingY?: number;
  tailDonutCount?: number;
  frontDonutCount?: number;
  frontConeTiltDeg?: number;
}) {
  const {
    noseLen = 1.5,
    baseZ = -1.0,
    topZ = -0.5,
    baseWidth = 0.8,
    topYOffset = 0.45,
    wingSpan = 4.8,
    wingChord = 2.0,
    wingThickness = 0.06,
    wingSweepDeg = 22,
    wingDihedralDeg = 10,
    wingIncidenceDeg = 0,
    wingZ = ( -1.0 + -0.5 ) / 2,
    wingY = 0.02,
    tailDonutCount = 7,
    frontDonutCount = 5,
    frontConeTiltDeg = 0,
  } = opts ?? {};

  const group = new THREE.Group();

  // ---------- Arrowhead Hull ----------
  const hullGeo = new THREE.BufferGeometry();
  const verts = new Float32Array([
    0, 0,  noseLen,
    -baseWidth, 0, baseZ,
     baseWidth, 0, baseZ,
    0,  topYOffset, topZ,
    0, -topYOffset, topZ,
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

  // ---------- Pointy “Batman” Wings ----------
  function makePointyWing(sign: 1 | -1) {
    const halfSpan = wingSpan * 0.5;
    const tipChord       = Math.max(0.2, wingChord * 0.22);
    const forwardSpike   = wingChord * 0.78;
    const trailingNotchZ = wingChord * 0.20;
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

    const extrude = new THREE.ExtrudeGeometry(shape, { depth: wingThickness, bevelEnabled: false, steps: 1 });
    extrude.computeBoundingBox();
    const bb = extrude.boundingBox!;
    const shiftY = - (bb.min.y + bb.max.y) / 2;
    extrude.translate(0, shiftY, -rootZMid);

    const wingMat = new THREE.MeshStandardMaterial({ color: 0x9ca3af, metalness: 0.6, roughness: 0.3, side: THREE.DoubleSide });
    const wing = new THREE.Mesh(extrude, wingMat);
    wing.castShadow = wing.receiveShadow = true;

    const rootInset = Math.max(0.02, wingThickness * 0.5);
    wing.position.set(sign * (baseWidth + rootInset), wingY, wingZ);
    wing.rotation.x = THREE.MathUtils.degToRad(wingIncidenceDeg);
    wing.rotation.y = -sign * THREE.MathUtils.degToRad(wingSweepDeg);
    wing.rotation.z =  sign * THREE.MathUtils.degToRad(wingDihedralDeg);
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
    opacity: 0.95
  });
  const noseRing = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.07, 12, 40), noseMat);
  noseRing.position.z = noseLen + 0.1;
  group.add(noseRing);

  // ---------- Tail Exhaust Chain ----------
  const tailBaseZ = baseZ - 1.2;
  const tailRings: Ring[] = [];
  const tailMainRadius = 0.70;
  const tailMainTube   = 0.15;
  const tailRadiusDecay = 0.80;
  const tailTubeDecay   = 0.82;
  const tailStepZ       = 0.48;

  for (let i = 0; i < Math.max(4, tailDonutCount); i++) {
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
    ring.visible = true;
    group.add(ring);
    tailRings.push({ mesh: ring, mat, offsetZ });
  }

  // ---------- Front Deceleration Chain ----------
  const frontBaseZ = noseRing.position.z + 0.22;
  const frontRings: Ring[] = [];
  const frontMainRadius = 0.32;
  const frontMainTube   = 0.065;
  const frontShrink     = 0.76;
  const frontStepZ      = 0.24;
  const frontTiltRad    = THREE.MathUtils.degToRad(frontConeTiltDeg);

  for (let i = 0; i < Math.max(3, frontDonutCount); i++) {
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
    ring.castShadow = false;
    ring.receiveShadow = false;
    if (frontTiltRad !== 0) ring.rotation.x = frontTiltRad;
    group.add(ring);
    frontRings.push({ mesh: ring, mat, offsetZ });
  }

  // ---------- Spin metadata & state ----------
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

  // expose front rings & nose for missile spawn
  (group as any).userData.frontRings = frontRings;
  (group as any).userData.noseRing = noseRing;

  return group;
}

function makeSmokeTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(size/2, size/2, 1, size/2, size/2, size/2);
  // soft white core → transparent edge
  g.addColorStop(0.0, "rgba(255,255,255,0.9)");
  g.addColorStop(0.3, "rgba(255,255,255,0.5)");
  g.addColorStop(1.0, "rgba(255,255,255,0.0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.Texture(canvas);
  tex.needsUpdate = true;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}


function createChunkMesh(chunk: ChunkData) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(chunk.positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(chunk.normals, 3));
  geometry.setIndex(new THREE.BufferAttribute(chunk.indices, 1));
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({
    color: 0x334155,
    flatShading: true,
    side: THREE.DoubleSide
  });
  return new THREE.Mesh(geometry, material);
}

export function SandboxCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const simRef = useRef<SimulationState | null>(null);
  const rafRef = useRef<number>();
  const inputRef = useRef<InputState>({ throttle: 0, roll: 0, boost: false, resetRoll: false });
  const [speed, setSpeed] = useState(0);
  const [targetSpeed, setTargetSpeed] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x020617);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000);

    const ambient = new THREE.AmbientLight(0xbfdcff, 0.5);
    const mainLight = new THREE.DirectionalLight(0xffffff, 1.2);
    mainLight.position.set(30, 60, 25);
    scene.add(ambient, mainLight);

    const craftMesh = buildCraftMesh({
      tailDonutCount: 7,
      frontDonutCount: 5,
      frontConeTiltDeg: 0,
      wingSpan: 4.8,
      wingChord: 2.0,
      wingSweepDeg: 22,
      wingDihedralDeg: 10,
      wingIncidenceDeg: 0,
    });
    scene.add(craftMesh);

    const chunkMeshes = new Map<number, THREE.Mesh>();

    const simParams: SimulationParams = {
      sandbox: defaultParams,
      camera: { followDistance: 12, heightOffset: 4, lateralOffset: 0, smoothing: 3 },
      craftRadius: 2.2
    };

    const simulation = createSimulation(simParams);
    simRef.current = simulation;

    function syncChunks() {
      if (!simRef.current) return;
      for (const [index, chunk] of simRef.current.band.chunks.entries()) {
        if (!chunkMeshes.has(index)) {
          const mesh = createChunkMesh(chunk);
          chunkMeshes.set(index, mesh);
          scene.add(mesh);
        }
      }
      for (const [index, mesh] of chunkMeshes.entries()) {
        if (!simRef.current.band.chunks.has(index)) {
          scene.remove(mesh);
          mesh.geometry.dispose();
          const mat = mesh.material;
          if (Array.isArray(mat)) mat.forEach((mm) => mm.dispose());
          else (mat as THREE.Material).dispose();
          chunkMeshes.delete(index);
        }
      }
    }

    syncChunks();

    let lastTime = performance.now();

    const handleResize = () => {
      renderer.setSize(window.innerWidth, window.innerHeight);
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
    };

    // ---------------- LASER (front-donut beam) ----------------
    const raycaster = new THREE.Raycaster();

    // Build a bright, additive “magic line of light” beam
    function buildLaserBeam() {
      const group = new THREE.Group();

      // inner core
      const coreGeo = new THREE.CylinderGeometry(0.05, 0.3, 1, 16);
      const coreMat = new THREE.MeshBasicMaterial({
        color: 0x66ffff,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const core = new THREE.Mesh(coreGeo, coreMat);
      group.add(core);

      // outer glow
      const glowGeo = new THREE.CylinderGeometry(0.16, 0.16, 1, 16);
      const glowMat = new THREE.MeshBasicMaterial({
        color: 0x22ccff,
        transparent: true,
        opacity: 0.35,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const glow = new THREE.Mesh(glowGeo, glowMat);
      group.add(glow);

      // impact sparkle (small additive sphere we place at the hit point)
      const spark = new THREE.Mesh(
        new THREE.SphereGeometry(0.22, 12, 10),
        new THREE.MeshBasicMaterial({
          color: 0xffeeaa,
          transparent: true,
          opacity: 0.9,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      spark.visible = false;
      group.add(spark);

      // Convenience for updates
      (group as any).userData = { core, glow, spark };
      return group;
    }

    let laserActive = false;
    let laserBeam: THREE.Group | null = null;

    // Simple flicker for the beam look
    function animateLaserFlicker() {
      if (!laserBeam) return;
      const { core, glow } = (laserBeam as any).userData;
      const t = performance.now() * 0.005;
      (core.material as THREE.MeshBasicMaterial).opacity = 0.86 + 0.09 * Math.sin(t * 2.3);
      (glow.material as THREE.MeshBasicMaterial).opacity = 0.28 + 0.10 * Math.sin(t * 1.7);
    }


    // ---- Smoke trail setup ----
    const smokeTex = makeSmokeTexture();

    function spawnSmokePuff(
      scene: THREE.Scene,
      position: THREE.Vector3,
      baseVel: THREE.Vector3
    ) {
      // per-sprite material so we can fade individually
      const mat = new THREE.SpriteMaterial({
        map: smokeTex,
        transparent: true,
        depthWrite: false,
        opacity: 0.9,
        color: 0xcccccc, // light gray smoke
        // (optional) blending: THREE.NormalBlending
      });
      const sprite = new THREE.Sprite(mat);
      sprite.position.copy(position);
      const s0 = 0.6 + Math.random() * 0.25;
      sprite.scale.set(s0, s0, s0);

      // small drift: inherit a tiny bit of missile vel + a bit upward
      const drift = baseVel.clone().multiplyScalar(0.06 + Math.random() * 0.04);
      drift.add(new THREE.Vector3(0, 0, 0.35 + Math.random() * 0.15));

      scene.add(sprite);
      return { sprite, bornMs: performance.now(), vel: drift };
    }



    // ---- Tunnel centerline adapter (auto-detects available methods) ----
    type BandAdapter = {
      ok: boolean;
      closestS: (p: THREE.Vector3) => number;
      centerAt: (s: number, out?: THREE.Vector3) => THREE.Vector3;
      tangentAt: (s: number, out?: THREE.Vector3) => THREE.Vector3;
      length?: number | null;
    };

    function makeBandAdapter(band: any): BandAdapter {
      if (!band) return { ok: false, closestS: () => 0, centerAt: v => v ?? new THREE.Vector3(), tangentAt: v => v ?? new THREE.Vector3(0,0,1), length: null };

      const closestSFn =
        band.closestS ||
        band.projectToCenterline ||
        band.nearestS ||
        band.project || null;

      const centerAtFn =
        band.centerAt ||
        band.getCenterAt ||
        band.pointAtS ||
        (band.sample && ((s: number, out: any) => band.sample(s, out)?.position)) ||
        null;

      const tangentAtFn =
        band.tangentAt ||
        band.getTangentAt ||
        band.tangentAtS ||
        (band.sample && ((s: number, out: any) => band.sample(s, out)?.tangent)) ||
        null;

      const lengthVal = band.length ?? band.totalLength ?? null;

      if (closestSFn && centerAtFn && tangentAtFn) {
        return {
          ok: true,
          closestS: (p: THREE.Vector3) => closestSFn.call(band, p),
          centerAt: (s: number, out = new THREE.Vector3()) => {
            const v = centerAtFn.call(band, s);
            return Array.isArray(v) ? out.set(v[0], v[1], v[2]) : out.copy(v);
          },
          tangentAt: (s: number, out = new THREE.Vector3()) => {
            const v = tangentAtFn.call(band, s);
            return Array.isArray(v) ? out.set(v[0], v[1], v[2]).normalize() : out.copy(v).normalize();
          },
          length: typeof lengthVal === "number" ? lengthVal : null,
        };
      }

      return { ok: false, closestS: () => 0, centerAt: v => v ?? new THREE.Vector3(), tangentAt: v => v ?? new THREE.Vector3(0,0,1), length: null };
    }

    const bandAdapter = makeBandAdapter(simRef.current?.band);

    // ---------------- MISSILES ONLY ----------------

    // Projectiles store (missiles only for this version)
    const projectiles: {
      id: number;
      mesh: THREE.Object3D;
      vel: THREE.Vector3;
      type: "missile";
      spawnTime: number;
      life: number;
      distanceTraveled: number;
      extra: {
        donuts: THREE.Mesh[];

        usePath: boolean;
        s: number;
        maxSpeed: number;
        accelDelayMs: number;
        accel: number;
        turnRateRad: number;

        ignited: boolean;
        gravity: number;
        offsetRight: number;
        offsetUp: number;
      // --- smoke ---
      smoke: {
        lastSpawnMs: number;
        sprites: Array<{ sprite: THREE.Sprite; bornMs: number; vel: THREE.Vector3 }>;
      };        
      };
    }[] = [];
    let projId = 1;

    function buildObeliskMissileModel(): { root: THREE.Group; donuts: THREE.Mesh[] } {
      const root = new THREE.Group();
      const lengthScale = 1.5; // +50% length
      const thickness   = 2.0; // +100% fatter

      // Shaft
      const shaft = new THREE.Mesh(
        new THREE.BoxGeometry(0.18 * thickness, 0.18 * thickness, 1.15 * lengthScale),
        new THREE.MeshStandardMaterial({ color: 0x888a8f, metalness: 0.7, roughness: 0.35 })
      );
      shaft.position.z = 0.4 * lengthScale;
      root.add(shaft);

      // Tip
      const tip = new THREE.Mesh(
        new THREE.ConeGeometry(0.14 * thickness, 0.35 * lengthScale, 4),
        new THREE.MeshStandardMaterial({ color: 0xbfc3cc, metalness: 0.85, roughness: 0.25 })
      );
      tip.position.z = shaft.position.z + (0.65 * lengthScale);
      root.add(tip);

      // Wings
      const wingMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.6, roughness: 0.35 });
      const wingL = new THREE.Mesh(new THREE.BoxGeometry(0.02 * thickness, 0.8, 0.20 * lengthScale), wingMat);
      const wingR = wingL.clone();
      wingL.position.set(-(0.20 * thickness), 0, 0.25 * lengthScale);
      wingR.position.set( +(0.20 * thickness), 0, 0.25 * lengthScale);
      wingL.rotation.z =  Math.PI * 0.06;
      wingR.rotation.z = -Math.PI * 0.06;
      root.add(wingL, wingR);

      // Donuts: RED big, YELLOW med, VIOLET small
      const donuts: THREE.Mesh[] = [];
      const rearZ = -0.10 * lengthScale;
      const donutDefs = [
        { r: 0.26, t: 0.055, color: 0xff2a2a },
        { r: 0.20, t: 0.045, color: 0xffdd33 },
        { r: 0.14, t: 0.040, color: 0x9933ff },
      ];
      for (let i = 0; i < donutDefs.length; i++) {
        const d = donutDefs[i];
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(d.r, d.t, 12, 44),
          new THREE.MeshStandardMaterial({
            color: 0xffffff,
            emissive: new THREE.Color(d.color),
            emissiveIntensity: 1.2,
            roughness: 0.25,
            metalness: 0.1,
            transparent: true,
            opacity: 0.95,
            depthWrite: false,
          })
        );
        ring.position.z = rearZ - i * 0.05 * lengthScale;
        root.add(ring);
        donuts.push(ring);
      }

      return { root, donuts };
    }

    function createMissile(pos: THREE.Vector3, dir: THREE.Vector3) {
      const { root, donuts } = buildObeliskMissileModel();

      // DROP: spawn slightly below craft
      const craftUp = new THREE.Vector3(
        simRef.current!.craft.up[0],
        simRef.current!.craft.up[1],
        simRef.current!.craft.up[2]
      );
      root.position.copy(pos).addScaledVector(craftUp, -0.6);
      root.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.clone().normalize());
      scene.add(root);

      // Coast velocity = craft velocity (no extra boost) until ignition
      const craftForward = new THREE.Vector3(
        simRef.current!.craft.forward[0],
        simRef.current!.craft.forward[1],
        simRef.current!.craft.forward[2]
      );
      const craftSpeed = simRef.current!.craft.speed;
      const missileSpeed0 = craftSpeed * 1.2; // minimum we’ll enforce at ignition
      const vel = craftForward.clone().multiplyScalar(craftSpeed);

      // Path lock available?
      const usePath = !!bandAdapter.ok;

      projectiles.push({
        id: projId++,
        mesh: root,
        vel,
        type: "missile",
        spawnTime: performance.now(),
        life: 300,
        distanceTraveled: 0,
        extra: {
          donuts,
          usePath,
          s: 0, // set at ignition
          accelDelayMs: 1000,
          accel: 10,
          maxSpeed: Math.max(140, missileSpeed0 * 1.8),
          turnRateRad: THREE.MathUtils.degToRad(45),

          ignited: false,
          gravity: 9.81,
          offsetRight: 0,
          offsetUp: 0,

          smoke: {
            lastSpawnMs: performance.now(),
            sprites: [],
          },          
        },
      });
    }

    // ---- Input (add fire key 'M') ----
    const keyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      if (event.code === "KeyW") inputRef.current.throttle = 1;
      if (event.code === "KeyS") inputRef.current.throttle = -1;
      if (event.code === "KeyA") inputRef.current.roll = -1;
      if (event.code === "KeyD") inputRef.current.roll = 1;
      if (event.code === "ShiftLeft" || event.code === "ShiftRight") inputRef.current.boost = true;
      if (event.code === "Space") inputRef.current.resetRoll = true;

      // In keyDown:
      if (event.code === "KeyL") {
        if (!laserActive) {
          laserActive = true;
          if (!laserBeam) {
            laserBeam = buildLaserBeam();
            scene.add(laserBeam);
          }
        }
      }



      if (event.code === "KeyM") {
        // spawn from front neon circle (outermost ring), fallback to nose
        const front = (craftMesh as any).userData.frontRings as Ring[] | undefined;
        let spawnWorld = new THREE.Vector3();
        if (front && front.length > 0) front[0].mesh.getWorldPosition(spawnWorld);
        else (craftMesh as any).userData.noseRing?.getWorldPosition(spawnWorld);

        const forwardDir = new THREE.Vector3(0, 0, 1).applyMatrix4(new THREE.Matrix4().extractRotation(craftMesh.matrixWorld));
        createMissile(spawnWorld, forwardDir);
      }
    };

    const keyUp = (event: KeyboardEvent) => {
      if (event.code === "KeyW" && inputRef.current.throttle > 0) inputRef.current.throttle = 0;
      if (event.code === "KeyS" && inputRef.current.throttle < 0) inputRef.current.throttle = 0;
      if (event.code === "KeyA" && inputRef.current.roll < 0) inputRef.current.roll = 0;
      if (event.code === "KeyD") inputRef.current.roll = Math.max(0, inputRef.current.roll - 0);
      if (event.code === "ShiftLeft" || event.code === "ShiftRight") inputRef.current.boost = false;

      // In keyUp:
      if (event.code === "KeyL") {
        laserActive = false;
        if (laserBeam) {
          // hide instead of destroying so we can reuse without reallocating
          laserBeam.visible = false;
          (laserBeam as any).userData.spark.visible = false;
        }
      }      
    };

    window.addEventListener("resize", handleResize);
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);

    const animate = () => {
      if (!simRef.current) return;
      const now = performance.now();
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;

      const params: SimulationParams = {
        sandbox: simParams.sandbox,
        camera: { ...simParams.camera, smoothing: inputRef.current.boost ? 6 : simParams.camera.smoothing },
        craftRadius: simParams.craftRadius
      };

      updateSimulation(
        simRef.current,
        params,
        { throttleDelta: inputRef.current.throttle, rollDelta: inputRef.current.roll },
        dt
      );

      if (inputRef.current.resetRoll) {
        simRef.current.craft.roll = 0;
        simRef.current.craft.rollRate = 0;
        inputRef.current.resetRoll = false;
      }

      syncChunks();

      const { craft, camera: cam } = simRef.current;

      // Pose the craft
      craftMesh.position.set(craft.position[0], craft.position[1], craft.position[2]);
      const basis = new THREE.Matrix4().makeBasis(
        new THREE.Vector3(craft.right[0], craft.right[1], craft.right[2]),
        new THREE.Vector3(craft.up[0], craft.up[1], craft.up[2]),
        new THREE.Vector3(craft.forward[0], craft.forward[1], craft.forward[2])
      );
      craftMesh.setRotationFromMatrix(basis);

      // ---------- FX ----------
      const spinParts: SpinFx[] = (craftMesh as any).userData?.spinParts ?? [];
      const tailState: ChainState | undefined = (craftMesh as any).userData?.tailState;
      const frontState: ChainState | undefined = (craftMesh as any).userData?.frontState;

      const v = THREE.MathUtils.clamp(craft.speed / 80, 0, 1);
      const boosting = inputRef.current.boost ? 1 : 0;

      const thrustForward = Math.max(0, inputRef.current.throttle);
      const accelFactor = THREE.MathUtils.clamp(0.65 * thrustForward + 0.35 * v + (boosting ? 0.3 : 0), 0, 1);

      const thrustReverse = Math.max(0, -inputRef.current.throttle);
      const slowing = Math.max(0, (speed - targetSpeed) / 25);
      const decelFactor = THREE.MathUtils.clamp(0.7 * thrustReverse + 0.5 * slowing, 0, 1);

      spinParts.forEach((s) => {
        s.mesh.rotation.z += s.spinCoef * (0.5 + 1.5 * v + 1.0 * boosting) * dt;
        if (s.mat) s.mat.emissiveIntensity = 0.8 + 1.2 * v + (boosting ? 1.0 : 0);
      });

      if (tailState) {
        const { rings, activations } = tailState;
        const white = new THREE.Color(0xffffff);
        const red = new THREE.Color(0xff2a2a);
        rings[0].mat.color.lerpColors(white, red, accelFactor);
        const n = rings.length;
        const low = 0.10, high = 0.85;
        const thresholds: number[] = [];
        for (let i = 1; i < n; i++) thresholds.push(low + (high - low) * ((i - 1) / Math.max(1, (n - 2))));
        const targets: number[] = [Math.max(0.25, accelFactor)];
        for (let i = 1; i < n; i++) targets[i] = accelFactor >= thresholds[i - 1] ? accelFactor : 0.0;
        const halfLife = 0.7;
        const decay = Math.exp(-Math.max(0.0001, dt) / halfLife);
        for (let i = 0; i < n; i++) {
          const prev = activations[i];
          const next = Math.max(targets[i], prev * decay);
          activations[i] = THREE.MathUtils.clamp(next, 0, 1);
          const a = activations[i];
          const baseOpacity = i === 0 ? 0.25 : 0.06;
          rings[i].mat.opacity = THREE.MathUtils.clamp(baseOpacity + 0.85 * a, 0, 1);
          rings[i].mat.emissiveIntensity = (i === 0 ? 0.7 : 0.5) + 1.6 * a;
          rings[i].mesh.scale.setScalar(1.0 + 0.06 * a * Math.sin(performance.now() * 0.006 + i));
        }
      }

      if (frontState) {
        const { rings, activations } = frontState;
        const cyan = new THREE.Color(0x33ccff);
        const blue = new THREE.Color(0x4477ff);
        const n = rings.length;
        const low = 0.10, high = 0.90;
        const thresholds: number[] = [];
        for (let i = 0; i < n; i++) thresholds.push(low + (high - low) * (i / Math.max(1, (n - 1))));
        const targets: number[] = [];
        for (let i = 0; i < n; i++) targets[i] = decelFactor >= thresholds[i] ? decelFactor : 0.0;
        const halfLife = 0.6;
        const decay = Math.exp(-Math.max(0.0001, dt) / halfLife);
        for (let i = 0; i < n; i++) {
          const prev = activations[i];
          const next = Math.max(targets[i], prev * decay);
          activations[i] = THREE.MathUtils.clamp(next, 0, 1);
          const a = activations[i];
          rings[i].mat.opacity = THREE.MathUtils.clamp(0.04 + 0.9 * a, 0, 0.95);
          rings[i].mat.emissive = cyan.clone().lerp(blue, a);
          rings[i].mat.emissiveIntensity = 0.4 + 1.6 * a;
          rings[i].mesh.scale.setScalar(1.0 + 0.05 * a * Math.sin(performance.now() * 0.007 + i * 0.6));
        }
      }
// ---------- LASER UPDATE ----------
if (laserBeam) {
  if (laserActive) {
    // Where to spawn from? Use the outermost front donut if present, else the nose
    const front = (craftMesh as any).userData.frontRings as Ring[] | undefined;
    const spawnWorld = new THREE.Vector3();
    if (front && front.length > 0) front[0].mesh.getWorldPosition(spawnWorld);
    else (craftMesh as any).userData.noseRing?.getWorldPosition(spawnWorld);

    // Beam direction = craft forward in world
    const forwardDir = new THREE.Vector3(0, 0, 1).applyMatrix4(
      new THREE.Matrix4().extractRotation(craftMesh.matrixWorld)
    ).normalize();

    // Raycast against terrain chunks to find the hit distance
    const maxRange = 1500;
    raycaster.set(spawnWorld, forwardDir);
    raycaster.far = maxRange;

    // Build a list of chunk mesh targets (your chunkMeshes Map exists above)
    const targets: THREE.Object3D[] = [];
    for (const m of chunkMeshes.values()) targets.push(m);

    const hits = raycaster.intersectObjects(targets, false);
    const hit = hits.length > 0 ? hits[0] : null;
    const dist = hit ? hit.distance : maxRange;

    // Place/scale the beam: Cylinder length is along +Y by default
    const mid = spawnWorld.clone().addScaledVector(forwardDir, dist * 0.5);
    laserBeam.visible = true;
    laserBeam.position.copy(mid);

    // rotate beam Y-axis to forwardDir
    const up = new THREE.Vector3(0, 1, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(up, forwardDir);
    laserBeam.setRotationFromQuaternion(q);

    // scale children to match distance
    const { core, glow, spark } = (laserBeam as any).userData;
    core.scale.set(1, dist, 1); // scales height (length) along Y
    glow.scale.set(1, dist, 1);

    // Because original geometries have height=1 centered at origin,
    // they already span [-0.5,+0.5] along Y. Scaling Y by `dist` turns them into `dist` long.

    // Put impact spark where it hits
    if (hit) {
      spark.visible = true;
      spark.position.set(0, dist * 0.5, 0); // end of cylinder (along local +Y)
      // Subtle pulsing
      const s = 0.8 + 0.25 * Math.sin(performance.now() * 0.02);
      spark.scale.set(s, s, s);
    } else {
      spark.visible = false;
    }

    // Pretty flicker
    animateLaserFlicker();

    // TODO: if you later want to "destroy" terrain here, you have:
    // hit.object (mesh), hit.point (world), hit.face / uv ... hook your logic here.
  } else {
    // inactive: hide but keep the object ready
    laserBeam.visible = false;
  }
}

      // ---------- MISSILE UPDATE ----------
      for (let i = projectiles.length - 1; i >= 0; i--) {
        const p = projectiles[i];
        if (p.type !== "missile") continue;

        const root = p.mesh as THREE.Group;
        const msSinceSpawn = performance.now() - p.spawnTime;
        const dtClamped = dt;

        // --- COAST (pre-ignition): gravity drop + drift
        if (!p.extra.ignited) {
          p.vel.z -= p.extra.gravity * dtClamped;
          root.position.addScaledVector(p.vel, dtClamped);

          const vlen = p.vel.length();
          if (vlen > 1e-3) {
            const dir = p.vel.clone().multiplyScalar(1 / vlen);
            root.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
          }

          if (msSinceSpawn >= p.extra.accelDelayMs) {
            p.extra.ignited = true;

            // ensure minimum speed along current heading
            const craftSpeedNow = simRef.current?.craft.speed ?? 0;
            const minIgniteSpeed = craftSpeedNow * 1.2;
            const heading = new THREE.Vector3(0, 0, 1).applyQuaternion(root.quaternion);
            const speedNow = Math.max(p.vel.length(), minIgniteSpeed);
            p.vel.copy(heading.multiplyScalar(speedNow));

            if (p.extra.usePath) {
              // join the path NEAR the centerline (keep current offset)
              const s0 = bandAdapter.closestS(root.position.clone());
              p.extra.s = s0;

              const cPos = bandAdapter.centerAt(s0, new THREE.Vector3());
              const tHat = bandAdapter.tangentAt(s0, new THREE.Vector3()).normalize();
              const upGuess = new THREE.Vector3(0, 0, 1);
              let rightV = new THREE.Vector3().crossVectors(upGuess, tHat);
              if (rightV.lengthSq() < 1e-6) rightV = new THREE.Vector3(1, 0, 0);
              rightV.normalize();
              const upV = new THREE.Vector3().crossVectors(tHat, rightV).normalize();

              const delta = root.position.clone().sub(cPos);
              p.extra.offsetRight = delta.dot(rightV);
              p.extra.offsetUp    = delta.dot(upV);

              // Optional fixed offsets instead of “whatever it was at ignition”:
              // p.extra.offsetRight = 1.2; p.extra.offsetUp = 0.0;

              root.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tHat);
            }
          }

          continue; // wait until ignition is done
        }

        // --- POWERED (post-ignition): accelerate + path follow NEAR centerline
        const newSpeed = Math.min(p.extra.maxSpeed, p.vel.length() + p.extra.accel * dtClamped);
        p.vel.setLength(newSpeed);

        if (p.extra.usePath) {
          p.extra.s += newSpeed * dtClamped;
          p.distanceTraveled += newSpeed * dtClamped;

          const cPos = bandAdapter.centerAt(p.extra.s, new THREE.Vector3());
          const tHat = bandAdapter.tangentAt(p.extra.s, new THREE.Vector3()).normalize();

          const upGuess = new THREE.Vector3(0, 0, 1);
          let rightV = new THREE.Vector3().crossVectors(upGuess, tHat);
          if (rightV.lengthSq() < 1e-6) rightV = new THREE.Vector3(1, 0, 0);
          rightV.normalize();
          const upV = new THREE.Vector3().crossVectors(tHat, rightV).normalize();

          const desired = cPos
            .clone()
            .addScaledVector(rightV, p.extra.offsetRight)
            .addScaledVector(upV,    p.extra.offsetUp);

          root.position.copy(desired);
          root.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tHat);
          p.vel.copy(tHat.multiplyScalar(newSpeed));

          if (bandAdapter.length && p.extra.s >= bandAdapter.length!) {
            p.distanceTraveled = Math.max(p.distanceTraveled, bandAdapter.length!);
          }
        } else {
          // fallback steering toward craft forward if path missing
          const desiredDir = new THREE.Vector3(0, 0, 1).applyMatrix4(
            new THREE.Matrix4().extractRotation(craftMesh.matrixWorld)
          ).normalize();
          const curDir = p.vel.clone().normalize();
          const dot = THREE.MathUtils.clamp(curDir.dot(desiredDir), -1, 1);
          const ang = Math.acos(dot);
          if (ang > 1e-4) {
            const maxTurn = THREE.MathUtils.degToRad(45) * dtClamped;
            const t = Math.min(1, maxTurn / ang);
            const qTurn = new THREE.Quaternion().setFromUnitVectors(curDir, desiredDir);
            const limited = curDir.clone().applyQuaternion(new THREE.Quaternion().slerp(qTurn, t)).normalize();
            p.vel.copy(limited.multiplyScalar(newSpeed));
          }
          root.position.addScaledVector(p.vel, dtClamped);
          p.distanceTraveled += newSpeed * dtClamped;
          root.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), p.vel.clone().normalize());
        }

        // ---- Smoke: spawn while ignited ----
        const nowMs = performance.now();
        if (p.extra.ignited && nowMs - p.extra.smoke.lastSpawnMs >= 60) {
          p.extra.smoke.lastSpawnMs = nowMs;
          // Spawn at current missile position; use current velocity for drift
          const puff = spawnSmokePuff(scene, (p.mesh as THREE.Object3D).position, p.vel);
          p.extra.smoke.sprites.push(puff);
        }

        // ---- Smoke: update all puffs (grow, fade, drift, die at 3s) ----
        for (let si = p.extra.smoke.sprites.length - 1; si >= 0; si--) {
          const puff = p.extra.smoke.sprites[si];
          const age = (nowMs - puff.bornMs) / 1000.0;

          // lifetime 3s
          if (age >= 3.0) {
            scene.remove(puff.sprite);
            (puff.sprite.material as THREE.Material).dispose();
            puff.sprite.geometry?.dispose?.(); // Sprite has no geometry but keep it safe
            p.extra.smoke.sprites.splice(si, 1);
            continue;
          }

          // drift & subtle upward lift
          puff.sprite.position.addScaledVector(puff.vel, dt);

          // scale up over time (gentle expansion)
          const s = 0.6 + age * 0.8;
          puff.sprite.scale.set(s, s, s);

          // fade out toward end
          const mat = puff.sprite.material as THREE.SpriteMaterial;
          // starts ~0.9 → goes to 0 over 3s; curve looks nicer with quadratic drop
          const t = THREE.MathUtils.clamp(age / 3.0, 0, 1);
          mat.opacity = 0.9 * (1 - t) * (1 - t);
        }

        // dispose laser resources
        if (laserBeam) {
          laserBeam.traverse((o: any) => {
            o.geometry?.dispose?.();
            if (Array.isArray(o.material)) o.material.forEach((m: any) => m.dispose?.());
            else o.material?.dispose?.();
          });
          scene.remove(laserBeam);
          laserBeam = null;
        }


        // Donut pulse FX
        const tPulse = performance.now() * 0.004;
        p.extra.donuts.forEach((d, idx) => {
          const base = 1.0 + 0.04 * Math.sin(tPulse + idx * 0.8);
          d.scale.setScalar(base);
          const mat = d.material as THREE.MeshStandardMaterial;
          mat.emissiveIntensity = 1.0 + 0.8 * (0.5 + 0.5 * Math.sin(tPulse * 1.7 + idx * 1.2));
        });

        // Remove after ~1 km of travel
        if (p.distanceTraveled >= 1000) { 
          const flash = new THREE.Mesh(
            new THREE.SphereGeometry(0.9, 10, 8),
            new THREE.MeshBasicMaterial({ color: 0xffaa55 })
          );
          flash.position.copy(root.position);
          scene.add(flash);
          setTimeout(() => {
            scene.remove(flash);
            flash.geometry.dispose();
            (flash.material as THREE.Material).dispose();
          }, 160);

          scene.remove(root);
          root.traverse((o: any) => {
            o.geometry?.dispose?.();
            if (Array.isArray(o.material)) o.material.forEach((m: any) => m.dispose?.());
            else o.material?.dispose?.();
          });
          // also clean its smoke puffs
          for (const puff of p.extra.smoke.sprites) {
            scene.remove(puff.sprite);
            (puff.sprite.material as THREE.Material).dispose();
            puff.sprite.geometry?.dispose?.();
          }
          p.extra.smoke.sprites.length = 0;

          projectiles.splice(i, 1);
        }
      }

      // Camera
      camera.position.set(cam.position[0], cam.position[1], cam.position[2]);
      camera.lookAt(new THREE.Vector3(craft.position[0], craft.position[1], craft.position[2]));

      renderer.render(scene, camera);
      setSpeed(craft.speed);
      setTargetSpeed(craft.targetSpeed);

      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
      renderer.dispose();

      // dispose chunk meshes
      for (const mesh of chunkMeshes.values()) {
        mesh.geometry.dispose();
        const mat = mesh.material;
        if (Array.isArray(mat)) mat.forEach((mm) => mm.dispose());
        else (mat as THREE.Material).dispose();
      }

      // dispose craft submeshes
      craftMesh.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        const geom = (mesh as any).geometry as THREE.BufferGeometry | undefined;
        const mat  = (mesh as any).material as THREE.Material | THREE.Material[] | undefined;
        if (geom) geom.dispose();
        if (mat) {
          if (Array.isArray(mat)) mat.forEach((mm) => mm.dispose());
          else mat.dispose();
        }
      });
    };
  }, []);

  return (
    <>
      <canvas ref={canvasRef} style={{ width: "100vw", height: "100vh", display: "block" }} />
      <ControlsOverlay speed={speed} targetSpeed={targetSpeed} />
    </>
  );
}
