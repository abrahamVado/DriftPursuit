'use client'

import * as THREE from 'three'

export interface OfflineCavePreviewOptions {
  //1.- Canvas root hosting the preview renderer and related DOM elements.
  canvasRoot: HTMLElement
}

const TUNNEL_SEGMENTS = 180
const CAVE_RADIUS = 26
const CAMERA_SPEED = 0.0008

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

function createTunnelMesh(curve: THREE.CatmullRomCurve3): THREE.Mesh {
  //1.- Build a tube geometry around the generated spline for the cave shell.
  const geometry = new THREE.TubeGeometry(curve, 720, CAVE_RADIUS, 24, true)
  const material = new THREE.MeshStandardMaterial({
    side: THREE.BackSide,
    color: new THREE.Color(0x0a1425),
    emissive: new THREE.Color(0x050a14),
    metalness: 0.05,
    roughness: 0.9,
  })
  return new THREE.Mesh(geometry, material)
}

function createEnergyTrail(): THREE.Points {
  //1.- Scatter light pulses down the tunnel to convey depth and movement.
  const geometry = new THREE.BufferGeometry()
  const particleCount = 500
  const positions = new Float32Array(particleCount * 3)
  for (let index = 0; index < particleCount; index += 1) {
    const radius = CAVE_RADIUS * 0.9
    const theta = Math.random() * Math.PI * 2
    const offset = Math.random() * 360
    positions[index * 3] = Math.cos(theta) * radius
    positions[index * 3 + 1] = Math.sin(theta) * radius
    positions[index * 3 + 2] = offset
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const material = new THREE.PointsMaterial({
    size: 1.2,
    transparent: true,
    opacity: 0.7,
    color: new THREE.Color(0x3ec7ff),
    blending: THREE.AdditiveBlending,
  })
  return new THREE.Points(geometry, material)
}

export function startOfflineCavePreview({ canvasRoot }: OfflineCavePreviewOptions): () => void {
  //1.- Remove any stale preview canvas before constructing the new renderer.
  canvasRoot.querySelectorAll('canvas[data-role="offline-cave-canvas"]').forEach((element) => {
    element.remove()
  })
  const doc = canvasRoot.ownerDocument ?? document
  const canvas = doc.createElement('canvas')
  canvas.dataset.role = 'offline-cave-canvas'
  canvasRoot.appendChild(canvas)

  //2.- Create the three.js renderer and configure scene lighting with atmospheric tones.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
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

  const particles = createEnergyTrail()
  scene.add(particles)

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

    const positions = particles.geometry.getAttribute('position') as THREE.BufferAttribute
    for (let index = 0; index < positions.count; index += 1) {
      const currentZ = positions.getZ(index)
      const newZ = (currentZ + 0.6) % 360
      positions.setZ(index, newZ)
    }
    positions.needsUpdate = true

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
    particles.geometry.dispose()
    ;(particles.material as THREE.Material).dispose()
    renderer.dispose()
    canvas.remove()
  }
}
