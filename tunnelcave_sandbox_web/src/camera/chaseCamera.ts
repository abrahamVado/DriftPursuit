import type { CameraRig, Vector3 } from './countdownSpectator'

export interface VehicleTransform {
  position: Vector3
  forward: Vector3
  //1.- Up vector communicates the craft's bank orientation.
  up: Vector3
  //2.- Linear velocity enables look-ahead targeting and FOV tuning.
  velocity: Vector3
  //3.- Optional cached speed avoids recomputing magnitudes if available.
  speed?: number
  //4.- Flag indicating whether boost visuals should currently be active.
  boostActive?: boolean
}

export interface ChaseCameraOffsets {
  //1.- Position offset moves the rig relative to the vehicle's local axes.
  position: Vector3
  //2.- Look-at offset displaces the focal point in the vehicle's local space.
  lookAt: Vector3
}

export interface ChaseCameraDamping {
  //1.- Position damping controls interpolation speed for camera translation.
  position: number
  //2.- Look-at damping controls interpolation speed for the focus point.
  lookAt: number
}

export interface ChaseCameraLookAheadSettings {
  //1.- Distance multiplier applied to the velocity direction.
  distance: number
  //2.- Speed required to reach the full look-ahead distance.
  maxSpeed: number
}

export interface ChaseCameraRollSettings {
  //1.- Fraction of the craft's bank angle applied to the camera rig.
  followStrength: number
  //2.- Damping used when interpolating towards the desired roll.
  damping: number
}

export interface ChaseCameraFovSettings {
  //1.- Base field of view in degrees when stationary.
  idle: number
  //2.- Target field of view at or above the configured max speed.
  max: number
  //3.- Speed that maps to the maximum FOV.
  maxSpeed: number
  //4.- Additional FOV kick applied when boost is active.
  boost: number
  //5.- Damping when lerping between FOV targets.
  damping: number
}

export interface CameraFxPlayer {
  //1.- Trigger a named visual effect like bloom or chromatic aberration.
  playVisualFx(name: string): void
  //2.- Trigger an accompanying audio sting.
  playAudioFx(name: string): void
}

export interface CameraShakeSettings {
  //1.- Amplitude determines the maximum positional displacement in meters.
  amplitude: number
  //2.- Frequency controls the oscillation rate in hertz.
  frequency: number
  //3.- Duration indicates how long the shake should persist.
  duration: number
}

export type ChaseCameraEvent = 'boost' | 'hit' | 'nearMiss' | 'touchdown' | 'ceilingBump' | 'highG' | 'crash'

export interface ChaseCameraEventConfig {
  //1.- Shake specifies how intense the response should feel.
  shake: CameraShakeSettings
  //2.- Visual FX names the screen-space effect to play.
  visualFx: string
  //3.- Audio FX names the sound cue to trigger.
  audioFx: string
}

export interface ChaseCameraRuntimeOptions {
  offsets: ChaseCameraOffsets
  damping: ChaseCameraDamping
}

export interface ChaseCameraOptions extends ChaseCameraRuntimeOptions {
  //1.- Event FX map event identifiers to their configuration.
  eventFx: Partial<Record<ChaseCameraEvent, ChaseCameraEventConfig>>
  //2.- World up allows custom up vectors for non-standard gravity.
  worldUp?: Vector3
  //3.- Look-ahead settings govern how aggressively the camera anticipates motion.
  lookAhead: ChaseCameraLookAheadSettings
  //4.- Roll behavior describes how much the camera leans with the craft.
  roll: ChaseCameraRollSettings
  //5.- Field-of-view response used for speed and boost cues.
  fov: ChaseCameraFovSettings
}

interface ActiveShake {
  remaining: number
  settings: CameraShakeSettings
  phase: number
}

export interface ChaseCameraController {
  update(
    deltaSeconds: number,
    transform: VehicleTransform,
    overrides?: Partial<ChaseCameraRuntimeOptions>,
  ): void
  trigger(event: ChaseCameraEvent): void
}

export class ChaseCamera implements ChaseCameraController {
  private currentPosition: Vector3 | undefined
  private currentLookAt: Vector3 | undefined
  private activeShake: ActiveShake | undefined
  private currentRoll: number | undefined
  private currentFov: number | undefined

  constructor(
    private readonly rig: CameraRig,
    private readonly fx: CameraFxPlayer,
    private readonly options: ChaseCameraOptions,
  ) {}

  update(
    deltaSeconds: number,
    transform: VehicleTransform,
    overrides: Partial<ChaseCameraRuntimeOptions> = {},
  ): void {
    //1.- Merge base options with any runtime overrides for contextual behavior.
    const runtime: ChaseCameraRuntimeOptions = {
      offsets: overrides.offsets ?? this.options.offsets,
      damping: overrides.damping ?? this.options.damping,
    }
    //2.- Derive a stable local frame from the vehicle orientation vectors.
    const forward = normalize(transform.forward)
    const craftUp = normalize(transform.up)
    const right = normalize(cross(craftUp, forward))
    const up = cross(forward, right)
    const worldUp = normalize(this.options.worldUp ?? { x: 0, y: 1, z: 0 })
    //3.- Translate offsets from local space into world coordinates.
    const desiredPosition = applyOffset(transform.position, runtime.offsets.position, {
      forward,
      right,
      up,
    })
    const baseLookAt = applyOffset(transform.position, runtime.offsets.lookAt, {
      forward,
      right,
      up,
    })
    const speed = transform.speed ?? length(transform.velocity)
    const velocityDirection = normalize(transform.velocity)
    const lookAheadScale = clamp(speed / Math.max(this.options.lookAhead.maxSpeed, 1e-3), 0, 1)
    const lookAhead = scaleVector(velocityDirection, this.options.lookAhead.distance * lookAheadScale)
    const desiredLookAt = addVectors(baseLookAt, lookAhead)
    //4.- Update and evaluate any active screen shake.
    const shakenPosition = this.applyShake(deltaSeconds, desiredPosition)
    //5.- Smoothly interpolate the camera rig using exponential damping.
    this.currentPosition = damp(this.currentPosition, shakenPosition, runtime.damping.position, deltaSeconds)
    this.currentLookAt = damp(this.currentLookAt, desiredLookAt, runtime.damping.lookAt, deltaSeconds)
    //6.- Update roll and FOV feedback before committing transform updates.
    this.updateRoll(deltaSeconds, right, up, worldUp)
    this.updateFov(deltaSeconds, speed, Boolean(transform.boostActive))
    //7.- Commit the smoothed transform to the underlying rig.
    this.rig.setPosition(this.currentPosition)
    this.rig.lookAt(this.currentLookAt)
  }

  trigger(event: ChaseCameraEvent): void {
    const config = this.options.eventFx[event]
    if (!config) {
      return
    }
    //1.- Initialize a new shake envelope that decays over time.
    this.activeShake = {
      remaining: config.shake.duration,
      settings: config.shake,
      phase: 0,
    }
    //2.- Kick off the paired VFX and SFX cues.
    this.fx.playVisualFx(config.visualFx)
    this.fx.playAudioFx(config.audioFx)
  }

  private updateRoll(deltaSeconds: number, right: Vector3, up: Vector3, worldUp: Vector3): void {
    if (!this.rig.setRoll) {
      return
    }
    //1.- Measure the craft's bank angle relative to the world up axis.
    const rollAngle = Math.atan2(dot(right, worldUp), dot(up, worldUp))
    const targetRoll = rollAngle * this.options.roll.followStrength
    //2.- Smoothly track the target roll using configurable damping.
    this.currentRoll = dampScalar(this.currentRoll, targetRoll, this.options.roll.damping, deltaSeconds)
    this.rig.setRoll(this.currentRoll)
  }

  private updateFov(deltaSeconds: number, speed: number, boostActive: boolean): void {
    if (!this.rig.setFov) {
      return
    }
    const settings = this.options.fov
    //1.- Map the current speed onto the configured FOV range.
    const speedRatio = clamp(speed / Math.max(settings.maxSpeed, 1e-3), 0, 1)
    const baseFov = settings.idle + (settings.max - settings.idle) * speedRatio
    const targetFov = baseFov + (boostActive ? settings.boost : 0)
    //2.- Ease the FOV response so boosts feel punchy but controlled.
    this.currentFov = dampScalar(this.currentFov, targetFov, settings.damping, deltaSeconds)
    this.rig.setFov(this.currentFov)
  }

  private applyShake(deltaSeconds: number, basePosition: Vector3): Vector3 {
    if (!this.activeShake) {
      return basePosition
    }
    //1.- Advance the shake timer and gracefully finish once depleted.
    this.activeShake.remaining = Math.max(0, this.activeShake.remaining - deltaSeconds)
    this.activeShake.phase += deltaSeconds * this.activeShake.settings.frequency
    if (this.activeShake.remaining <= 0) {
      this.activeShake = undefined
      return basePosition
    }
    //2.- Compute an intensity scalar that eases out as the shake ends.
    const t = this.activeShake.remaining / this.activeShake.settings.duration
    const intensity = this.activeShake.settings.amplitude * t * t
    const angle = this.activeShake.phase * Math.PI * 2
    //3.- Offset the position with orthogonal oscillations to emulate shake.
    return {
      x: basePosition.x + Math.sin(angle) * intensity,
      y: basePosition.y + Math.cos(angle * 0.5) * intensity * 0.5,
      z: basePosition.z + Math.sin(angle * 1.5) * intensity * 0.25,
    }
  }
}

function damp(current: Vector3 | undefined, target: Vector3, damping: number, deltaSeconds: number): Vector3 {
  if (!current) {
    return target
  }
  //1.- Clamp damping to ensure numerical stability across varying delta times.
  const lambda = Math.max(0, Math.min(damping, 60))
  const factor = 1 - Math.exp(-lambda * deltaSeconds)
  return {
    x: current.x + (target.x - current.x) * factor,
    y: current.y + (target.y - current.y) * factor,
    z: current.z + (target.z - current.z) * factor,
  }
}

function dampScalar(current: number | undefined, target: number, damping: number, deltaSeconds: number): number {
  if (current === undefined) {
    return target
  }
  //1.- Mirror the vector damping logic to keep roll/FOV transitions coherent.
  const lambda = Math.max(0, Math.min(damping, 60))
  const factor = 1 - Math.exp(-lambda * deltaSeconds)
  return current + (target - current) * factor
}

interface Basis {
  forward: Vector3
  right: Vector3
  up: Vector3
}

function applyOffset(origin: Vector3, offset: Vector3, basis: Basis): Vector3 {
  //1.- Combine the basis vectors scaled by the offset components.
  return {
    x: origin.x + basis.right.x * offset.x + basis.up.x * offset.y + basis.forward.x * offset.z,
    y: origin.y + basis.right.y * offset.x + basis.up.y * offset.y + basis.forward.y * offset.z,
    z: origin.z + basis.right.z * offset.x + basis.up.z * offset.y + basis.forward.z * offset.z,
  }
}

function normalize(vector: Vector3): Vector3 {
  const length = Math.sqrt(vector.x * vector.x + vector.y * vector.y + vector.z * vector.z) || 1
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length }
}

function cross(a: Vector3, b: Vector3): Vector3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }
}

function addVectors(a: Vector3, b: Vector3): Vector3 {
  //1.- Combine components to offset look-at targets by the look-ahead vector.
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }
}

function scaleVector(vector: Vector3, scalar: number): Vector3 {
  //1.- Scale helper reused for thrusting the look-ahead along velocity.
  return { x: vector.x * scalar, y: vector.y * scalar, z: vector.z * scalar }
}

function length(vector: Vector3): number {
  //1.- Euclidean length of a vector, shared by speed and normalization logic.
  return Math.sqrt(vector.x * vector.x + vector.y * vector.y + vector.z * vector.z)
}

function dot(a: Vector3, b: Vector3): number {
  //1.- Dot product used when computing roll relative to world up.
  return a.x * b.x + a.y * b.y + a.z * b.z
}

function clamp(value: number, min: number, max: number): number {
  //1.- Restrict values to avoid exceeding configured look-ahead and FOV ranges.
  return Math.max(min, Math.min(max, value))
}
