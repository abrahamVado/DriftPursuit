import { CountdownSpectatorCamera } from './countdownSpectator'
import {
  ChaseCameraController,
  ChaseCameraRuntimeOptions,
  ChaseCameraEvent,
  VehicleTransform,
} from './chaseCamera'

export type CameraMode = 'idle' | 'chase' | 'spectator' | 'respawn'

export interface RespawnCameraProfile {
  //1.- Overrides tweak the chase camera while the respawn transition plays.
  overrides: Partial<ChaseCameraRuntimeOptions>
  //2.- Duration specifies how long the respawn blend should last.
  duration: number
}

export interface CameraDirectorOptions {
  //1.- Respawn behavior customizes offsets and damping during recovery.
  respawn: RespawnCameraProfile
}

export class CameraDirector {
  private mode: CameraMode = 'idle'
  private vehicle: VehicleTransform | undefined
  private respawnTimer = 0
  private spectatorCountdown = 0

  constructor(
    private readonly chaseCamera: ChaseCameraController,
    private readonly spectatorCamera: CountdownSpectatorCamera,
    private readonly options: CameraDirectorOptions,
  ) {}

  follow(transform: VehicleTransform): void {
    //1.- Update the transform reference so chase updates always have fresh data.
    this.vehicle = transform
    if (this.mode === 'idle') {
      this.mode = 'chase'
    }
  }

  enterSpectator(countdownSeconds: number): void {
    //1.- Switch into spectator mode and seed the remaining countdown.
    this.mode = 'spectator'
    this.spectatorCountdown = countdownSeconds
  }

  startRespawn(): void {
    //1.- Begin the respawn transition and preload the timer from config.
    this.mode = 'respawn'
    this.respawnTimer = this.options.respawn.duration
  }

  trigger(event: ChaseCameraEvent): void {
    //1.- Forward gameplay events to the chase camera so shake/FX still occur.
    this.chaseCamera.trigger(event)
  }

  update(deltaSeconds: number): void {
    switch (this.mode) {
      case 'spectator':
        //1.- Drive the orbiting spectator camera until the countdown ends.
        this.spectatorCamera.update(deltaSeconds, this.spectatorCountdown)
        this.spectatorCountdown = Math.max(0, this.spectatorCountdown - deltaSeconds)
        break
      case 'respawn':
        //1.- Blend back to gameplay using the respawn overrides for a brief period.
        this.respawnTimer = Math.max(0, this.respawnTimer - deltaSeconds)
        const overrides = this.respawnTimer > 0 ? this.options.respawn.overrides : {}
        this.updateChase(deltaSeconds, overrides)
        if (this.respawnTimer <= 0) {
          this.mode = 'chase'
        }
        break
      case 'chase':
        //1.- Maintain the standard chase behavior for active gameplay.
        this.updateChase(deltaSeconds)
        break
      default:
        //1.- Remain idle until a vehicle is assigned.
        break
    }
  }

  private updateChase(deltaSeconds: number, overrides: Partial<ChaseCameraRuntimeOptions> = {}): void {
    if (!this.vehicle) {
      return
    }
    this.chaseCamera.update(deltaSeconds, this.vehicle, overrides)
  }
}
