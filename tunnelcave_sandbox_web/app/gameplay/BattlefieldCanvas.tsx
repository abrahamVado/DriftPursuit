'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'

import type { BattlefieldConfig } from './generateBattlefield'
import { createChaseCamera } from './chaseCamera'
import { createVehicleController } from './vehicleController'
import { MiniMapOverlay, type MiniMapEntitySnapshot } from './miniMapOverlay'
import { createNameplateSprite, type NameplateSprite } from './nameplate'
import { wrapToInterval, wrappedDelta } from './worldWrapping'
import { createWorldLobby, SHARED_WORLD_ID, type WorldPeerSnapshot } from './worldLobby'
import { createPlanetShell } from './planet/createPlanetShell'
import { createOrbField, generateOrbSpecifications } from './planet/lightOrbs'

interface PeerState {
  //1.- Unique identifier matching the remote session.
  id: string
  //2.- Callsign used for overlays and nameplates.
  name: string
  //3.- Vehicle identifier so future cosmetics can tint the craft.
  vehicleId: string
  //4.- Latest reported position and velocity samples from the network.
  position: THREE.Vector3
  velocity: THREE.Vector3
  //5.- Render resources representing the escort craft and nameplate.
  craft: THREE.Group
  nameplate: NameplateSprite
  dispose: () => void
}

function createEscortCraft(label: string): { craft: THREE.Group; nameplate: NameplateSprite; dispose: () => void } {
  //1.- Construct a compact escort craft composed of a hull, thruster, and floating nameplate.
  const craft = new THREE.Group()
  const hullGeometry = new THREE.ConeGeometry(1.8, 5.5, 10)
  const hullMaterial = new THREE.MeshStandardMaterial({ color: 0x6c7bff, metalness: 0.55, roughness: 0.42 })
  const hull = new THREE.Mesh(hullGeometry, hullMaterial)
  hull.rotation.x = Math.PI / 2
  const thrusterGeometry = new THREE.CylinderGeometry(0.45, 1.2, 1.6, 8)
  const thrusterMaterial = new THREE.MeshStandardMaterial({ color: 0x1d242f })
  const thruster = new THREE.Mesh(thrusterGeometry, thrusterMaterial)
  thruster.position.set(0, 0, 1.6)
  thruster.rotation.x = Math.PI / 2
  craft.add(hull)
  craft.add(thruster)
  const nameplate = createNameplateSprite(label)
  nameplate.sprite.position.set(0, 3.6, 0)
  craft.add(nameplate.sprite)
  return {
    craft,
    nameplate,
    dispose: () => {
      hullGeometry.dispose()
      hullMaterial.dispose()
      thrusterGeometry.dispose()
      thrusterMaterial.dispose()
      nameplate.dispose()
    },
  }
}

export default function BattlefieldCanvas({ config, playerName, vehicleId, sessionId }: {
  config: BattlefieldConfig
  playerName: string
  vehicleId: string
  sessionId: string
}) {
  //4.- Allocate a container ref so the WebGL renderer can mount a canvas once the component hydrates.
  const mountRef = useRef<HTMLDivElement | null>(null)
  //5.- Cache the welcome banner so the overlay remains stable between renders.
  const welcomeMessage = useMemo(() => `${playerName || 'Rookie'} piloting ${vehicleId}`, [playerName, vehicleId])
  const peersRef = useRef<PeerState[]>([])
  const [miniMapSnapshot, setMiniMapSnapshot] = useState<{ player: { x: number; z: number }; peers: MiniMapEntitySnapshot[] }>(
    () => ({
      player: { x: config.spawnPoint.x, z: config.spawnPoint.z },
      peers: [],
    }),
  )

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) {
      return
    }

    //6.- Create the renderer and attach its canvas to the mount element.
    const canvas = document.createElement('canvas')
    canvas.dataset.testid = 'battlefield-canvas-surface'
    mount.appendChild(canvas)
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    renderer.setPixelRatio(window.devicePixelRatio || 1)
    renderer.setSize(mount.clientWidth || window.innerWidth, mount.clientHeight || window.innerHeight)

    //7.- Assemble the scene graph including terrain, lighting, instanced foliage, and atmospheric touches.
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x070b16)

    const ambientLight = new THREE.AmbientLight(0xb0c4de, 0.65)
    const sunLight = new THREE.DirectionalLight(0xfff2cc, 1)
    sunLight.position.set(160, 220, 110)
    scene.add(ambientLight)
    scene.add(sunLight)

    const planetShell = createPlanetShell({
      radius: config.environment.boundsRadius * 1.22,
      color: 0x0b1d3b,
      emissive: 0x112b58,
      opacity: 0.88,
    })
    //1.- Mount the glowing interior planet so the battlefield reads as a cohesive planetary cavern.
    scene.add(planetShell.mesh)

    const orbSpecs = generateOrbSpecifications({
      seed: config.seed,
      fieldSize: config.fieldSize,
      altitudeRange: { min: 8, max: 28 },
      radiusRange: { min: 1.4, max: 3.6 },
      count: 10,
    })
    const orbField = createOrbField(orbSpecs)
    //2.- Scatter supportive light orbs to improve visibility across the terrain expanse.
    scene.add(orbField.group)

    const camera = new THREE.PerspectiveCamera(60, (mount.clientWidth || window.innerWidth) / (mount.clientHeight || window.innerHeight), 0.1, 1200)
    camera.position.set(config.spawnPoint.x, config.spawnPoint.y + 22, config.spawnPoint.z + 34)
    camera.lookAt(config.spawnPoint)

    const vehicleBody = new THREE.Group()
    const hull = new THREE.Mesh(new THREE.ConeGeometry(2, 6, 12), new THREE.MeshStandardMaterial({ color: 0xff7043, metalness: 0.6, roughness: 0.4 }))
    hull.rotation.x = Math.PI / 2
    const thruster = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 1.5, 2, 8), new THREE.MeshStandardMaterial({ color: 0x263238 }))
    thruster.position.set(0, 0, 2)
    thruster.rotation.x = Math.PI / 2
    vehicleBody.add(hull)
    vehicleBody.add(thruster)
    const playerNameplate = createNameplateSprite(playerName || 'Rookie')
    playerNameplate.sprite.position.set(0, 4.4, 0)
    vehicleBody.add(playerNameplate.sprite)
    vehicleBody.position.copy(config.spawnPoint)
    scene.add(vehicleBody)

    //8.- Configure the vehicle controller with tunable thrust, braking, and collision handlers tailored to the battlefield layout.
    const terrainSampler = config.terrain.sampler
    const wrapSize = config.environment.wrapSize
    const controller = createVehicleController({
      bounds: config.environment.boundsRadius,
      baseAcceleration: 48,
      brakeDeceleration: 220,
      dragFactor: 0.92,
      maxForwardSpeed: 160,
      maxReverseSpeed: 28,
      boostSpeedMultiplier: 1.65,
      boostAccelerationMultiplier: 1.45,
      verticalAcceleration: 24,
      gravity: 18,
      verticalDrag: 2.4,
      maxVerticalSpeed: 42,
      ascendBoostMultiplier: 1.45,
      environment: {
        sampleGround: (x, z) => terrainSampler.sampleGround(x, z),
        sampleCeiling: (x, z) => terrainSampler.sampleCeiling(x, z),
        sampleWater: (x, z) => terrainSampler.sampleWater(x, z),
        vehicleRadius: config.environment.vehicleRadius,
        slopeLimitRadians: config.environment.slopeLimitRadians,
        bounceDamping: config.environment.bounceDamping,
        groundSnapStrength: 0,
        boundsRadius: config.environment.boundsRadius,
        waterDrag: config.environment.waterDrag,
        waterBuoyancy: config.environment.waterBuoyancy,
        waterMinDepth: config.environment.waterMinDepth,
        maxWaterSpeedScale: config.environment.maxWaterSpeedScale,
        wrapSize,
        allowTerrainPenetration: true,
      },
    })

    //9.- Compose the chase camera rig so the framing adapts with vehicle speed and altitude.
    const chaseRig = createChaseCamera({
      baseDistance: 24,
      distanceGain: 18,
      baseHeight: 12,
      heightGain: 7,
      lookAheadDistance: 11,
      smoothingStrength: 7,
      referenceSpeed: 150,
      baseFov: 60,
      maxFov: 78,
      minHeightOffset: 4,
    })

    let animationFrame = 0
    let previousTime = performance.now()
    let miniMapTimer = 0
    let disposed = false

    const remotePeers = new Map<string, PeerState>()
    peersRef.current = []

    const publishMiniMap = () => {
      if (disposed) {
        return
      }
      setMiniMapSnapshot({
        player: {
          x: wrapToInterval(vehicleBody.position.x, wrapSize),
          z: wrapToInterval(vehicleBody.position.z, wrapSize),
        },
        peers: peersRef.current.map((peer) => ({
          id: peer.id,
          label: peer.name || 'Wingmate',
          x: wrapToInterval(peer.position.x, wrapSize),
          z: wrapToInterval(peer.position.z, wrapSize),
        })),
      })
    }

    const lobby = createWorldLobby(
      {
        worldId: SHARED_WORLD_ID,
        sessionId,
        name: playerName || 'Rookie',
        vehicleId,
        spawn: { x: config.spawnPoint.x, y: config.spawnPoint.y, z: config.spawnPoint.z },
      },
      { now: () => performance.now() },
    )

    const reconcilePeers = (snapshots: WorldPeerSnapshot[]) => {
      //1.- Reconcile the remote roster with the latest lobby snapshot to spawn, update, or despawn escorts.
      const seen = new Set<string>()
      snapshots.forEach((snapshot) => {
        if (snapshot.sessionId === sessionId) {
          return
        }
        seen.add(snapshot.sessionId)
        const label = snapshot.name.trim() || `Wing ${snapshot.sessionId.slice(-4)}`
        const clampRadius = config.environment.boundsRadius
        let px = wrapToInterval(snapshot.position.x, wrapSize)
        let py = snapshot.position.y
        let pz = wrapToInterval(snapshot.position.z, wrapSize)
        const planarDistance = Math.hypot(px, pz)
        if (planarDistance > clampRadius) {
          const scale = clampRadius / planarDistance
          px *= scale
          pz *= scale
        }
        let peer = remotePeers.get(snapshot.sessionId)
        if (!peer) {
          const { craft, nameplate, dispose } = createEscortCraft(label)
          craft.position.set(px, py, pz)
          scene.add(craft)
          peer = {
            id: snapshot.sessionId,
            name: snapshot.name,
            vehicleId: snapshot.vehicleId,
            position: new THREE.Vector3(px, py, pz),
            velocity: new THREE.Vector3(snapshot.velocity.x, snapshot.velocity.y, snapshot.velocity.z),
            craft,
            nameplate,
            dispose: () => {
              scene.remove(craft)
              dispose()
            },
          }
          remotePeers.set(snapshot.sessionId, peer)
        } else {
          peer.name = snapshot.name
          peer.vehicleId = snapshot.vehicleId
          peer.position.set(px, py, pz)
          peer.velocity.set(snapshot.velocity.x, snapshot.velocity.y, snapshot.velocity.z)
        }
      })
      remotePeers.forEach((peer, id) => {
        if (!seen.has(id)) {
          peer.dispose()
          remotePeers.delete(id)
        }
      })
      peersRef.current = Array.from(remotePeers.values())
      publishMiniMap()
    }

    const unsubscribeLobby = lobby.subscribe(reconcilePeers)

    lobby.updatePresence({
      position: { x: vehicleBody.position.x, y: vehicleBody.position.y, z: vehicleBody.position.z },
      velocity: { x: 0, y: 0, z: 0 },
    })

    publishMiniMap()

    const peerAlignment = new THREE.Vector3()
    const peerLookTarget = new THREE.Vector3()
    const lastPosition = new THREE.Vector3().copy(vehicleBody.position)

    //11.- Advance the simulation with a clamped delta time before rendering the latest frame.
    const animate = () => {
      animationFrame = requestAnimationFrame(animate)
      const now = performance.now()
      const delta = Math.min(0.1, (now - previousTime) / 1000)
      previousTime = now
      controller.step(delta, vehicleBody)
      chaseRig.update(camera, vehicleBody, controller.getSpeed(), delta)
      //1.- Broadcast the latest transform so other pilots can render this craft in real time.
      const invDelta = delta > 0 ? 1 / delta : 0
      const velocityX = wrappedDelta(vehicleBody.position.x, lastPosition.x, wrapSize) * invDelta
      const velocityY = (vehicleBody.position.y - lastPosition.y) * invDelta
      const velocityZ = wrappedDelta(vehicleBody.position.z, lastPosition.z, wrapSize) * invDelta
      lobby.updatePresence({
        position: {
          x: wrapToInterval(vehicleBody.position.x, wrapSize),
          y: vehicleBody.position.y,
          z: wrapToInterval(vehicleBody.position.z, wrapSize),
        },
        velocity: { x: velocityX, y: velocityY, z: velocityZ },
      })
      lastPosition.copy(vehicleBody.position)
      //2.- Smoothly interpolate remote craft positions and align them with their reported velocity vectors.
      peersRef.current.forEach((peer) => {
        peer.craft.position.lerp(peer.position, Math.min(1, delta * 6))
        peerAlignment.set(peer.velocity.x, peer.velocity.y, peer.velocity.z)
        if (peerAlignment.lengthSq() > 0.01) {
          peerAlignment.normalize()
          peerLookTarget.copy(peer.craft.position).addScaledVector(peerAlignment, 6)
          peer.craft.lookAt(peerLookTarget)
        }
      })
      miniMapTimer += delta
      if (miniMapTimer >= 0.12) {
        miniMapTimer = 0
        publishMiniMap()
      }
      renderer.render(scene, camera)
    }

    animate()

    //12.- React to viewport resizes so the renderer and camera aspect stay in sync with the DOM container.
    const handleResize = () => {
      const width = mount.clientWidth || window.innerWidth
      const height = mount.clientHeight || window.innerHeight
      renderer.setSize(width, height)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    }

    window.addEventListener('resize', handleResize)

    //13.- Dispose Three.js resources and detach DOM nodes when the component unmounts.
    return () => {
      disposed = true
      cancelAnimationFrame(animationFrame)
      controller.dispose()
      window.removeEventListener('resize', handleResize)
      renderer.dispose()
      scene.remove(planetShell.mesh)
      planetShell.dispose()
      scene.remove(orbField.group)
      orbField.dispose()
      unsubscribeLobby()
      lobby.dispose()
      remotePeers.forEach((peer) => peer.dispose())
      remotePeers.clear()
      playerNameplate.dispose()
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
        <p className="hud-tip">Use Arrow Keys or PageUp/PageDown to adjust speed, W/S to climb or dive, and Shift to boost.</p>
        <MiniMapOverlay fieldSize={config.fieldSize} peers={miniMapSnapshot.peers} player={miniMapSnapshot.player} />
      </div>
    </div>
  )
}
