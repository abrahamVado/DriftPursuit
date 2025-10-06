'use client'
import * as THREE from 'three'
import { createStreamer } from '@/world/chunks/streamer'
import { createChaseCam } from '@/camera/chaseCam'
import { createPlayer } from '@/vehicles/shared/player'
import { createInput } from '@/ui/inputMap'
import { createCorridor } from '@/spawn/corridor'
import { createSpawner } from '@/spawn/spawnTable'

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
  }
}

export const DEFAULT_SCENE_OPTS = {
  fogColor: 0x0a0d12,
  fogNear: 150,
  fogFar: 1500,
  ambient: 0x364a6b,
  hemiSky: 0x8cc9ff,
  hemiGround: 0x101418
}

export function initGame(container: HTMLDivElement, opts = DEFAULT_SCENE_OPTS, onReady?: () => void) {
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

  // Player (Arrowhead by default)
  const player = createPlayer('arrowhead', scene)

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
  let readyFired = false

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
      bombArmed: player.controller.bombArmed
    })
  }

  function dispose() {
    removeEventListener('resize', onResize)
    renderer.dispose()
    container.removeChild(renderer.domElement)
  }

  return { api, dispose }
}
