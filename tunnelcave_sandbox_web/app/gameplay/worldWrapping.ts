import * as THREE from 'three'

//1.- Wrap a scalar coordinate into the interval [-size/2, size/2) so tiling worlds stay seamless.
export function wrapToInterval(value: number, size: number): number {
  if (!Number.isFinite(size) || size <= 0) {
    return value
  }
  const half = size / 2
  const wrapped = ((value + half) % size + size) % size - half
  return wrapped
}

//2.- Compute the shortest wrapped delta so velocity calculations ignore seamless teleport seams.
export function wrappedDelta(current: number, previous: number, size: number): number {
  if (!Number.isFinite(size) || size <= 0) {
    return current - previous
  }
  let delta = current - previous
  const half = size / 2
  if (delta > half) {
    delta -= size
  } else if (delta < -half) {
    delta += size
  }
  return delta
}

//3.- Wrap a THREE vector in-place so each axis lands inside the repeating world tile.
export function wrapVector3(target: THREE.Vector3, size: number): void {
  target.x = wrapToInterval(target.x, size)
  target.y = target.y
  target.z = wrapToInterval(target.z, size)
}

