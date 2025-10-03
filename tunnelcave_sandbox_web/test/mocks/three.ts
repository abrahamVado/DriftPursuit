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

export class MeshStandardMaterial {
  //1.- Store the options so tests can inspect them if required.
  constructor(public parameters: Record<string, unknown> = {}) {}
}

export const MathUtils = {
  //1.- Offer a deterministic conversion for Euler helper functions.
  degToRad(degrees: number): number {
    return (degrees * Math.PI) / 180
  },
}

export class Float32BufferAttribute {
  //1.- Provide minimal attribute storage for BufferGeometry usage.
  constructor(public array: ArrayLike<number>, public itemSize: number) {}
}

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
