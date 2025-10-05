export class Color {
  //1.- Minimal color container mirrors the three.js constructor signature.
  constructor(public value: number | string = 0xffffff) {}

  set(value: number | string): this {
    this.value = value
    return this
  }
}

export class Vector3 {
  //1.- Track the vector components to support translation interpolation.
  x: number
  y: number
  z: number

  constructor(x = 0, y = 0, z = 0) {
    this.x = x
    this.y = y
    this.z = z
  }

  set(x: number, y: number, z: number): this {
    this.x = x
    this.y = y
    this.z = z
    return this
  }

  clone(): Vector3 {
    return new Vector3(this.x, this.y, this.z)
  }

  add(vector: Vector3): this {
    this.x += vector.x
    this.y += vector.y
    this.z += vector.z
    return this
  }

  copy(other: Vector3): this {
    return this.set(other.x, other.y, other.z)
  }

  lerp(target: Vector3, alpha: number): this {
    this.x += (target.x - this.x) * alpha
    this.y += (target.y - this.y) * alpha
    this.z += (target.z - this.z) * alpha
    return this
  }
}

export class Euler {
  //1.- Represent pitch/yaw/roll with an order string for quaternion conversion.
  x: number
  y: number
  z: number
  order: string

  constructor(x = 0, y = 0, z = 0, order = 'XYZ') {
    this.x = x
    this.y = y
    this.z = z
    this.order = order
  }

  set(x: number, y: number, z: number, order = this.order): this {
    this.x = x
    this.y = y
    this.z = z
    this.order = order
    return this
  }
}

export class Quaternion {
  //1.- Store quaternion components to mirror three.js' public interface.
  x = 0
  y = 0
  z = 0
  w = 1

  set(x: number, y: number, z: number, w: number): this {
    this.x = x
    this.y = y
    this.z = z
    this.w = w
    return this
  }

  copy(other: Quaternion): this {
    return this.set(other.x, other.y, other.z, other.w)
  }

  setFromEuler(euler: Euler): this {
    const c1 = Math.cos(euler.x / 2)
    const c2 = Math.cos(euler.y / 2)
    const c3 = Math.cos(euler.z / 2)
    const s1 = Math.sin(euler.x / 2)
    const s2 = Math.sin(euler.y / 2)
    const s3 = Math.sin(euler.z / 2)

    this.x = s1 * c2 * c3 + c1 * s2 * s3
    this.y = c1 * s2 * c3 - s1 * c2 * s3
    this.z = c1 * c2 * s3 + s1 * s2 * c3
    this.w = c1 * c2 * c3 - s1 * s2 * s3
    return this
  }

  slerp(target: Quaternion, alpha: number): this {
    //1.- Perform a simple normalized linear interpolation for determinism in tests.
    this.x += (target.x - this.x) * alpha
    this.y += (target.y - this.y) * alpha
    this.z += (target.z - this.z) * alpha
    this.w += (target.w - this.w) * alpha
    const length = Math.hypot(this.x, this.y, this.z, this.w) || 1
    return this.set(this.x / length, this.y / length, this.z / length, this.w / length)
  }
}

export class FogExp2 {
  //1.- Preserve fog parameters so consumers can validate density settings.
  constructor(public color: Color, public density: number) {}
}

export class Object3D {
  //1.- Emulate the scene graph hierarchy with parent/child relationships.
  children: Object3D[] = []
  parent: Object3D | null = null
  position = new Vector3()
  quaternion = new Quaternion()
  rotation = new Euler()
  scale = new Vector3(1, 1, 1)
  matrixAutoUpdate = true
  userData: Record<string, unknown> = {}
  visible = true
  name = ''

  add(...objects: Object3D[]): this {
    for (const object of objects) {
      object.parent = this
      this.children.push(object)
    }
    return this
  }

  remove(...objects: Object3D[]): this {
    this.children = this.children.filter((candidate) => !objects.includes(candidate))
    for (const object of objects) {
      if (object.parent === this) {
        object.parent = null
      }
    }
    return this
  }

  removeFromParent(): this {
    if (this.parent) {
      this.parent.remove(this)
    }
    return this
  }

  updateMatrix(): void {
    //1.- No-op placeholder to keep the API compatible with three.js.
  }

  updateMatrixWorld(): void {
    //1.- Match three.js API while staying inert for tests.
  }
}

export class Group extends Object3D {}

export class Material {
  //1.- Allow resources to be released explicitly in cleanup routines.
  dispose(): void {}
}

export class Mesh extends Object3D {
  //1.- Persist geometry and material references for metadata access.
  geometry: unknown
  material: unknown

  constructor(geometry?: unknown, material?: unknown) {
    super()
    this.geometry = geometry
    this.material = material
  }

  clone(): Mesh {
    const copy = new Mesh(this.geometry, this.material)
    copy.position = new Vector3(this.position.x, this.position.y, this.position.z)
    copy.rotation = new Euler(this.rotation.x, this.rotation.y, this.rotation.z, this.rotation.order)
    copy.scale = new Vector3(this.scale.x, this.scale.y, this.scale.z)
    copy.userData = { ...this.userData }
    return copy
  }
}

export class Points extends Object3D {
  //1.- Support particle systems with geometry/material references for assertions.
  constructor(public geometry: BufferGeometry, public material: Material) {
    super()
  }
}

export class MeshStandardMaterial extends Material {
  //1.- Store the options so tests can inspect them if required.
  constructor(public parameters: Record<string, unknown> = {}) {
    super()
  }
}

export class PointsMaterial extends Material {
  //1.- Mirror the points material interface for additive particle effects.
  constructor(public parameters: Record<string, unknown> = {}) {
    super()
  }
}

export class AmbientLight extends Object3D {
  //1.- Preserve light metadata so tests can validate intensity tuning.
  constructor(public color: Color, public intensity: number) {
    super()
  }
}

export class DirectionalLight extends Object3D {
  //1.- Mimic directional light placement for scene graph assertions.
  constructor(public color: Color, public intensity: number) {
    super()
  }
}

export class Scene extends Object3D {
  //1.- Track fog assignment for atmospheric previews.
  fog: FogExp2 | null = null
}

export class PerspectiveCamera extends Object3D {
  //1.- Mirror camera properties used during preview animation.
  aspect: number

  constructor(public fov: number, aspect: number, public near: number, public far: number) {
    super()
    this.aspect = aspect
  }

  lookAt(): void {
    //1.- No-op placeholder to satisfy the interface.
  }

  updateProjectionMatrix(): void {
    //1.- Mocked camera does not need to recalculate matrices.
  }
}

export const MathUtils = {
  //1.- Offer a deterministic conversion for Euler helper functions.
  degToRad(degrees: number): number {
    return (degrees * Math.PI) / 180
  },
}

export class BufferAttribute {
  //1.- Lightweight attribute helper exposing per-axis accessors.
  array: Float32Array
  itemSize: number
  count: number
  needsUpdate = false

  constructor(array: ArrayLike<number>, itemSize: number) {
    this.array = array instanceof Float32Array ? array : new Float32Array(array)
    this.itemSize = itemSize
    this.count = this.array.length / itemSize
  }

  getX(index: number): number {
    return this.array[index * this.itemSize]
  }

  getY(index: number): number {
    return this.array[index * this.itemSize + 1]
  }

  getZ(index: number): number {
    return this.array[index * this.itemSize + 2]
  }

  setX(index: number, value: number): this {
    this.array[index * this.itemSize] = value
    return this
  }

  setY(index: number, value: number): this {
    this.array[index * this.itemSize + 1] = value
    return this
  }

  setZ(index: number, value: number): this {
    this.array[index * this.itemSize + 2] = value
    return this
  }
}

export class Float32BufferAttribute extends BufferAttribute {}

export class BufferGeometry {
  //1.- Track indices and attributes to imitate three.js geometry containers.
  index: number[] | null = null
  attributes: Record<string, unknown> = {}

  setIndex(index: number[] | ArrayLike<number>): this {
    this.index = Array.from(index as number[])
    return this
  }

  setAttribute(name: string, attribute: unknown): this {
    this.attributes[name] = attribute
    return this
  }

  getAttribute(name: string): unknown {
    return this.attributes[name]
  }

  computeVertexNormals(): this {
    return this
  }

  translate(): this {
    return this
  }

  center(): this {
    return this
  }
}

export class Shape {
  //1.- Record 2D contour points to emulate polygon extrusion inputs.
  points: { x: number; y: number }[] = []

  moveTo(x: number, y: number): this {
    this.points = [{ x, y }]
    return this
  }

  lineTo(x: number, y: number): this {
    this.points.push({ x, y })
    return this
  }
}

export class ExtrudeGeometry extends BufferGeometry {
  //1.- Store references so tests can confirm extrusion parameters.
  constructor(public shape: Shape, public settings: Record<string, unknown>) {
    super()
  }
}

export class TorusGeometry extends BufferGeometry {
  //1.- Capture torus dimensions for inspection.
  constructor(public radius: number, public tube: number, public radialSegments: number, public tubularSegments: number) {
    super()
  }
}

export class SphereGeometry extends BufferGeometry {
  //1.- Maintain radius metadata for spherical crystal generation.
  constructor(public radius: number, public widthSegments: number, public heightSegments: number) {
    super()
  }
}

export class ConeGeometry extends BufferGeometry {
  //1.- Capture cone dimensions for stalactite generation assertions.
  constructor(public radius: number, public height: number, public radialSegments: number) {
    super()
  }
}

export class CatmullRomCurve3 {
  //1.- Sample along stored waypoints to approximate spline behaviour for tests.
  constructor(private readonly points: Vector3[], private readonly closed = false) {}

  getPointAt(t: number): Vector3 {
    const total = this.points.length
    if (total === 0) {
      return new Vector3()
    }
    const scaled = t * (total - 1)
    const index = Math.floor(scaled)
    const alpha = scaled - index
    const start = this.points[index % total]
    const end = this.points[(index + 1) % total]
    return new Vector3(
      start.x + (end.x - start.x) * alpha,
      start.y + (end.y - start.y) * alpha,
      start.z + (end.z - start.z) * alpha
    )
  }
}

export class TubeGeometry extends BufferGeometry {
  //1.- Prepare placeholder vertex data so attribute warping logic can run in tests.
  parameters: { path: CatmullRomCurve3; tubularSegments: number; radialSegments: number }

  constructor(path: CatmullRomCurve3, tubularSegments: number, radius: number, radialSegments: number) {
    super()
    this.parameters = { path, tubularSegments, radialSegments }
    const vertexCount = Math.max(1, tubularSegments) * Math.max(1, radialSegments)
    const array = new Float32Array(vertexCount * 3)
    for (let index = 0; index < vertexCount; index += 1) {
      const base = index * 3
      array[base] = index
      array[base + 1] = index
      array[base + 2] = index
    }
    this.setAttribute('position', new BufferAttribute(array, 3))
  }
}
