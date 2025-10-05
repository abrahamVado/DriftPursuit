'use client'

import * as THREE from 'three'

export interface OfflineCavePreviewOptions {
  //1.- Canvas root hosting the preview renderer and related DOM elements.
  canvasRoot: HTMLElement
  //2.- Optional renderer factory so tests can inject a mock WebGL implementation.
  createRenderer?: (canvas: HTMLCanvasElement) => THREE.WebGLRenderer
}

const TUNNEL_SEGMENTS = 240
const CAVE_RADIUS = 28
const CAMERA_SPEED = 0.0008
const ROCK_DISPLACEMENT = 6.4
const STALACTITE_COUNT = 36
const CRYSTAL_COUNT = 28

function sampleNoise3D(x: number, y: number, z: number): number {
  //1.- Combine multiple trigonometric layers for a smooth pseudo-random field without external deps.
  const layerA = Math.sin(x * 0.21 + z * 0.17) + Math.cos(y * 0.31 + x * 0.11)
  const layerB = Math.sin((x + y + z) * 0.09 + Math.sin(z * 0.05))
  const layerC = Math.cos(x * 0.37 - y * 0.28 + z * 0.19)
  return (layerA * 0.45 + layerB * 0.35 + layerC * 0.2) * 0.9
}

function buildTunnelCurve(): THREE.CatmullRomCurve3 {
  //1.- Generate a looping spline with gentle sine offsets to mimic a twisting cavern.
  const points: THREE.Vector3[] = []
  for (let index = 0; index <= TUNNEL_SEGMENTS; index += 1) {
    const progress = index / TUNNEL_SEGMENTS
    const angle = progress * Math.PI * 6
    const x = Math.sin(angle * 0.7) * 18
    const y = Math.cos(angle * 0.5) * 14
    const z = progress * 360
    points.push(new THREE.Vector3(x, y, z))
  }
  return new THREE.CatmullRomCurve3(points, true)
}

function warpTunnelGeometry(geometry: THREE.TubeGeometry): void {
  //1.- Bend and shade the cave shell with layered trigonometric noise to carve natural formations.
  const positionAttribute = geometry.getAttribute('position') as THREE.BufferAttribute
  const vertexCount = positionAttribute.count
  const colors = new Float32Array(vertexCount * 3)
  const positionArray = positionAttribute.array as Float32Array

  for (let index = 0; index < vertexCount; index += 1) {
    const baseIndex = index * positionAttribute.itemSize
    const x = positionArray[baseIndex]
    const y = positionArray[baseIndex + 1]
    const z = positionArray[baseIndex + 2]
    const radius = Math.max(0.0001, Math.sqrt(x * x + y * y))
    const theta = Math.atan2(y, x)
    const longitudinalNoise = sampleNoise3D(Math.cos(theta) * 0.25, Math.sin(theta) * 0.25, z * 0.01)
    const radialNoise = sampleNoise3D(theta * 0.4, z * 0.01, 0.5)
    const ridgeNoise = sampleNoise3D(theta * 1.3, z * 0.035, 1.2)

    const displacedRadius = CAVE_RADIUS * (0.82 + radialNoise * 0.18) + longitudinalNoise * ROCK_DISPLACEMENT
    const scaledRadius = displacedRadius / radius

    positionArray[baseIndex] = x * scaledRadius
    positionArray[baseIndex + 1] = y * scaledRadius
    positionArray[baseIndex + 2] = z + ridgeNoise * 1.6

    const ambient = 0.32 + Math.max(0, radialNoise) * 0.12
    const highlight = 0.45 + Math.abs(longitudinalNoise) * 0.38
    colors[baseIndex] = 0.16 + ambient * 0.35
    colors[baseIndex + 1] = 0.21 + highlight * 0.47
    colors[baseIndex + 2] = 0.28 + highlight * 0.54
  }

  positionAttribute.needsUpdate = true
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.computeVertexNormals()
}

function createTunnelMesh(curve: THREE.CatmullRomCurve3): THREE.Mesh {
  //1.- Build a tube geometry around the generated spline for the cave shell.
  const geometry = new THREE.TubeGeometry(curve, 960, CAVE_RADIUS, 32, true)
  warpTunnelGeometry(geometry)

  const material = new THREE.MeshStandardMaterial({
    side: THREE.BackSide,
    vertexColors: true,
    color: new THREE.Color(0x0d1014),
    emissive: new THREE.Color(0x050a14),
    emissiveIntensity: 0.75,
    metalness: 0.08,
    roughness: 0.92,
  })
  return new THREE.Mesh(geometry, material)
}

function createEnergyTrail(): THREE.Points {
  //1.- Scatter light pulses down the tunnel to convey depth and movement.
  const geometry = new THREE.BufferGeometry()
  const particleCount = 640
  const positions = new Float32Array(particleCount * 3)
  const speeds = new Float32Array(particleCount)
  for (let index = 0; index < particleCount; index += 1) {
    const radius = CAVE_RADIUS * 0.86 + Math.random() * 6
    const theta = Math.random() * Math.PI * 2
    const offset = Math.random() * 360
    positions[index * 3] = Math.cos(theta) * radius
    positions[index * 3 + 1] = Math.sin(theta) * radius
    positions[index * 3 + 2] = offset
    speeds[index] = 0.3 + Math.random() * 0.9
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('speed', new THREE.BufferAttribute(speeds, 1))
  const material = new THREE.PointsMaterial({
    size: 1.25,
    transparent: true,
    opacity: 0.72,
    color: new THREE.Color(0x3ec7ff),
    blending: THREE.AdditiveBlending,
  })
  return new THREE.Points(geometry, material)
}

function createStalactiteMeshes(curve: THREE.CatmullRomCurve3, count: number): THREE.Mesh[] {
  //1.- Forge stalactites and stalagmites anchored against the distorted tunnel walls.
  const meshes: THREE.Mesh[] = []
  for (let index = 0; index < count; index += 1) {
    const progress = (index / count + Math.random() * 0.02) % 1
    const sourcePoint = curve.getPointAt(progress)
    const theta = Math.random() * Math.PI * 2
    const anchor = sourcePoint.clone()
    const horizontalRadius = CAVE_RADIUS * (0.6 + Math.random() * 0.35)
    anchor.x += Math.cos(theta) * horizontalRadius
    anchor.z += Math.sin(theta) * 6 * (Math.random() - 0.5)

    const isCeiling = index % 2 === 0
    const verticalOffset = CAVE_RADIUS * 0.82 + Math.random() * 3.2
    anchor.y += isCeiling ? verticalOffset : -verticalOffset

    const coneHeight = 3.5 + Math.random() * 6.5
    const coneRadius = 0.9 + Math.random() * 1.4
    const cone = new THREE.ConeGeometry(coneRadius, coneHeight, 6)
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0x1d2630),
      roughness: 0.96,
      metalness: 0.04,
      emissive: new THREE.Color(0x050607),
    })
    const mesh = new THREE.Mesh(cone, material)
    mesh.position.copy(anchor)
    mesh.rotation.y = theta
    mesh.rotation.z = Math.random() * 0.35 - 0.175
    if (isCeiling) {
      mesh.rotation.x = Math.PI - Math.random() * 0.3
    } else {
      mesh.rotation.x = Math.random() * 0.3
    }
    meshes.push(mesh)
  }
  return meshes
}

function createCrystalClusters(curve: THREE.CatmullRomCurve3, count: number): {
  group: THREE.Group
  materials: THREE.MeshStandardMaterial[]
} {
  //1.- Populate luminous crystal clusters to guide explorers through the caverns.
  const group = new THREE.Group()
  const materials: THREE.MeshStandardMaterial[] = []
  for (let index = 0; index < count; index += 1) {
    const progress = (index / count + Math.random() * 0.05) % 1
    const basePoint = curve.getPointAt(progress)
    const theta = Math.random() * Math.PI * 2
    const offsetRadius = CAVE_RADIUS * (0.45 + Math.random() * 0.3)
    const offset = new THREE.Vector3(
      Math.cos(theta) * offsetRadius,
      Math.sin(theta) * offsetRadius,
      Math.random() * 18 - 9
    )
    const sphere = new THREE.SphereGeometry(1.6 + Math.random() * 1.4, 16, 12)
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0x7dd3fc),
      emissive: new THREE.Color(0x38bdf8),
      emissiveIntensity: 1.2,
      transparent: true,
      opacity: 0.85,
      roughness: 0.35,
      metalness: 0.15,
    })
    const mesh = new THREE.Mesh(sphere, material)
    mesh.position.copy(basePoint.clone().add(offset))
    group.add(mesh)
    materials.push(material)
  }
  return { group, materials }
}

function createDustField(): THREE.Points {
  //1.- Swirl a secondary particle field closer to the camera for extra parallax cues.
  const geometry = new THREE.BufferGeometry()
  const particleCount = 220
  const positions = new Float32Array(particleCount * 3)
  for (let index = 0; index < particleCount; index += 1) {
    const radius = CAVE_RADIUS * 0.4 + Math.random() * 4
    const theta = Math.random() * Math.PI * 2
    const offset = Math.random() * 360
    positions[index * 3] = Math.cos(theta) * radius
    positions[index * 3 + 1] = Math.sin(theta) * radius
    positions[index * 3 + 2] = offset
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const material = new THREE.PointsMaterial({
    size: 0.75,
    transparent: true,
    opacity: 0.4,
    color: new THREE.Color(0xfacc15),
    blending: THREE.AdditiveBlending,
  })
  return new THREE.Points(geometry, material)
}

export function startOfflineCavePreview({ canvasRoot, createRenderer }: OfflineCavePreviewOptions): () => void {
  //1.- Remove any stale preview canvas before constructing the new renderer.
  canvasRoot.querySelectorAll('canvas[data-role="offline-cave-canvas"]').forEach((element) => {
    element.remove()
  })
  const doc = canvasRoot.ownerDocument ?? document
  const canvas = doc.createElement('canvas')
  canvas.dataset.role = 'offline-cave-canvas'
  canvasRoot.appendChild(canvas)

  //2.- Create the three.js renderer and configure scene lighting with atmospheric tones.
  const renderer = createRenderer ? createRenderer(canvas) : new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(window.devicePixelRatio || 1)
  renderer.setClearColor(new THREE.Color(0x030712))

  const scene = new THREE.Scene()
  scene.fog = new THREE.FogExp2(new THREE.Color(0x030712), 0.0032)

  const ambient = new THREE.AmbientLight(new THREE.Color(0x1f2a3c), 0.8)
  scene.add(ambient)

  const keyLight = new THREE.DirectionalLight(new THREE.Color(0x6db7ff), 1.2)
  keyLight.position.set(30, 25, 40)
  scene.add(keyLight)

  const fillLight = new THREE.DirectionalLight(new THREE.Color(0x102844), 0.6)
  fillLight.position.set(-20, -30, -40)
  scene.add(fillLight)

  //3.- Assemble the dynamic cave mesh and energy trail elements.
  const curve = buildTunnelCurve()
  const tunnelMesh = createTunnelMesh(curve)
  scene.add(tunnelMesh)

  const stalactites = createStalactiteMeshes(curve, STALACTITE_COUNT)
  stalactites.forEach((mesh) => scene.add(mesh))

  const particles = createEnergyTrail()
  scene.add(particles)

  const dustField = createDustField()
  scene.add(dustField)

  const crystals = createCrystalClusters(curve, CRYSTAL_COUNT)
  scene.add(crystals.group)

  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000)

  const resizeRenderer = () => {
    //4.- Maintain responsive sizing so the preview fills the full viewport layout.
    const width = canvasRoot.clientWidth || window.innerWidth || 1
    const height = canvasRoot.clientHeight || window.innerHeight || 1
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
  }

  resizeRenderer()
  window.addEventListener('resize', resizeRenderer)

  let frameHandle = 0
  let progress = 0

  const animate = () => {
    //5.- Move the camera through the spline while updating particle offsets for parallax.
    progress = (progress + CAMERA_SPEED) % 1
    const point = curve.getPointAt(progress)
    const lookTarget = curve.getPointAt((progress + 0.002) % 1)
    camera.position.copy(point)
    camera.lookAt(lookTarget)

    const trailPositions = particles.geometry.getAttribute('position') as THREE.BufferAttribute
    const trailSpeed = particles.geometry.getAttribute('speed') as THREE.BufferAttribute
    for (let index = 0; index < trailPositions.count; index += 1) {
      const currentZ = trailPositions.getZ(index)
      const delta = (trailSpeed.getX?.(index) ?? trailSpeed.array[index]) * 0.9
      const newZ = (currentZ + delta) % 360
      trailPositions.setZ(index, newZ)
    }
    trailPositions.needsUpdate = true

    const dustPositions = dustField.geometry.getAttribute('position') as THREE.BufferAttribute
    for (let index = 0; index < dustPositions.count; index += 1) {
      const currentZ = dustPositions.getZ(index)
      const newZ = (currentZ + 0.25) % 360
      dustPositions.setZ(index, newZ)
    }
    dustPositions.needsUpdate = true

    crystals.materials.forEach((material, index) => {
      material.emissiveIntensity = 0.9 + Math.sin(progress * 1200 + index) * 0.45
      material.opacity = 0.72 + Math.cos(progress * 900 + index) * 0.08
    })

    renderer.render(scene, camera)
    frameHandle = window.requestAnimationFrame(animate)
  }

  frameHandle = window.requestAnimationFrame(animate)

  return () => {
    //6.- Release animation resources, dispose three.js assets, and detach the canvas.
    window.cancelAnimationFrame(frameHandle)
    window.removeEventListener('resize', resizeRenderer)
    tunnelMesh.geometry.dispose()
    ;(tunnelMesh.material as THREE.Material).dispose()
    stalactites.forEach((mesh) => {
      mesh.geometry.dispose()
      ;(mesh.material as THREE.Material).dispose()
    })
    particles.geometry.dispose()
    ;(particles.material as THREE.Material).dispose()
    dustField.geometry.dispose()
    ;(dustField.material as THREE.Material).dispose()
    crystals.group.children.forEach((child) => {
      const mesh = child as THREE.Mesh
      mesh.geometry.dispose()
      ;(mesh.material as THREE.Material).dispose()
    })
    renderer.dispose()
    canvas.remove()
  }
}

export const __testing = {
  buildTunnelCurve,
  createTunnelMesh,
  warpTunnelGeometry,
  createStalactiteMeshes,
  createCrystalClusters,
  createDustField,
}
