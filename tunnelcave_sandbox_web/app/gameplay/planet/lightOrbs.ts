import * as THREE from 'three'

interface MulberryRandom {
  (): number
}

function mulberry32(seed: number): MulberryRandom {
  //1.- Recreate the deterministic RNG from other systems so orb placement is reproducible across clients.
  let t = seed >>> 0
  return () => {
    t = (t + 0x6d2b79f5) >>> 0
    let r = Math.imul(t ^ (t >>> 15), t | 1)
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

export interface OrbSpecification {
  position: THREE.Vector3
  radius: number
  intensity: number
  color: THREE.Color
}

export interface OrbGeneratorOptions {
  seed: number
  fieldSize: number
  altitudeRange: { min: number; max: number }
  radiusRange: { min: number; max: number }
  count: number
}

function hslToColor(h: number, s: number, l: number): THREE.Color {
  //1.- Convert HSL to RGB manually so the generator works in headless test environments lacking setHSL helpers.
  const hue = ((h % 1) + 1) % 1
  if (s === 0) {
    return new THREE.Color(l, l, l)
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const hueComponent = (t: number) => {
    let channel = t
    if (channel < 0) {
      channel += 1
    }
    if (channel > 1) {
      channel -= 1
    }
    if (channel < 1 / 6) {
      return p + (q - p) * 6 * channel
    }
    if (channel < 1 / 2) {
      return q
    }
    if (channel < 2 / 3) {
      return p + (q - p) * (2 / 3 - channel) * 6
    }
    return p
  }
  return new THREE.Color(hueComponent(hue + 1 / 3), hueComponent(hue), hueComponent(hue - 1 / 3))
}

export function generateOrbSpecifications(options: OrbGeneratorOptions): OrbSpecification[] {
  //2.- Generate soft illumination anchors distributed around the battlefield to support visibility while flying.
  const random = mulberry32(options.seed)
  const half = options.fieldSize / 2
  const specs: OrbSpecification[] = []
  for (let index = 0; index < options.count; index += 1) {
    const angle = random() * Math.PI * 2
    const distance = (0.35 + random() * 0.6) * half
    const x = Math.cos(angle) * distance
    const z = Math.sin(angle) * distance
    const altitude = options.altitudeRange.min +
      random() * Math.max(0, options.altitudeRange.max - options.altitudeRange.min)
    const radius = options.radiusRange.min +
      random() * Math.max(0, options.radiusRange.max - options.radiusRange.min)
    const color = hslToColor(0.55 + random() * 0.15, 0.6, 0.6 + random() * 0.2)
    const intensity = 2.6 + random() * 1.8
    specs.push({ position: new THREE.Vector3(x, altitude, z), radius, intensity, color })
  }
  return specs
}

export interface OrbField {
  group: THREE.Group
  dispose: () => void
}

export function createOrbField(specs: OrbSpecification[]): OrbField {
  //3.- Convert the orb specifications into point lights with emissive meshes so the scene inherits ambient glow.
  const group = new THREE.Group()
  const sphereGeometry = new THREE.SphereGeometry(1, 12, 12)
  specs.forEach((spec) => {
    const light = new THREE.PointLight(spec.color, spec.intensity, spec.radius * 20, 2)
    light.position.copy(spec.position)
    const material = new THREE.MeshBasicMaterial({ color: spec.color, transparent: true, opacity: 0.8 })
    const orb = new THREE.Mesh(sphereGeometry, material)
    orb.scale.setScalar(spec.radius)
    orb.position.copy(spec.position)
    group.add(light)
    group.add(orb)
  })
  return {
    group,
    dispose: () => {
      //4.- Dispose the shared geometry and all dynamically created materials once the orb field is removed.
      const materials = new Set<THREE.Material>()
      group.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          materials.add(child.material as THREE.Material)
        }
      })
      materials.forEach((material) => material.dispose())
      sphereGeometry.dispose()
    },
  }
}

