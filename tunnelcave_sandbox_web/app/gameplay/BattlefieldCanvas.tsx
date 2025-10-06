'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'

import type { BattlefieldConfig, TreeInstance } from './generateBattlefield'
import { createChaseCamera } from './chaseCamera'
import { createVehicleController } from './vehicleController'
import { MiniMapOverlay, type MiniMapEntitySnapshot } from './miniMapOverlay'
import { createNameplateSprite, type NameplateSprite } from './nameplate'
import { wrapToInterval, wrappedDelta } from './worldWrapping'
import { createWorldLobby, SHARED_WORLD_ID, type WorldPeerSnapshot } from './worldLobby'

interface TreeRenderState {
  position: THREE.Vector3
  nearTrunk: THREE.Matrix4
  nearCanopy: THREE.Matrix4
  midTrunk: THREE.Matrix4
  midCanopy: THREE.Matrix4
  farHeight: number
  farScale: THREE.Vector3
  branchStart: number
  branchCount: number
}

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

function mulberry32(seed: number) {
  //1.- Local deterministic random generator so procedurally displaced meshes remain stable across renders.
  let t = seed >>> 0
  return () => {
    t = (t + 0x6d2b79f5) >>> 0
    let r = Math.imul(t ^ (t >>> 15), t | 1)
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

function createRockGeometry(archetypeIndex: number, seed: number, assets: BattlefieldConfig['assets']): THREE.BufferGeometry {
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
  geometry = geometry.toNonIndexed()
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

function createTreeState(
  tree: TreeInstance,
  seed: number,
  branchOffset: number,
  branchMatrices: THREE.Matrix4[],
): TreeRenderState {
  //3.- Precompute per-tree matrices for each LOD level to minimise per-frame allocations in the render loop.
  const random = mulberry32(seed)
  const trunkQuaternion = new THREE.Quaternion()
  const trunkScaleNear = new THREE.Vector3(tree.variation * 0.8, tree.trunkHeight * 0.5, tree.variation * 0.8)
  const trunkScaleMid = new THREE.Vector3(tree.variation * 0.6, tree.trunkHeight * 0.45, tree.variation * 0.6)
  const canopyScaleNear = new THREE.Vector3(tree.canopyRadius, tree.canopyRadius, tree.canopyRadius)
  const canopyScaleMid = new THREE.Vector3(tree.canopyRadius * 0.8, tree.canopyRadius * 0.75, tree.canopyRadius * 0.8)

  const trunkMatrixNear = new THREE.Matrix4().compose(
    new THREE.Vector3(tree.position.x, tree.position.y + tree.trunkHeight * 0.5, tree.position.z),
    trunkQuaternion,
    trunkScaleNear,
  )
  const trunkMatrixMid = new THREE.Matrix4().compose(
    new THREE.Vector3(tree.position.x, tree.position.y + tree.trunkHeight * 0.45, tree.position.z),
    trunkQuaternion,
    trunkScaleMid,
  )

  const canopyMatrixNear = new THREE.Matrix4().compose(
    new THREE.Vector3(tree.position.x, tree.position.y + tree.trunkHeight, tree.position.z),
    trunkQuaternion,
    canopyScaleNear,
  )
  const canopyMatrixMid = new THREE.Matrix4().compose(
    new THREE.Vector3(tree.position.x, tree.position.y + tree.trunkHeight * 0.95, tree.position.z),
    trunkQuaternion,
    canopyScaleMid,
  )

  for (let branchIndex = 0; branchIndex < tree.branchCount; branchIndex += 1) {
    const angle = (branchIndex / tree.branchCount) * Math.PI * 2 + random() * 0.3
    const direction = new THREE.Vector3(Math.cos(angle), 0.35 + random() * 0.25, Math.sin(angle)).normalize()
    const branchLength = tree.canopyRadius * (0.7 + random() * 0.3)
    const branchPosition = new THREE.Vector3(
      tree.position.x,
      tree.position.y + tree.trunkHeight * (0.4 + random() * 0.35),
      tree.position.z,
    ).add(direction.clone().multiplyScalar(branchLength * 0.5))
    const branchQuaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction)
    const branchScale = new THREE.Vector3(0.25, branchLength * 0.5, 0.25)
    const matrix = new THREE.Matrix4().compose(branchPosition, branchQuaternion, branchScale)
    branchMatrices[branchOffset + branchIndex] = matrix
  }

  return {
    position: tree.position,
    nearTrunk: trunkMatrixNear,
    nearCanopy: canopyMatrixNear,
    midTrunk: trunkMatrixMid,
    midCanopy: canopyMatrixMid,
    farHeight: tree.position.y + tree.trunkHeight,
    farScale: new THREE.Vector3(tree.canopyRadius * 1.4, tree.canopyRadius * 1.6, 1),
    branchStart: branchOffset,
    branchCount: tree.branchCount,
  }
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

    const assets = config.assets

    const ambientLight = new THREE.AmbientLight(0xb0c4de, 0.55)
    const sunLight = new THREE.DirectionalLight(0xfff2cc, 0.9)
    sunLight.position.set(160, 220, 110)
    scene.add(ambientLight)
    scene.add(sunLight)

    const camera = new THREE.PerspectiveCamera(60, (mount.clientWidth || window.innerWidth) / (mount.clientHeight || window.innerHeight), 0.1, 1200)
    camera.position.set(config.spawnPoint.x, config.spawnPoint.y + 22, config.spawnPoint.z + 34)
    camera.lookAt(config.spawnPoint)

    const terrainSampler = config.terrain.sampler
    const terrainSegments = 160
    const groundGeometry = new THREE.PlaneGeometry(config.fieldSize, config.fieldSize, terrainSegments, terrainSegments)
    groundGeometry.rotateX(-Math.PI / 2)
    const groundPositions = groundGeometry.getAttribute('position') as THREE.BufferAttribute
    for (let index = 0; index < groundPositions.count; index += 1) {
      const x = groundPositions.getX(index)
      const z = groundPositions.getZ(index)
      const sample = terrainSampler.sampleGround(x, z)
      groundPositions.setY(index, sample.height)
    }
    groundPositions.needsUpdate = true
    groundGeometry.computeVertexNormals()
    const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x2e4f30, roughness: 0.88, metalness: 0.08 })
    const groundMesh = new THREE.Mesh(groundGeometry, groundMaterial)
    groundMesh.receiveShadow = true
    scene.add(groundMesh)

    const ceilingGeometry = new THREE.PlaneGeometry(config.fieldSize, config.fieldSize, 16, 16)
    ceilingGeometry.rotateX(Math.PI / 2)
    const ceilingPositions = ceilingGeometry.getAttribute('position') as THREE.BufferAttribute
    for (let index = 0; index < ceilingPositions.count; index += 1) {
      const x = ceilingPositions.getX(index)
      const z = ceilingPositions.getZ(index)
      const ceilingHeight = terrainSampler.sampleCeiling(x, z)
      ceilingPositions.setY(index, ceilingHeight)
    }
    ceilingPositions.needsUpdate = true
    const ceilingMaterial = new THREE.MeshStandardMaterial({ color: 0x1b1b2f, side: THREE.BackSide, roughness: 0.35, metalness: 0.08, transparent: true, opacity: 0.75 })
    const ceilingMesh = new THREE.Mesh(ceilingGeometry, ceilingMaterial)
    scene.add(ceilingMesh)

    const waterCellSize = config.fieldSize / 32
    const waterGeometry = new THREE.PlaneGeometry(1, 1)
    waterGeometry.rotateX(-Math.PI / 2)
    const waterMaterial = new THREE.MeshStandardMaterial({ color: 0x335c81, transparent: true, opacity: 0.6, roughness: 0.35, metalness: 0.1 })
    const waterMesh = new THREE.InstancedMesh(waterGeometry, waterMaterial, Math.max(1, config.waters.length))
    waterMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    const waterMatrix = new THREE.Matrix4()
    const waterQuaternion = new THREE.Quaternion()
    config.waters.forEach((sample, index) => {
      waterMatrix.compose(
        new THREE.Vector3(sample.position.x, sample.level + 0.01, sample.position.z),
        waterQuaternion,
        new THREE.Vector3(waterCellSize, 1, waterCellSize),
      )
      waterMesh.setMatrixAt(index, waterMatrix)
    })
    waterMesh.instanceMatrix.needsUpdate = true
    scene.add(waterMesh)

    const rockGeometries = assets.rocks.map((_, index) => createRockGeometry(index, config.seed + index * 13, assets))
    const rockCounts = assets.rocks.map(() => 0)
    config.rocks.forEach((rock) => {
      rockCounts[rock.archetypeIndex] += 1
    })
    const rockMeshes = assets.rocks.map((archetype, index) => {
      const count = Math.max(1, rockCounts[index])
      const material = new THREE.MeshStandardMaterial({ color: 0x5a615c, roughness: 0.92, metalness: 0.18 })
      const mesh = new THREE.InstancedMesh(rockGeometries[index], material, count)
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      mesh.castShadow = false
      mesh.receiveShadow = true
      scene.add(mesh)
      return mesh
    })
    const rockMatrix = new THREE.Matrix4()
    const rockQuaternion = new THREE.Quaternion()
    const rockScale = new THREE.Vector3()
    const rockOffsets = assets.rocks.map(() => 0)
    config.rocks.forEach((rock) => {
      const archetype = assets.rocks[rock.archetypeIndex]
      const mesh = rockMeshes[rock.archetypeIndex]
      const instanceIndex = rockOffsets[rock.archetypeIndex]
      rockOffsets[rock.archetypeIndex] += 1
      rockQuaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rock.rotation)
      rockScale.set(archetype.radius * rock.scale.x, archetype.height * rock.scale.y, archetype.radius * rock.scale.z)
      rockMatrix.compose(rock.position, rockQuaternion, rockScale)
      mesh.setMatrixAt(instanceIndex, rockMatrix)
    })
    rockMeshes.forEach((mesh) => { mesh.instanceMatrix.needsUpdate = true })

    const treeCount = config.trees.length
    const branchTotal = config.trees.reduce((sum, tree) => sum + tree.branchCount, 0)
    const trunkNearGeometry = new THREE.CylinderGeometry(1, 1, 2, assets.trees[0].lods[0].trunkSides)
    const trunkMidGeometry = new THREE.CylinderGeometry(1, 1, 2, assets.trees[0].lods[1].trunkSides)
    const canopyNearGeometry = new THREE.IcosahedronGeometry(1, assets.trees[0].lods[0].leafDetail)
    const canopyMidGeometry = new THREE.IcosahedronGeometry(1, assets.trees[0].lods[1].leafDetail)
    const canopyFarGeometry = new THREE.PlaneGeometry(1, 1)
    const branchGeometry = new THREE.CylinderGeometry(0.1, 0.25, 2, 5)
    canopyFarGeometry.rotateY(Math.PI)
    trunkNearGeometry.translate(0, 1, 0)
    trunkMidGeometry.translate(0, 1, 0)
    branchGeometry.translate(0, 1, 0)
    canopyFarGeometry.translate(0, 0.5, 0)

    const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x4d2c1c, roughness: 0.85, metalness: 0.1 })
    const canopyMaterial = new THREE.MeshStandardMaterial({ color: 0x4a7c59, roughness: 0.65, metalness: 0.1 })
    const canopyFarMaterial = new THREE.MeshStandardMaterial({ color: 0x4a7c59, transparent: true, opacity: 0.82, side: THREE.DoubleSide })
    const branchMaterial = new THREE.MeshStandardMaterial({ color: 0x614a34, roughness: 0.8 })

    const trunkNearMesh = new THREE.InstancedMesh(trunkNearGeometry, trunkMaterial, Math.max(1, treeCount))
    const trunkMidMesh = new THREE.InstancedMesh(trunkMidGeometry, trunkMaterial, Math.max(1, treeCount))
    const canopyNearMesh = new THREE.InstancedMesh(canopyNearGeometry, canopyMaterial, Math.max(1, treeCount))
    const canopyMidMesh = new THREE.InstancedMesh(canopyMidGeometry, canopyMaterial, Math.max(1, treeCount))
    const canopyFarMesh = new THREE.InstancedMesh(canopyFarGeometry, canopyFarMaterial, Math.max(1, treeCount))
    const branchMesh = branchTotal > 0 ? new THREE.InstancedMesh(branchGeometry, branchMaterial, branchTotal) : null

    trunkNearMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    trunkMidMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    canopyNearMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    canopyMidMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    canopyFarMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    if (branchMesh) {
      branchMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    }

    scene.add(trunkNearMesh)
    scene.add(trunkMidMesh)
    scene.add(canopyNearMesh)
    scene.add(canopyMidMesh)
    scene.add(canopyFarMesh)
    if (branchMesh) {
      scene.add(branchMesh)
    }

    const branchMatrices = Array.from({ length: branchTotal }, () => new THREE.Matrix4())
    const treeStates: TreeRenderState[] = []
    let branchCursor = 0
    config.trees.forEach((tree, index) => {
      const state = createTreeState(tree, config.seed + 200 + index * 17, branchCursor, branchMatrices)
      treeStates.push(state)
      branchCursor += tree.branchCount
    })

    const zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0)
    for (let index = 0; index < treeCount; index += 1) {
      trunkNearMesh.setMatrixAt(index, zeroMatrix)
      trunkMidMesh.setMatrixAt(index, zeroMatrix)
      canopyNearMesh.setMatrixAt(index, zeroMatrix)
      canopyMidMesh.setMatrixAt(index, zeroMatrix)
      canopyFarMesh.setMatrixAt(index, zeroMatrix)
    }
    if (branchMesh) {
      for (let index = 0; index < branchTotal; index += 1) {
        branchMesh.setMatrixAt(index, zeroMatrix)
      }
    }

    const treeNearDistance = 60
    const treeMidDistance = 140

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
    const wrapSize = config.environment.wrapSize
    const controller = createVehicleController({
      bounds: config.environment.boundsRadius,
      baseAcceleration: 48,
      brakeDeceleration: 220,
      dragFactor: 0.92,
      maxForwardSpeed: 150,
      maxReverseSpeed: 28,
      boostSpeedMultiplier: 1.4,
      boostAccelerationMultiplier: 1.2,
      verticalAcceleration: 22,
      gravity: 19,
      verticalDrag: 2.6,
      maxVerticalSpeed: 36,
      environment: {
        sampleGround: (x, z) => terrainSampler.sampleGround(x, z),
        sampleCeiling: (x, z) => terrainSampler.sampleCeiling(x, z),
        sampleWater: (x, z) => terrainSampler.sampleWater(x, z),
        vehicleRadius: config.environment.vehicleRadius,
        slopeLimitRadians: config.environment.slopeLimitRadians,
        bounceDamping: config.environment.bounceDamping,
        groundSnapStrength: config.environment.groundSnapStrength,
        boundsRadius: config.environment.boundsRadius,
        waterDrag: config.environment.waterDrag,
        waterBuoyancy: config.environment.waterBuoyancy,
        waterMinDepth: config.environment.waterMinDepth,
        maxWaterSpeedScale: config.environment.maxWaterSpeedScale,
        wrapSize,
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

    const billboardQuaternion = new THREE.Quaternion()
    const farMatrix = new THREE.Matrix4()
    const farPosition = new THREE.Vector3()
    const peerAlignment = new THREE.Vector3()
    const peerLookTarget = new THREE.Vector3()
    const lastPosition = new THREE.Vector3().copy(vehicleBody.position)

    //10.- Refresh LOD instances so nearby trees show branches while distant ones collapse to impostors.
    const updateTreeLods = () => {
      treeStates.forEach((state, index) => {
        const distance = camera.position.distanceTo(state.position)
        const useNear = distance < treeNearDistance
        const useMid = !useNear && distance < treeMidDistance
        const useFar = !useNear && !useMid
        trunkNearMesh.setMatrixAt(index, useNear ? state.nearTrunk : zeroMatrix)
        canopyNearMesh.setMatrixAt(index, useNear ? state.nearCanopy : zeroMatrix)
        trunkMidMesh.setMatrixAt(index, useMid ? state.midTrunk : zeroMatrix)
        canopyMidMesh.setMatrixAt(index, useMid ? state.midCanopy : zeroMatrix)
        if (useFar) {
          farPosition.set(state.position.x, state.farHeight, state.position.z)
          billboardQuaternion.copy(camera.quaternion)
          farMatrix.compose(farPosition, billboardQuaternion, state.farScale)
          canopyFarMesh.setMatrixAt(index, farMatrix)
        } else {
          canopyFarMesh.setMatrixAt(index, zeroMatrix)
        }
        if (branchMesh) {
          for (let branchIndex = 0; branchIndex < state.branchCount; branchIndex += 1) {
            const slot = state.branchStart + branchIndex
            branchMesh.setMatrixAt(slot, useNear ? branchMatrices[slot] : zeroMatrix)
          }
        }
      })
      trunkNearMesh.instanceMatrix.needsUpdate = true
      canopyNearMesh.instanceMatrix.needsUpdate = true
      trunkMidMesh.instanceMatrix.needsUpdate = true
      canopyMidMesh.instanceMatrix.needsUpdate = true
      canopyFarMesh.instanceMatrix.needsUpdate = true
      if (branchMesh) {
        branchMesh.instanceMatrix.needsUpdate = true
      }
    }

    //11.- Advance the simulation with a clamped delta time before rendering the latest frame.
    const animate = () => {
      animationFrame = requestAnimationFrame(animate)
      const now = performance.now()
      const delta = Math.min(0.1, (now - previousTime) / 1000)
      previousTime = now
      controller.step(delta, vehicleBody)
      chaseRig.update(camera, vehicleBody, controller.getSpeed(), delta)
      updateTreeLods()
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
      groundGeometry.dispose()
      groundMaterial.dispose()
      ceilingGeometry.dispose()
      ceilingMaterial.dispose()
      waterGeometry.dispose()
      waterMaterial.dispose()
      rockGeometries.forEach((geometry) => geometry.dispose())
      rockMeshes.forEach((mesh) => {
        mesh.geometry.dispose()
        mesh.material.dispose()
        mesh.dispose()
      })
      trunkNearGeometry.dispose()
      trunkMidGeometry.dispose()
      canopyNearGeometry.dispose()
      canopyMidGeometry.dispose()
      canopyFarGeometry.dispose()
      branchGeometry.dispose()
      trunkMaterial.dispose()
      canopyMaterial.dispose()
      canopyFarMaterial.dispose()
      branchMaterial.dispose()
      trunkNearMesh.dispose()
      trunkMidMesh.dispose()
      canopyNearMesh.dispose()
      canopyMidMesh.dispose()
      canopyFarMesh.dispose()
      branchMesh?.dispose()
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
