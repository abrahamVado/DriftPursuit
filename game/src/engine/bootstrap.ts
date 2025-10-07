'use client'
import * as THREE from 'three'
import { createStreamer } from '@/world/chunks/streamer'
import { createChaseCam } from '@/camera/chaseCam'
import { createPlayer } from '@/vehicles/shared/player'
import { createRemotePlayerManager } from '@/engine/remotePlayers'
import { createInput } from '@/ui/inputMap'
import { createCorridor } from '@/spawn/corridor'
import { createSpawner } from '@/spawn/spawnTable'
import { applyBossDefeat, getDifficultyState, onDifficultyChange } from '@/engine/difficulty'
import type { BrokerIntentSnapshot, BrokerWorldDiffEnvelope } from '@/lib/brokerClient'
import { DEFAULT_VEHICLE_KEY, type VehicleKey } from '@/lib/pilotProfile'

export type PresenceSnapshot = {
  vehicle_id: string
  position: { x: number; y: number; z: number }
  orientation: { yaw_deg: number; pitch_deg: number; roll_deg: number }
}

export type GameAPI = {
  actions: any
  getState: () => {
    speed: number
    altitude: number
    stage: number
    score: number
    weapon: string
    ammo: number
    missiles: number
    laserCooldown: number
    bombArmed: boolean
    ability: string
    shieldActive: boolean
    dashActive: boolean
    ultimateActive: boolean
    hull: number
    difficulty: ReturnType<typeof getDifficultyState>
  }
  ingestWorldDiff: (diff: BrokerWorldDiffEnvelope) => void
  sampleIntent: () => BrokerIntentSnapshot
  samplePresence: () => PresenceSnapshot | null
  ingestPresenceSnapshot: (snapshot: PresenceSnapshot) => void
  removeRemoteVehicle: (vehicleId: string) => void
  pilotId: string
}

export type InitGameOptions = {
  initialVehicle?: VehicleKey
  pilotId?: string
}

export const DEFAULT_SCENE_OPTS = {
  fogColor: 0x0a0d12,
  fogNear: 150,
  fogFar: 1500,
  ambient: 0x364a6b,
  hemiSky: 0x8cc9ff,
  hemiGround: 0x101418
}

export function initGame(
  container: HTMLDivElement,
  opts = DEFAULT_SCENE_OPTS,
  onReady?: () => void,
  options?: InitGameOptions
) {
  const scene = new THREE.Scene()
  scene.fog = new THREE.Fog(opts.fogColor, opts.fogNear, opts.fogFar)

  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  renderer.setSize(container.clientWidth, container.clientHeight)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  container.appendChild(renderer.domElement)

  const camera = new THREE.PerspectiveCamera(70, container.clientWidth / container.clientHeight, 0.1, 5000)
  camera.position.set(0, 20, 60)

  // Lights
  scene.add(new THREE.AmbientLight(opts.ambient, 0.7))
  const hemi = new THREE.HemisphereLight(opts.hemiSky, opts.hemiGround, 0.8)
  scene.add(hemi)
  const sun = new THREE.DirectionalLight(0xffffff, 0.8)
  sun.position.set(200, 300, 100)
  scene.add(sun)

  // Systems
  const input = createInput(container)
  const chase = createChaseCam(camera)
  const streamer = createStreamer(scene)
  const remotePlayers = createRemotePlayerManager(scene)

  //1.- Spawn the player with the requested vehicle or gracefully fall back to the Arrowhead chassis.
  const startingVehicle = options?.initialVehicle ?? DEFAULT_VEHICLE_KEY
  const player = createPlayer(startingVehicle, scene)
  const pilotId = options?.pilotId ?? 'pilot-local'

  // Spawn corridor and spawner
  const corridor = createCorridor(scene)
  const spawner = createSpawner(scene, player, streamer)

  // Resize
  const onResize = () => {
    renderer.setSize(container.clientWidth, container.clientHeight)
    camera.aspect = container.clientWidth / container.clientHeight
    camera.updateProjectionMatrix()
  }
  addEventListener('resize', onResize)

  // Loop
  let last = performance.now()
  let stage = 1
  let score = 0
  let latestTick = 0
  let readyFired = false
  let difficultyState = getDifficultyState()
  const unsubscribeDifficulty = onDifficultyChange((next) => {
    //1.- Persist the latest difficulty values so telemetry queries remain in sync with global scaling.
    difficultyState = next
  })

  function frame(now: number) {
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now

    // Input → player control
    player.controller.update(dt, input, streamer.queryHeight)

    // Stream world around the player
    streamer.update(player.group.position)

    // Spawning / encounters
    spawner.update(dt, stage)

    // Camera
    chase.update(dt, player.group)

    // Render
    renderer.render(scene, camera)

    if (!readyFired) { onReady?.(); readyFired = true }
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)

  const api: GameAPI = {
    actions: {
      cycleVehicle: player.cycleVehicle,
      setVehicle: player.setVehicle,
    },
    getState: () => ({
      speed: player.controller.speed,
      altitude: Math.max(0, player.group.position.y - streamer.queryHeight(player.group.position.x, player.group.position.z)),
      stage,
      score,
      weapon: player.controller.weaponName,
      ammo: player.controller.ammo,
      missiles: player.controller.missiles,
      laserCooldown: player.controller.laserCooldownMs,
      bombArmed: player.controller.bombArmed,
      ability: player.controller.weaponName,
      shieldActive: player.controller.shieldActive,
      dashActive: player.controller.dashActive,
      ultimateActive: player.controller.ultimateActive,
      hull: player.controller.hull,
      difficulty: difficultyState
    }),
    ingestWorldDiff: (diff) => {
      //1.- Ignore stale or unrelated payloads so the local scene only reacts to advancing authoritative ticks.
      if (!diff || diff.type !== 'world_diff' || typeof diff.tick !== 'number' || diff.tick <= latestTick) {
        return
      }
      latestTick = diff.tick

      //2.- Fold HUD-centric metadata into the aggregated score and stage trackers.
      if (Array.isArray(diff.events)) {
        for (const event of diff.events) {
          const metadata = event?.metadata
          if (!metadata) continue
          const scoreDelta = Number(metadata.score_delta ?? metadata.score)
          if (!Number.isNaN(scoreDelta)) {
            score += scoreDelta
          }
          const stageValue = Number(metadata.stage ?? metadata.stage_index)
          if (!Number.isNaN(stageValue) && stageValue > 0) {
            if (stageValue > stage) {
              //1.- Treat forward stage jumps as boss clears and escalate the shared difficulty profile.
              difficultyState = applyBossDefeat(stageValue)
            }
            stage = stageValue
          }
        }
      }

      //3.- Mirror authoritative vehicle transforms so remote pilots appear alongside the local craft.
      if (diff.vehicles) {
        remotePlayers.ingestDiff(diff.vehicles)
      }
    },
    sampleIntent: () => {
      //3.- Translate the instantaneous input map into the broker intent schema fields.
      const throttle = input.pressed('KeyW') ? 1 : input.pressed('KeyS') ? -1 : 0
      const brake = input.pressed('Space') || throttle < 0 ? 1 : 0
      const steer = (input.pressed('KeyD') ? 1 : 0) - (input.pressed('KeyA') ? 1 : 0)
      const handbrake = input.pressed('KeyF') || input.pressed('KeyC')
      const boost = input.pressed('ShiftLeft') || input.pressed('ShiftRight')

      return {
        throttle,
        brake,
        steer,
        handbrake,
        gear: 1,
        boost
      }
    },
    samplePresence: () => {
      //1.- Capture the current vehicle transform so other browser tabs can replay the motion locally.
      if (!pilotId) {
        return null
      }
      const { position, rotation } = player.group
      return {
        vehicle_id: pilotId,
        position: { x: position.x, y: position.y, z: position.z },
        orientation: {
          yaw_deg: THREE.MathUtils.radToDeg(rotation.y),
          pitch_deg: THREE.MathUtils.radToDeg(rotation.x),
          roll_deg: THREE.MathUtils.radToDeg(rotation.z)
        }
      }
    },
    ingestPresenceSnapshot: (snapshot) => {
      //1.- Skip malformed payloads and self echoes so only remote presences manifest as ghost ships.
      if (!snapshot || snapshot.vehicle_id === pilotId) {
        return
      }
      remotePlayers.ingestDiff({
        updated: [
          {
            vehicle_id: snapshot.vehicle_id,
            position: snapshot.position,
            orientation: snapshot.orientation
          }
        ]
      })
    },
    removeRemoteVehicle: (vehicleId) => {
      //1.- Cull stale presences using the existing diff ingestion pipeline for deterministic teardown.
      if (!vehicleId || vehicleId === pilotId) {
        return
      }
      remotePlayers.ingestDiff({ removed: [vehicleId] })
    },
    pilotId
  }

  function dispose() {
    removeEventListener('resize', onResize)
    renderer.dispose()
    container.removeChild(renderer.domElement)
    input.dispose()
    streamer.dispose?.()
    spawner.dispose?.()
    remotePlayers.dispose()
    unsubscribeDifficulty?.()
  }

  return { api, dispose }
}
