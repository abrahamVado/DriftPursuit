import * as THREE from 'three'

import { VEHICLE_IDS, VEHICLE_LABELS, type VehicleId } from '../../vehicles'

export interface VehicleModelDefinition {
  id: VehicleId
  label: string
  buildModel: () => THREE.Group
}

const primaryPalette: Record<VehicleId, number> = {
  arrowhead: 0xff7f50,
  aurora: 0x87cefa,
  duskfall: 0xcd5c5c,
  steelwing: 0xc0c0c0,
}

const canopyPalette: Record<VehicleId, number> = {
  arrowhead: 0x1c1c1c,
  aurora: 0x0f1c3f,
  duskfall: 0x1a0d0d,
  steelwing: 0x111111,
}

const thrusterPalette: Record<VehicleId, number> = {
  arrowhead: 0xffd700,
  aurora: 0x00ffff,
  duskfall: 0xff4500,
  steelwing: 0xb0e0e6,
}

const hullGeometryFactories: Record<VehicleId, () => THREE.BufferGeometry> = {
  arrowhead: () => new THREE.ConeGeometry(1.2, 3.2, 6),
  aurora: () => new THREE.CylinderGeometry(0.8, 1.5, 3.8, 12),
  duskfall: () => new THREE.BoxGeometry(2.6, 0.8, 1.2),
  steelwing: () => new THREE.CapsuleGeometry(1.1, 2.8, 6, 12),
}

const createHull = (vehicleId: VehicleId) => {
  //1.- Author the core fuselage mesh so every craft receives a distinct silhouette.
  const geometry = hullGeometryFactories[vehicleId]()
  const material = new THREE.MeshStandardMaterial({ color: primaryPalette[vehicleId], flatShading: true })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.castShadow = true
  return mesh
}

const createCanopy = (vehicleId: VehicleId) => {
  //1.- Top the fuselage with a canopy to give depth and emphasise cockpit placement.
  const canopyGeometry = new THREE.SphereGeometry(0.7, 16, 16)
  const canopyMaterial = new THREE.MeshStandardMaterial({
    color: canopyPalette[vehicleId],
    metalness: 0.4,
    roughness: 0.25,
  })
  const canopy = new THREE.Mesh(canopyGeometry, canopyMaterial)
  canopy.position.set(0, 0.4, 0)
  canopy.castShadow = true
  return canopy
}

const createThruster = (vehicleId: VehicleId) => {
  //1.- Attach a thruster glow mesh to hint at propulsion systems.
  const thrusterGeometry = new THREE.ConeGeometry(0.4, 0.9, 12)
  const thrusterMaterial = new THREE.MeshStandardMaterial({
    color: thrusterPalette[vehicleId],
    emissive: thrusterPalette[vehicleId],
    emissiveIntensity: 0.6,
  })
  const thruster = new THREE.Mesh(thrusterGeometry, thrusterMaterial)
  thruster.rotation.x = Math.PI
  thruster.position.set(0, -1.4, 0)
  return thruster
}

const createWingPair = (vehicleId: VehicleId) => {
  //1.- Mirror a low poly wing for additional visual interest.
  const wingGeometry = new THREE.BoxGeometry(2.4, 0.2, 0.6)
  const wingMaterial = new THREE.MeshStandardMaterial({
    color: primaryPalette[vehicleId],
    roughness: 0.6,
  })
  const leftWing = new THREE.Mesh(wingGeometry, wingMaterial)
  leftWing.position.set(-1.8, -0.2, 0)
  const rightWing = leftWing.clone()
  rightWing.position.x *= -1
  const wingGroup = new THREE.Group()
  wingGroup.add(leftWing)
  wingGroup.add(rightWing)
  return wingGroup
}

const augmentors: Partial<Record<VehicleId, (group: THREE.Group) => void>> = {
  aurora: (group) => {
    //1.- Add a vertical stabiliser for the glider-inspired craft silhouette.
    const stabiliser = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 1.4, 0.8),
      new THREE.MeshStandardMaterial({ color: primaryPalette.aurora })
    )
    stabiliser.position.set(0, 0.5, -0.6)
    group.add(stabiliser)
  },
  duskfall: (group) => {
    //1.- Introduce forward prongs to emphasise the raider profile.
    const prongMaterial = new THREE.MeshStandardMaterial({ color: primaryPalette.duskfall })
    const leftProng = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.2, 12), prongMaterial)
    leftProng.rotation.z = Math.PI / 2
    leftProng.position.set(-0.8, 0.1, 1)
    const rightProng = leftProng.clone()
    rightProng.position.x *= -1
    group.add(leftProng)
    group.add(rightProng)
  },
  steelwing: (group) => {
    //1.- Mount defensive plates to underline the heavy escort design.
    const plateMaterial = new THREE.MeshStandardMaterial({ color: 0x708090 })
    const leftPlate = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.2, 2.4), plateMaterial)
    leftPlate.position.set(-1.4, -0.1, 0)
    const rightPlate = leftPlate.clone()
    rightPlate.position.x *= -1
    group.add(leftPlate)
    group.add(rightPlate)
  },
}

export const vehicleModelDefinitions: Record<VehicleId, VehicleModelDefinition> = VEHICLE_IDS.reduce((registry, id) => {
  //1.- Create a factory entry per craft so callers can instantiate the meshes on demand.
  registry[id] = {
    id,
    label: VEHICLE_LABELS[id],
    buildModel: () => {
      const group = new THREE.Group()
      const hull = createHull(id)
      const canopy = createCanopy(id)
      const thruster = createThruster(id)
      const wings = createWingPair(id)
      group.add(hull)
      group.add(canopy)
      group.add(thruster)
      group.add(wings)
      const augment = augmentors[id]
      if (augment) {
        augment(group)
      }
      group.rotation.x = -Math.PI / 2.8
      group.rotation.z = Math.PI / 16
      return group
    },
  }
  return registry
}, {} as Record<VehicleId, VehicleModelDefinition>)

export const listVehicleModelDefinitions = (): VehicleModelDefinition[] => {
  //1.- Surface the registry as an ordered array that mirrors the core vehicle listing.
  return VEHICLE_IDS.map((id) => vehicleModelDefinitions[id])
}

export const createVehicleModel = (vehicleId: VehicleId) => {
  //1.- Produce a dedicated mesh group for the requested craft so preview canvases stay pure.
  return vehicleModelDefinitions[vehicleId].buildModel()
}
