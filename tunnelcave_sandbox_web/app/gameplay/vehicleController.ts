import * as THREE from 'three'

export interface VehicleControllerOptions {
  acceleration?: number
  maxSpeed?: number
  damping?: number
  turnSpeed?: number
  bounds?: number
  groundY?: number
  ceilingY?: number
}

export interface VehicleController {
  step: (delta: number, object: THREE.Object3D) => void
  dispose: () => void
  getSpeed: () => number
}

function normaliseKey(value: string): string {
  return value.toLowerCase()
}

export function createVehicleController(options: VehicleControllerOptions = {}): VehicleController {
  const acceleration = options.acceleration ?? 24
  const maxSpeed = options.maxSpeed ?? 160
  const damping = options.damping ?? 0.88
  const turnSpeed = options.turnSpeed ?? Math.PI
  const bounds = options.bounds ?? 160
  const groundY = options.groundY ?? -16
  const ceilingY = options.ceilingY ?? 40

  const activeKeys = new Set<string>()
  let speed = 0

  const handleKeyDown = (event: KeyboardEvent) => {
    activeKeys.add(normaliseKey(event.key))
  }

  const handleKeyUp = (event: KeyboardEvent) => {
    activeKeys.delete(normaliseKey(event.key))
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
  }

  const forwardKeys = ['w', 'arrowup']
  const backwardKeys = ['s', 'arrowdown']
  const leftKeys = ['a', 'arrowleft']
  const rightKeys = ['d', 'arrowright']

  const step = (delta: number, object: THREE.Object3D) => {
    //1.- Resolve the forward and turning intents, mirroring both WASD and arrow-key input for accessibility.
    const forwardIntent = (forwardKeys.some((key) => activeKeys.has(key)) ? 1 : 0) -
      (backwardKeys.some((key) => activeKeys.has(key)) ? 1 : 0)
    const turnIntent = (leftKeys.some((key) => activeKeys.has(key)) ? 1 : 0) -
      (rightKeys.some((key) => activeKeys.has(key)) ? 1 : 0)

    //2.- Adjust the craft speed, clamp the magnitude, and apply exponential damping for smoother motion.
    speed += forwardIntent * acceleration * delta
    speed = Math.max(-maxSpeed, Math.min(maxSpeed, speed))
    speed *= damping ** (delta * 60)

    //3.- Rotate the craft and translate along the derived planar heading.
    object.rotation.y += turnIntent * turnSpeed * delta
    const headingX = -Math.sin(object.rotation.y)
    const headingZ = -Math.cos(object.rotation.y)
    object.position.x += headingX * speed * delta
    object.position.z += headingZ * speed * delta

    //4.- Limit the craft to the battlefield bounds so players remain inside the generated arena.
    object.position.x = Math.max(-bounds, Math.min(bounds, object.position.x))
    object.position.z = Math.max(-bounds, Math.min(bounds, object.position.z))
    object.position.y = Math.max(groundY + 1, Math.min(ceilingY - 1, object.position.y))
  }

  const dispose = () => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
    activeKeys.clear()
  }

  return {
    step,
    dispose,
    getSpeed: () => speed,
  }
}

