import { add, scale, Vec3 } from "./vector";

export interface CameraRig {
  position: Vec3;
  target: Vec3;
}

export interface CameraParams {
  followDistance: number;
  heightOffset: number;
  lateralOffset: number;
  smoothing: number;
}

export function createCameraRig(initialPosition: Vec3): CameraRig {
  return {
    position: [...initialPosition],
    target: [...initialPosition]
  };
}

export function updateCameraRig(
  rig: CameraRig,
  craftPosition: Vec3,
  forward: Vec3,
  right: Vec3,
  up: Vec3,
  params: CameraParams,
  dt: number
) {
  const desired = add(
    add(add(craftPosition, scale(forward, -params.followDistance)), scale(up, params.heightOffset)),
    scale(right, params.lateralOffset)
  );
  const alpha = 1 - Math.exp(-params.smoothing * dt);
  rig.position[0] += (desired[0] - rig.position[0]) * alpha;
  rig.position[1] += (desired[1] - rig.position[1]) * alpha;
  rig.position[2] += (desired[2] - rig.position[2]) * alpha;
  rig.target[0] += (craftPosition[0] - rig.target[0]) * alpha;
  rig.target[1] += (craftPosition[1] - rig.target[1]) * alpha;
  rig.target[2] += (craftPosition[2] - rig.target[2]) * alpha;
}
