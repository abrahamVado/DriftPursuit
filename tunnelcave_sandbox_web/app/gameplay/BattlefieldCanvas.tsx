'use client'

import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

import type { BattlefieldConfig } from './generateBattlefield'
import { createChaseCamera } from './chaseCamera'
import { createVehicleController } from './vehicleController'

interface BattlefieldCanvasProps {
  config: BattlefieldConfig
  playerName: string
  vehicleId: string
  sessionId: string
}

export default function BattlefieldCanvas({ config, playerName, vehicleId, sessionId }: BattlefieldCanvasProps) {
  //1.- Allocate a container ref so the WebGL renderer can mount a canvas once the component hydrates.
  const mountRef = useRef<HTMLDivElement | null>(null)
  //2.- Cache the welcome banner so the overlay remains stable between renders.
  const welcomeMessage = useMemo(() => `${playerName || 'Rookie'} piloting ${vehicleId}`, [playerName, vehicleId])

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) {
      return
    }

    //3.- Create the renderer and attach its canvas to the mount element.
    const canvas = document.createElement('canvas')
    canvas.dataset.testid = 'battlefield-canvas-surface'
    mount.appendChild(canvas)
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    renderer.setPixelRatio(window.devicePixelRatio || 1)
    renderer.setSize(mount.clientWidth || window.innerWidth, mount.clientHeight || window.innerHeight)

    //4.- Assemble the scene graph including sandwich planes, lighting, and a procedural sky gradient.
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x080d1a)

    const ambientLight = new THREE.AmbientLight(0xb0c4de, 0.6)
    const sunLight = new THREE.DirectionalLight(0xfff2cc, 0.9)
    sunLight.position.set(120, 180, 80)
    scene.add(ambientLight)
    scene.add(sunLight)

    const camera = new THREE.PerspectiveCamera(60, (mount.clientWidth || window.innerWidth) / (mount.clientHeight || window.innerHeight), 0.1, 1000)
    camera.position.set(config.spawnPoint.x, config.spawnPoint.y + 18, config.spawnPoint.z + 32)
    camera.lookAt(config.spawnPoint)

    const groundGeometry = new THREE.PlaneGeometry(config.fieldSize, config.fieldSize, 64, 64)
    groundGeometry.rotateX(-Math.PI / 2)
    const groundVertices = groundGeometry.attributes.position as THREE.BufferAttribute
    for (let index = 0; index < groundVertices.count; index += 1) {
      //5.- Apply crater offsets from the procedural features so the battlefield gains readable silhouettes.
      const vx = groundVertices.getX(index)
      const vz = groundVertices.getZ(index)
      let offset = 0
      for (const feature of config.features) {
        const distance = Math.hypot(vx - feature.position.x, vz - feature.position.z)
        if (distance < feature.radius) {
          offset -= ((feature.radius - distance) / feature.radius) * feature.depth
        }
      }
      groundVertices.setY(index, config.groundY + offset)
    }
    groundVertices.needsUpdate = true
    const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x2e4f30, roughness: 0.8, metalness: 0.1 })
    const groundMesh = new THREE.Mesh(groundGeometry, groundMaterial)
    scene.add(groundMesh)

    const ceilingGeometry = groundGeometry.clone()
    const ceilingVertices = ceilingGeometry.attributes.position as THREE.BufferAttribute
    for (let index = 0; index < ceilingVertices.count; index += 1) {
      const originalY = ceilingVertices.getY(index)
      ceilingVertices.setY(index, config.ceilingY - (originalY - config.groundY))
    }
    const ceilingMaterial = new THREE.MeshStandardMaterial({ color: 0x1b1b2f, side: THREE.BackSide, roughness: 0.3, metalness: 0 })
    const ceilingMesh = new THREE.Mesh(ceilingGeometry, ceilingMaterial)
    ceilingMesh.rotateY(Math.PI)
    scene.add(ceilingMesh)

    const vehicleBody = new THREE.Group()
    const hull = new THREE.Mesh(new THREE.ConeGeometry(2, 6, 12), new THREE.MeshStandardMaterial({ color: 0xff7043, metalness: 0.6, roughness: 0.4 }))
    hull.rotation.x = Math.PI / 2
    vehicleBody.add(hull)
    const thruster = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 1.5, 2, 8), new THREE.MeshStandardMaterial({ color: 0x263238 }))
    thruster.position.set(0, 0, 2)
    thruster.rotation.x = Math.PI / 2
    vehicleBody.add(thruster)
    vehicleBody.position.copy(config.spawnPoint)
    scene.add(vehicleBody)

    //6.- Configure the vehicle controller with tunable thrust, braking, and bounds tailored to the battlefield layout.
    const controller = createVehicleController({
      bounds: config.fieldSize / 2 - 4,
      groundY: config.groundY,
      ceilingY: config.ceilingY,
      baseAcceleration: 48,
      brakeDeceleration: 220,
      dragFactor: 0.92,
      maxForwardSpeed: 150,
      maxReverseSpeed: 28,
      boostSpeedMultiplier: 1.4,
      boostAccelerationMultiplier: 1.2,
    })

    //7.- Compose the chase camera rig so the framing adapts with vehicle speed and maintains an unobstructed overview.
    const chaseRig = createChaseCamera({
      baseDistance: 24,
      distanceGain: 16,
      baseHeight: 11,
      heightGain: 6,
      lookAheadDistance: 9,
      smoothingStrength: 7,
      referenceSpeed: 150,
      baseFov: 60,
      maxFov: 74,
    })

    let animationFrame = 0
    let previousTime = performance.now()

    const animate = () => {
      animationFrame = requestAnimationFrame(animate)
      const now = performance.now()
      const delta = Math.min(0.1, (now - previousTime) / 1000)
      previousTime = now
      controller.step(delta, vehicleBody)
      chaseRig.update(camera, vehicleBody, controller.getSpeed(), delta)
      renderer.render(scene, camera)
    }

    animate()

    const handleResize = () => {
      const width = mount.clientWidth || window.innerWidth
      const height = mount.clientHeight || window.innerHeight
      renderer.setSize(width, height)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    }

    window.addEventListener('resize', handleResize)

    return () => {
      cancelAnimationFrame(animationFrame)
      controller.dispose()
      window.removeEventListener('resize', handleResize)
      renderer.dispose()
      groundGeometry.dispose()
      groundMaterial.dispose()
      ceilingGeometry.dispose()
      ceilingMaterial.dispose()
      ;(hull.geometry as THREE.BufferGeometry).dispose()
      ;(hull.material as THREE.Material).dispose()
      ;(thruster.geometry as THREE.BufferGeometry).dispose()
      ;(thruster.material as THREE.Material).dispose()
      mount.removeChild(canvas)
    }
  }, [config, playerName, sessionId, vehicleId])

  return (
    <div className="battlefield-wrapper" data-testid="battlefield-wrapper" ref={mountRef}>
      <div className="hud-overlay" data-testid="battlefield-hud">
        <p className="hud-session">Session: {sessionId}</p>
        <p className="hud-welcome">{welcomeMessage}</p>
        <p className="hud-tip">Use W/A/S/D or the arrow keys to steer and manage throttle.</p>
      </div>
    </div>
  )
}

