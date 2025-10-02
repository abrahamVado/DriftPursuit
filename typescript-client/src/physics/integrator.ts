export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface OrientationDeg {
  yawDeg: number;
  pitchDeg: number;
  rollDeg: number;
}

export interface VehicleStateLike {
  position?: Vec3;
  velocity?: Vec3;
  orientation?: OrientationDeg;
  angularVelocity?: Vec3;
  flightAssistEnabled?: boolean;
}

// wrapAngleDeg normalizes an angle into the [-180, 180) interval.
export function wrapAngleDeg(angle: number): number {
  //1.- Use modulo arithmetic to prevent unbounded growth over long runs.
  const wrapped = ((angle + 180) % 360 + 360) % 360;
  return wrapped - 180;
}

// integrateLinear advances a position using simple Euler integration.
export function integrateLinear(position: Vec3 | undefined, velocity: Vec3 | undefined, step: number): void {
  //1.- Guard against invalid inputs so callers can pass partial state objects.
  if (!position || !velocity || !(step > 0)) {
    return;
  }
  //2.- Apply the displacement derived from velocity * dt on each axis.
  position.x += velocity.x * step;
  position.y += velocity.y * step;
  position.z += velocity.z * step;
}

// integrateAngular updates Euler angles from angular velocity in degrees/s.
export function integrateAngular(orientation: OrientationDeg | undefined, angularVelocity: Vec3 | undefined, step: number): void {
  //1.- Skip when the vehicle lacks rotation data or the step is degenerate.
  if (!orientation || !angularVelocity || !(step > 0)) {
    return;
  }
  //2.- Add the integrated deltas and wrap to keep the values bounded.
  orientation.yawDeg = wrapAngleDeg(orientation.yawDeg + angularVelocity.y * step);
  orientation.pitchDeg = wrapAngleDeg(orientation.pitchDeg + angularVelocity.x * step);
  orientation.rollDeg = wrapAngleDeg(orientation.rollDeg + angularVelocity.z * step);
}

// integrateVehicle mutates the provided state with both linear and angular updates.
export function integrateVehicle(state: VehicleStateLike | undefined, step: number): void {
  //1.- Support defensive callers by no-oping on invalid state or timestep.
  if (!state || !(step > 0)) {
    return;
  }
  //2.- Apply both translation and rotation integration in place.
  integrateLinear(state.position, state.velocity, step);
  integrateAngular(state.orientation, state.angularVelocity, step);
}

export class GuidanceSpline {
  private readonly nodes: Vec3[];

  constructor(nodes: Vec3[]) {
    //1.- Require at least two nodes so a tangent can be computed.
    if (nodes.length < 2) {
      throw new Error("GuidanceSpline requires at least two nodes");
    }
    //2.- Copy the input to prevent external mutation after construction.
    this.nodes = nodes.map((node) => ({ ...node }));
  }

  private tangentFor(position: Vec3): Vec3 | undefined {
    //1.- Track the closest segment to the provided position.
    let bestDistance = Number.POSITIVE_INFINITY;
    let bestTangent: Vec3 | undefined;
    for (let i = 0; i < this.nodes.length - 1; i += 1) {
      const a = this.nodes[i];
      const b = this.nodes[i + 1];
      const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
      const abLenSquared = ab.x * ab.x + ab.y * ab.y + ab.z * ab.z;
      if (abLenSquared === 0) {
        continue;
      }
      const ap = { x: position.x - a.x, y: position.y - a.y, z: position.z - a.z };
      let t = (ap.x * ab.x + ap.y * ab.y + ap.z * ab.z) / abLenSquared;
      if (t < 0) {
        t = 0;
      } else if (t > 1) {
        t = 1;
      }
      const closest = { x: a.x + ab.x * t, y: a.y + ab.y * t, z: a.z + ab.z * t };
      const dx = position.x - closest.x;
      const dy = position.y - closest.y;
      const dz = position.z - closest.z;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (distance < bestDistance) {
        bestDistance = distance;
        const length = Math.sqrt(abLenSquared);
        bestTangent = { x: ab.x / length, y: ab.y / length, z: ab.z / length };
      }
    }
    return bestTangent;
  }

  align(state: VehicleStateLike): void {
    //1.- Only operate when both the spline and vehicle position are available.
    if (!state.position) {
      return;
    }
    const tangent = this.tangentFor(state.position);
    if (!tangent) {
      return;
    }
    //2.- Compute yaw and pitch angles from the tangent direction.
    const horizontal = Math.sqrt(tangent.x * tangent.x + tangent.z * tangent.z);
    const yaw = horizontal === 0 ? 0 : (Math.atan2(tangent.x, tangent.z) * 180) / Math.PI;
    const pitch = (Math.atan2(tangent.y, horizontal) * 180) / Math.PI;
    //3.- Allocate orientation if necessary and zero angular velocity for stability.
    if (!state.orientation) {
      state.orientation = { yawDeg: 0, pitchDeg: 0, rollDeg: 0 };
    }
    state.orientation.yawDeg = wrapAngleDeg(yaw);
    state.orientation.pitchDeg = wrapAngleDeg(pitch);
    state.orientation.rollDeg = 0;
    if (state.angularVelocity) {
      state.angularVelocity.x = 0;
      state.angularVelocity.y = 0;
      state.angularVelocity.z = 0;
    }
  }
}

// applyAssistAlignment conditionally aligns the craft when assist is active.
export function applyAssistAlignment(state: VehicleStateLike | undefined, spline: GuidanceSpline | undefined): void {
  //1.- Skip unless assist mode is toggled and the spline is available.
  if (!state || !state.flightAssistEnabled || !spline) {
    return;
  }
  //2.- Delegate to the spline alignment helper.
  spline.align(state);
}
