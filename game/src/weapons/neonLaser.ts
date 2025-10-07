import * as THREE from 'three'
import { WeaponContext } from '@/weapons/types'

export type NeonLaserOptions = {
  cooldownMs: number
  durationMs: number
  range: number
  attenuation: number
}

export type NeonLaserState = {
  active: boolean
  remainingMs: number
  cooldownMs: number
  origin: THREE.Vector3
  direction: THREE.Vector3
  length: number
  intensity: number
}

export function createNeonLaserSystem(options: NeonLaserOptions){
  const state: NeonLaserState = {
    active: false,
    remainingMs: 0,
    cooldownMs: 0,
    origin: new THREE.Vector3(),
    direction: new THREE.Vector3(0, 0, -1),
    length: options.range,
    intensity: 0,
  }

  const hitPoint = new THREE.Vector3()

  function refreshRay(context: WeaponContext){
    state.origin.copy(context.position)
    state.direction.copy(context.forward).normalize()
    state.length = options.range
    hitPoint.copy(state.direction).multiplyScalar(state.length)
    state.intensity = Math.exp(-options.attenuation * state.length)
  }

  function update(context: WeaponContext){
    //1.- Tick the cooldown timer so subsequent trigger pulls respect the gating window.
    if (state.cooldownMs > 0){
      state.cooldownMs = Math.max(0, state.cooldownMs - context.dt * 1000)
    }

    if (state.active){
      state.remainingMs = Math.max(0, state.remainingMs - context.dt * 1000)
      refreshRay(context)
      if (state.remainingMs === 0){
        //2.- Automatically release the beam when its sustain window elapses.
        state.active = false
      }
    }
  }

  function fire(context: WeaponContext){
    if (state.cooldownMs > 0 || state.active){
      return false
    }
    state.active = true
    state.remainingMs = options.durationMs
    state.cooldownMs = options.cooldownMs + options.durationMs
    refreshRay(context)
    return true
  }

  function sustain(context: WeaponContext){
    //3.- Keep the ray anchored while the trigger remains held.
    if (state.active){
      refreshRay(context)
    }
  }

  function release(){
    //4.- Allow callers to terminate the beam early so burst firing becomes possible.
    state.active = false
    state.remainingMs = 0
  }

  return {
    update,
    fire,
    sustain,
    release,
    get state(){ return state },
    get cooldownMs(){ return state.cooldownMs },
  }
}
