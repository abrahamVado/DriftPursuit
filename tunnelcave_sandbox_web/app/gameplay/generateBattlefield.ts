import * as THREE from 'three'

export interface BattlefieldFeature {
  position: THREE.Vector3
  radius: number
  depth: number
}

export interface BattlefieldConfig {
  seed: number
  fieldSize: number
  groundY: number
  ceilingY: number
  features: BattlefieldFeature[]
  spawnPoint: THREE.Vector3
}

function mulberry32(seed: number) {
  //1.- Convert the incoming seed into an unsigned integer to align with the mulberry algorithm expectations.
  let t = seed >>> 0
  return () => {
    //2.- Advance the state with a constant increment and scramble the bits to produce uniform pseudo-random floats.
    t = (t + 0x6d2b79f5) >>> 0
    let r = Math.imul(t ^ (t >>> 15), t | 1)
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

export function generateBattlefield(seed = Date.now() & 0xffffffff, featureCount = 18): BattlefieldConfig {
  //1.- Prepare the deterministic random generator so identical seeds reproduce the same battlefield layout.
  const random = mulberry32(seed)
  //2.- Establish the spatial constraints for the arena including sandwich-style ceiling and floor planes.
  const fieldSize = 320
  const groundY = -20
  const ceilingY = 45
  const features: BattlefieldFeature[] = []

  for (let index = 0; index < featureCount; index += 1) {
    //3.- Produce crater-like features that distort the ground plane for variety in each generated map.
    const radius = 8 + random() * 20
    const depth = 2 + random() * 6
    const offsetX = (random() - 0.5) * (fieldSize - radius * 2)
    const offsetZ = (random() - 0.5) * (fieldSize - radius * 2)
    features.push({
      position: new THREE.Vector3(offsetX, groundY, offsetZ),
      radius,
      depth,
    })
  }

  const spawnPoint = new THREE.Vector3(
    //4.- Pick a random spawn location inside the arena so each player starts from a unique vantage point.
    (random() - 0.5) * (fieldSize * 0.5),
    groundY + 4,
    (random() - 0.5) * (fieldSize * 0.5),
  )

  return {
    //5.- Expose the configuration so the renderer and tests can reason about the generated battlefield.
    seed,
    fieldSize,
    groundY,
    ceilingY,
    features,
    spawnPoint,
  }
}

