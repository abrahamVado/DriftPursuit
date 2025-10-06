import * as THREE from 'three'

import type { BattlefieldConfig } from '../generateBattlefield'

function mulberry32(seed: number) {
  //1.- Match the deterministic random generator used elsewhere so geometry stays stable across sessions.
  let t = seed >>> 0
  return () => {
    t = (t + 0x6d2b79f5) >>> 0
    let r = Math.imul(t ^ (t >>> 15), t | 1)
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

export function createRockGeometry(
  archetypeIndex: number,
  seed: number,
  assets: BattlefieldConfig['assets'],
): THREE.BufferGeometry {
  //2.- Build base primitives and displace vertices with noise to generate believable rock silhouettes.
  const archetype = assets.rocks[archetypeIndex]
  let geometry: THREE.BufferGeometry
  if (archetype.geometry === 'box') {
    geometry = new THREE.BoxGeometry(1, 1, 1, 2, 2, 2)
  } else if (archetype.geometry === 'cylinder') {
    geometry = new THREE.CylinderGeometry(1, 1, 1, 8, 4)
  } else {
    geometry = new THREE.IcosahedronGeometry(1, 1)
  }
  if (typeof (geometry as THREE.BufferGeometry).toNonIndexed === 'function') {
    geometry = (geometry as THREE.BufferGeometry).toNonIndexed()
  } else if (geometry.index) {
    //3.- Fallback for environments missing toNonIndexed so instancing still receives unique vertices.
    geometry = geometry.clone()
    geometry.setIndex(null)
  }
  const random = mulberry32(seed)
  const positions = geometry.getAttribute('position') as THREE.BufferAttribute
  for (let index = 0; index < positions.count; index += 1) {
    const nx = random() * 2 - 1
    const ny = random() * 2 - 1
    const nz = random() * 2 - 1
    const displacement = (random() * 0.5 + 0.5) * archetype.noiseAmplitude
    positions.setXYZ(
      index,
      positions.getX(index) + nx * displacement,
      positions.getY(index) + ny * displacement,
      positions.getZ(index) + nz * displacement,
    )
  }
  positions.needsUpdate = true
  geometry.computeVertexNormals()
  return geometry
}

