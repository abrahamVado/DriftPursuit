export interface Vector3 {
  x: number
  y: number
  z: number
}

export interface CameraRig {
  //1.- Update the camera's position in world space.
  setPosition(position: Vector3): void
  //2.- Re-aim the camera towards a target point.
  lookAt(target: Vector3): void
  //3.- Optionally roll the camera to follow vehicle banking cues.
  setRoll?(rollRadians: number): void
  //4.- Optionally adjust the camera field of view for speed FX.
  setFov?(degrees: number): void
}

export interface CountdownCameraOptions {
  //1.- Orbit radius controls lateral distance from the focus point.
  orbitRadius: number
  //2.- Orbit height offsets the camera vertically while counting down.
  orbitHeight: number
  //3.- Rotation speed drives the angular velocity in radians per second.
  rotationSpeed: number
  //4.- Focus provides the anchor that the camera should frame.
  focus: Vector3
}

export class CountdownSpectatorCamera {
  private angle = 0

  constructor(
    private readonly rig: CameraRig,
    private readonly options: CountdownCameraOptions,
  ) {}

  update(deltaSeconds: number, countdownSeconds: number): void {
    if (countdownSeconds <= 0) {
      return
    }
    //1.- Advance the orbit angle using the configured angular speed.
    this.angle += this.options.rotationSpeed * deltaSeconds
    //2.- Compute the desired camera position in cylindrical coordinates.
    const x = this.options.focus.x + Math.cos(this.angle) * this.options.orbitRadius
    const z = this.options.focus.z + Math.sin(this.angle) * this.options.orbitRadius
    const position: Vector3 = { x, y: this.options.focus.y + this.options.orbitHeight, z }
    //3.- Apply the transform to the rig while keeping the focus centered.
    this.rig.setPosition(position)
    this.rig.lookAt(this.options.focus)
  }
}
