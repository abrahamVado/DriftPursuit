import * as THREE from 'three'
import { WeaponContext } from '@/weapons/types'

export type GatlingOptions = {
  fireRate: number
  spread: number
  maxTracers: number
  tracerLifeMs: number
  ammo: number
  heatPerShot: number
  coolRate: number
  overheatThreshold: number
}

export type TracerState = {
  id: number
  origin: THREE.Vector3
  direction: THREE.Vector3
  lifeMs: number
}

export type GatlingState = {
  ammo: number
  heat: number
  overheated: boolean
  tracers: TracerState[]
  accumulator: number
}

export function createGatlingSystem(options: GatlingOptions){
  const state: GatlingState = {
    ammo: options.ammo,
    heat: 0,
    overheated: false,
    tracers: [],
    accumulator: 0,
  }

  let tracerId = 0

  function spawnTracer(context: WeaponContext){
    const tracer: TracerState = {
      id: ++tracerId,
      origin: context.position.clone(),
      direction: context.forward.clone(),
      lifeMs: options.tracerLifeMs,
    }

    //1.- Impose deterministic spread so tests can predictably assert ray casts.
    const seed = tracer.id * 12.9898
    const yaw = (Math.sin(seed) * 0.5) * options.spread
    const pitch = (Math.sin(seed * 0.5) * 0.5) * options.spread
    const rotation = new THREE.Euler(pitch, yaw, 0, 'XYZ')
    tracer.direction.applyEuler(rotation).normalize()

    if (state.tracers.length >= options.maxTracers){
      state.tracers.shift()
    }
    state.tracers.push(tracer)
    return tracer
  }

  function coolDown(dt: number){
    //2.- Dissipate heat over time so prolonged bursts eventually recover.
    if (state.heat > 0){
      state.heat = Math.max(0, state.heat - options.coolRate * dt)
      if (state.overheated && state.heat <= options.overheatThreshold * 0.25){
        state.overheated = false
      }
    }
  }

  function update(context: WeaponContext, triggerHeld: boolean){
    const dt = context.dt

    for (let i = state.tracers.length - 1; i >= 0; i--){
      const tracer = state.tracers[i]
      tracer.lifeMs -= dt * 1000
      if (tracer.lifeMs <= 0){
        state.tracers.splice(i, 1)
      }
    }

    if (!triggerHeld){
      //3.- When idle, only cool the barrels.
      coolDown(dt)
      state.accumulator = 0
      return { shots: 0 }
    }

    if (state.overheated || state.ammo <= 0){
      coolDown(dt)
      return { shots: 0 }
    }

    state.accumulator += dt * options.fireRate
    let shots = 0

    while (state.accumulator >= 1 && state.ammo > 0 && !state.overheated){
      spawnTracer(context)
      state.accumulator -= 1
      state.ammo -= 1
      state.heat += options.heatPerShot
      shots++
      if (state.heat >= options.overheatThreshold){
        //4.- Flag the weapon as overheated so callers must ease off the trigger.
        state.overheated = true
      }
    }

    coolDown(dt)
    return { shots }
  }

  return {
    update,
    get state(){ return state },
    get ammo(){ return state.ammo },
    get overheated(){ return state.overheated },
  }
}
