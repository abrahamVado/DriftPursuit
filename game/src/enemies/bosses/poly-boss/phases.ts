import * as THREE from 'three'
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js'
import { createEnemy } from '@/enemies/stellated-octahedron/behavior'
import { applyBossDefeat, getDifficultyState, onDifficultyChange } from '@/engine/difficulty'

export type PolyBossPhase = 'shield' | 'assault' | 'core' | 'enrage'

export type PolyBossOptions = {
  stage?: number
  addTarget?: THREE.Object3D
  randomSeed?: number
}

type BeamController = {
  pivot: THREE.Object3D
  mesh: THREE.Mesh
  angle: number
  sweepOffset: number
  speed: number
}

type BossState = {
  phase: PolyBossPhase
  hp: number
  maxHp: number
  shieldStrength: number
  timeInPhase: number
  stage: number
  beams: BeamController[]
  spawnTimer: number
  enraged: boolean
  difficulty: ReturnType<typeof getDifficultyState>
}

function seededRandom(seed: number): () => number {
  //1.- Implement a small LCG so that randomly generated hulls remain deterministic for tests when a seed is supplied.
  let value = (seed >>> 0) || 1
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0
    return (value & 0xfffffff) / 0xfffffff
  }
}

function buildConvexHull(stage: number, seed?: number): THREE.BufferGeometry {
  //1.- Create a seeded RNG if a caller wants deterministic hull generation.
  const rand = seed !== undefined ? seededRandom(seed) : Math.random
  const radius = 22 + stage * 4
  const count = Math.min(28, 12 + stage * 3)
  const points: THREE.Vector3[] = []
  for (let i = 0; i < count; i++) {
    //2.- Sample points on a sphere before jittering the radial distance to keep the hull convex but interesting.
    const theta = rand() * Math.PI * 2
    const phi = Math.acos(2 * rand() - 1)
    const jitter = 0.6 + rand() * 0.4
    const r = radius * jitter
    const x = Math.sin(phi) * Math.cos(theta) * r
    const y = Math.cos(phi) * r * 0.7
    const z = Math.sin(phi) * Math.sin(theta) * r
    points.push(new THREE.Vector3(x, y, z))
  }
  //3.- Feed the sampled points into the convex hull helper and smooth the result for proper lighting.
  const geometry = new ConvexGeometry(points)
  geometry.computeVertexNormals()
  return geometry
}

function createShieldRing(stage: number): { group: THREE.Group, strength: number } {
  //1.- Assemble a rotating array of hexagonal plates to serve as the boss shield visual.
  const group = new THREE.Group()
  const segmentCount = Math.min(10, 6 + stage)
  const radius = 34 + stage * 2
  for (let i = 0; i < segmentCount; i++) {
    const angle = (i / segmentCount) * Math.PI * 2
    const plate = new THREE.Mesh(
      new THREE.CylinderGeometry(6, 4, 1.6, 6),
      new THREE.MeshStandardMaterial({ color: 0x44bbff, emissive: 0x112244, transparent: true, opacity: 0.75 })
    )
    plate.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius)
    plate.lookAt(new THREE.Vector3(0, 0, 0))
    group.add(plate)
  }
  const strength = 180 + stage * 80
  return { group, strength }
}

function createBeamArray(stage: number): BeamController[] {
  //1.- Create sweeping beam pylons that orbit the boss while oscillating vertically.
  const beams: BeamController[] = []
  const baseCount = 2 + Math.floor(stage / 2)
  for (let i = 0; i < baseCount; i++) {
    const pivot = new THREE.Object3D()
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(2.4, 2.4, 120, 8, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xff6611, transparent: true, opacity: 0.55 })
    )
    mesh.position.x = 48 + stage * 4
    mesh.rotation.z = Math.PI / 2
    pivot.add(mesh)
    beams.push({ pivot, mesh, angle: (i / baseCount) * Math.PI * 2, sweepOffset: i * 0.9, speed: 0.6 + stage * 0.08 })
  }
  return beams
}

function disposeObject(object: THREE.Object3D): void {
  //1.- Traverse the hierarchy and release GPU resources associated with meshes.
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose()
      const material = child.material
      if (Array.isArray(material)) {
        for (const mat of material) mat.dispose?.()
      } else {
        material.dispose?.()
      }
    }
  })
}

function phaseToString(state: BossState): PolyBossPhase {
  //1.- Expose the phase directly since we track it as a string literal internally.
  return state.phase
}

export function createPolyBoss(scene: THREE.Scene, position: THREE.Vector3, options: PolyBossOptions = {}) {
  //1.- Resolve configuration defaults before constructing the boss hierarchy.
  const stage = Math.max(1, options.stage ?? 1)
  const difficulty = getDifficultyState()
  const hullMesh = new THREE.Mesh(
    buildConvexHull(stage, options.randomSeed),
    new THREE.MeshStandardMaterial({
      color: 0x3344ff,
      roughness: 0.35,
      metalness: 0.45,
      emissive: 0x05091a
    })
  )
  const bossGroup = new THREE.Group()
  bossGroup.add(hullMesh)
  bossGroup.position.copy(position)

  //2.- Prepare shield and beam attachments used by the phase logic.
  const { group: shieldGroup, strength: baseShield } = createShieldRing(stage)
  const beams = createBeamArray(stage)
  for (const beam of beams) bossGroup.add(beam.pivot)
  bossGroup.add(shieldGroup)

  //3.- Add an inner core that only becomes vulnerable during later phases.
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(9 + stage * 0.8, 24, 24),
    new THREE.MeshStandardMaterial({ color: 0xff3366, emissive: 0x440011, metalness: 0.3, roughness: 0.35 })
  )
  core.visible = false
  bossGroup.add(core)

  scene.add(bossGroup)

  const state: BossState = {
    phase: 'shield',
    hp: 1200 + stage * 420,
    maxHp: 1200 + stage * 420,
    shieldStrength: baseShield,
    timeInPhase: 0,
    stage,
    beams,
    spawnTimer: 4,
    enraged: false,
    difficulty
  }

  let unsubscribe = onDifficultyChange((next) => {
    //1.- Capture live difficulty adjustments so spawn cadence reacts mid-fight.
    state.difficulty = next
  })

  function spawnAdd(): void {
    //1.- Spawn a reinforcement enemy using the difficulty unlocked roster.
    const add = createEnemy(
      scene,
      bossGroup.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 160, 40 + Math.random() * 40, (Math.random() - 0.5) * 160)),
      { difficulty: state.difficulty, variant: state.enraged ? 'strafer' : 'pursuer' }
    )
    if (options.addTarget) {
      add.target = options.addTarget
    }
  }

  function advancePhase(next: PolyBossPhase): void {
    //1.- Swap to the requested phase and reset the timer bookkeeping.
    if (state.phase === next) return
    state.phase = next
    state.timeInPhase = 0

    //2.- Toggle visuals based on the current phase specification.
    if (next === 'shield') {
      shieldGroup.visible = true
      core.visible = false
    } else if (next === 'assault') {
      shieldGroup.visible = false
      core.visible = false
    } else {
      shieldGroup.visible = false
      core.visible = true
    }
  }

  function updateBeams(dt: number): void {
    //1.- Animate every beam pivot to achieve sweeping arcs that track the player area.
    for (const beam of state.beams) {
      beam.angle += dt * beam.speed * (state.enraged ? 2.2 : 1)
      beam.pivot.rotation.y = beam.angle
      beam.pivot.rotation.x = Math.sin(state.timeInPhase * 0.9 + beam.sweepOffset) * (state.enraged ? 0.9 : 0.6)
    }
  }

  function updatePhase(dt: number): void {
    //1.- Advance the timer and evaluate transitions in priority order.
    state.timeInPhase += dt
    const hpRatio = state.hp / state.maxHp

    if (state.phase === 'shield') {
      shieldGroup.rotation.y += dt * 0.8
      if (state.shieldStrength <= 0 || state.timeInPhase > 18) {
        advancePhase('assault')
      }
    } else if (state.phase === 'assault') {
      updateBeams(dt)
      state.spawnTimer -= dt / state.difficulty.spawnIntervalMultiplier
      if (state.spawnTimer <= 0) {
        spawnAdd()
        state.spawnTimer = Math.max(2.4, 5.5 * state.difficulty.spawnIntervalMultiplier)
      }
      if (hpRatio < 0.62 || state.timeInPhase > 24) {
        advancePhase('core')
      }
    } else if (state.phase === 'core') {
      updateBeams(dt)
      hullMesh.rotation.y += dt * 0.3
      if (hpRatio < 0.28 || state.timeInPhase > 16) {
        state.enraged = true
        advancePhase('enrage')
      }
    } else if (state.phase === 'enrage') {
      updateBeams(dt)
      hullMesh.rotation.y += dt * 0.7
      state.spawnTimer -= dt / (state.difficulty.spawnIntervalMultiplier * 0.7)
      if (state.spawnTimer <= 0) {
        spawnAdd()
        state.spawnTimer = Math.max(1.4, 4.2 * state.difficulty.spawnIntervalMultiplier)
      }
    }
  }

  function takeDamage(amount: number): void {
    //1.- Route damage to shields first before allowing the hull to take meaningful losses.
    if (state.shieldStrength > 0) {
      const absorbed = Math.min(state.shieldStrength, amount)
      state.shieldStrength -= absorbed
      amount -= absorbed
      if (state.shieldStrength <= 0 && state.phase === 'shield') {
        advancePhase('assault')
      }
    }
    if (amount > 0) {
      const multiplier = state.phase === 'core' ? 1.4 : state.enraged ? 1.2 : 1
      state.hp = Math.max(0, state.hp - amount * multiplier)
    }
  }

  const api = {
    mesh: bossGroup,
    getPhase(): PolyBossPhase {
      //1.- Allow external systems (and tests) to query the live phase label.
      return phaseToString(state)
    },
    getStateSnapshot() {
      //1.- Expose immutable state data for diagnostics without breaking encapsulation.
      return {
        phase: state.phase,
        hp: state.hp,
        shieldStrength: state.shieldStrength,
        timeInPhase: state.timeInPhase,
        enraged: state.enraged
      }
    },
    takeDamage(amount: number) {
      //1.- Forward incoming damage values through the shield/hull resolution helper.
      takeDamage(amount)
    },
    update(dt: number) {
      //1.- Rotate the entire boss hull for motion and tick the active phase logic each frame.
      hullMesh.rotation.y += dt * 0.25
      hullMesh.rotation.x += dt * 0.12
      updatePhase(dt)
    },
    onDeath() {
      //1.- Remove all scene resources and propagate the defeat to the shared difficulty system.
      scene.remove(bossGroup)
      disposeObject(bossGroup)
      unsubscribe?.()
      unsubscribe = undefined
      applyBossDefeat(stage)
    }
  }

  return api
}
