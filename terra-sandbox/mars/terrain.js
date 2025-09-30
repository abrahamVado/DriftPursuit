import { THREE } from './threeLoader.js';
import { fractalNoise2D, ridgedNoise2D, warpCoordinate } from './noise.js';

function createMulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomRange(rng, min, max) {
  return min + (max - min) * rng();
}

function buildCraterField({ count, radiusRange, depthRange, area, rng }) {
  const craters = [];
  for (let i = 0; i < count; i += 1) {
    craters.push({
      x: randomRange(rng, -area, area),
      z: randomRange(rng, -area, area),
      radius: randomRange(rng, radiusRange[0], radiusRange[1]),
      depth: randomRange(rng, depthRange[0], depthRange[1]),
      rimHeight: randomRange(rng, 1.5, 4.5),
      rimWidth: randomRange(rng, 0.12, 0.28),
    });
  }
  return craters;
}

function applyCrater(height, x, z, crater) {
  const dx = x - crater.x;
  const dz = z - crater.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  if (dist > crater.radius) {
    return height;
  }

  const t = 1 - dist / crater.radius;
  const bowl = -(crater.depth * t * t * (1 - crater.rimWidth * t));
  const rim = crater.rimHeight * Math.max(0, Math.pow(1 - dist / (crater.radius * 1.25), 3));
  return height + bowl + rim;
}

function colorForHeight(height, minHeight, maxHeight) {
  const normalized = Math.max(0, Math.min(1, (height - minHeight) / Math.max(1, maxHeight - minHeight)));
  const low = new THREE.Color('#5a2316');
  const mid = new THREE.Color('#b65835');
  const high = new THREE.Color('#f7c586');

  if (normalized < 0.35) {
    return low.clone().lerp(mid, normalized / 0.35);
  }
  if (normalized > 0.78) {
    return mid.clone().lerp(high, (normalized - 0.78) / 0.22);
  }
  const blend = (normalized - 0.35) / (0.78 - 0.35);
  return mid.clone().lerp(new THREE.Color('#d2854f'), blend);
}

function createRockField({ terrainSize, sampleHeight, rng, count }) {
  const geometry = new THREE.IcosahedronGeometry(1, 1);
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#7c4632'),
    roughness: 0.95,
    metalness: 0.04,
    flatShading: true,
  });
  const instanced = new THREE.InstancedMesh(geometry, material, count);
  instanced.castShadow = true;
  instanced.receiveShadow = true;

  const dummy = new THREE.Object3D();
  const half = terrainSize / 2;

  for (let i = 0; i < count; i += 1) {
    const x = randomRange(rng, -half * 0.92, half * 0.92);
    const z = randomRange(rng, -half * 0.92, half * 0.92);
    const h = sampleHeight(x, z);
    const scale = randomRange(rng, 2.2, 5.5);
    dummy.position.set(x, h, z);
    dummy.rotation.set(randomRange(rng, 0, Math.PI), randomRange(rng, 0, Math.PI * 2), randomRange(rng, 0, Math.PI));
    dummy.scale.setScalar(scale * (0.45 + rng() * 0.4));
    dummy.updateMatrix();
    instanced.setMatrixAt(i, dummy.matrix);

    const hueShift = 0.02 * (rng() - 0.5);
    const rockColor = new THREE.Color('#8a543a');
    rockColor.offsetHSL(hueShift, -0.12 * rng(), -0.1 * rng());
    instanced.setColorAt(i, rockColor);
  }
  instanced.instanceMatrix.needsUpdate = true;
  if (instanced.instanceColor) {
    instanced.instanceColor.needsUpdate = true;
  }
  return instanced;
}

function createDustField({ terrainSize, rng, count }) {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const alphas = new Float32Array(count);
  const baseY = new Float32Array(count);
  const half = terrainSize / 2;
  const colorA = new THREE.Color('#f8d2a2');
  const colorB = new THREE.Color('#c96f3a');

  for (let i = 0; i < count; i += 1) {
    const baseIndex = i * 3;
    const x = randomRange(rng, -half, half);
    const z = randomRange(rng, -half, half);
    const y = randomRange(rng, 12, 38);
    positions[baseIndex] = x;
    positions[baseIndex + 1] = y;
    positions[baseIndex + 2] = z;
    baseY[i] = y;

    const mix = rng();
    const color = colorA.clone().lerp(colorB, mix);
    colors[baseIndex] = color.r;
    colors[baseIndex + 1] = color.g;
    colors[baseIndex + 2] = color.b;

    alphas[i] = 0.35 + 0.4 * rng();
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1));
  geometry.setAttribute('baseY', new THREE.BufferAttribute(baseY, 1));

  const material = new THREE.PointsMaterial({
    size: 12,
    color: new THREE.Color('#f8d2a2'),
    transparent: true,
    opacity: 0.75,
    depthWrite: false,
    vertexColors: true,
    sizeAttenuation: true,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.name = 'dustField';
  return points;
}

export function createMarsTerrain({
  size = 1600,
  segments = 256,
  seed = 1337,
} = {}) {
  const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
  geometry.rotateX(-Math.PI / 2);
  const vertexCount = (segments + 1) * (segments + 1);
  const positions = geometry.attributes.position;
  const colors = new Float32Array(vertexCount * 3);
  const colorAttr = new THREE.BufferAttribute(colors, 3);
  geometry.setAttribute('color', colorAttr);

  const heights = new Float32Array(vertexCount);
  const rng = createMulberry32(seed);
  const area = (size / 2) * 0.92;
  const craterCount = Math.floor(randomRange(rng, 18, 34));
  const craters = buildCraterField({
    count: craterCount,
    radiusRange: [48, 180],
    depthRange: [8, 62],
    area,
    rng,
  });

  const half = size / 2;
  const step = size / segments;
  let minHeight = Infinity;
  let maxHeight = -Infinity;

  for (let zi = 0; zi <= segments; zi += 1) {
    for (let xi = 0; xi <= segments; xi += 1) {
      const vertexIndex = zi * (segments + 1) + xi;
      const px = -half + xi * step;
      const pz = -half + zi * step;
      const warped = warpCoordinate(px, pz, {
        seed,
        amplitude: 46,
        frequency: 0.0022,
      });

      const base = fractalNoise2D(warped.x, warped.y, {
        seed,
        frequency: 0.0016,
        octaves: 5,
        gain: 0.52,
      });
      const ridges = ridgedNoise2D(px, pz, {
        seed: seed + 400,
        frequency: 0.0009,
        octaves: 4,
        gain: 0.6,
      });
      const dunes = fractalNoise2D(px + 8000, pz - 8000, {
        seed: seed + 9000,
        frequency: 0.0045,
        octaves: 3,
        gain: 0.55,
      });

      let height = base * 120 + ridges * 210 + dunes * 16;
      height += fractalNoise2D(px - 2000, pz + 2000, {
        seed: seed + 12345,
        frequency: 0.0005,
        octaves: 2,
        gain: 0.45,
      }) * 140;

      for (const crater of craters) {
        height = applyCrater(height, px, pz, crater);
      }

      const altitudeBias = fractalNoise2D(px * 0.0004, pz * 0.0004, {
        seed: seed + 555,
        frequency: 0.0004,
        octaves: 2,
        gain: 0.65,
      }) * 24;
      height += altitudeBias;

      heights[vertexIndex] = height;
      positions.setY(vertexIndex, height);
      minHeight = Math.min(minHeight, height);
      maxHeight = Math.max(maxHeight, height);
    }
  }

  positions.needsUpdate = true;

  for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += 1) {
    const height = heights[vertexIndex];
    const color = colorForHeight(height, minHeight, maxHeight);
    colors[vertexIndex * 3] = color.r;
    colors[vertexIndex * 3 + 1] = color.g;
    colors[vertexIndex * 3 + 2] = color.b;
  }

  geometry.computeVertexNormals();
  geometry.attributes.normal.needsUpdate = true;
  colorAttr.needsUpdate = true;

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    metalness: 0.05,
    flatShading: false,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.name = 'marsTerrain';

  const sampleHeight = (x, z) => {
    const fx = (x + half) / step;
    const fz = (z + half) / step;
    const xi = Math.floor(fx);
    const zi = Math.floor(fz);
    const tx = fx - xi;
    const tz = fz - zi;

    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
    const ix0 = clamp(xi, 0, segments);
    const iz0 = clamp(zi, 0, segments);
    const ix1 = clamp(ix0 + 1, 0, segments);
    const iz1 = clamp(iz0 + 1, 0, segments);

    const idx = (ix, iz) => iz * (segments + 1) + ix;
    const h00 = heights[idx(ix0, iz0)];
    const h10 = heights[idx(ix1, iz0)];
    const h01 = heights[idx(ix0, iz1)];
    const h11 = heights[idx(ix1, iz1)];

    const hx0 = h00 + (h10 - h00) * tx;
    const hx1 = h01 + (h11 - h01) * tx;
    return hx0 + (hx1 - hx0) * tz;
  };

  const rockField = createRockField({
    terrainSize: size,
    sampleHeight,
    rng,
    count: Math.floor(randomRange(rng, 160, 240)),
  });

  const dustField = createDustField({
    terrainSize: size * 0.9,
    rng,
    count: Math.floor(randomRange(rng, 1800, 2600)),
  });

  return {
    mesh,
    rockField,
    dustField,
    sampleHeight,
    stats: { minHeight, maxHeight, craters: craterCount },
  };
}

export function disposeMarsTerrain(terrain) {
  if (!terrain) return;
  if (terrain.mesh) {
    terrain.mesh.geometry?.dispose?.();
    terrain.mesh.material?.dispose?.();
  }
  if (terrain.rockField) {
    terrain.rockField.geometry?.dispose?.();
    terrain.rockField.material?.dispose?.();
  }
  if (terrain.dustField) {
    terrain.dustField.geometry?.dispose?.();
    terrain.dustField.material?.dispose?.();
  }
}
