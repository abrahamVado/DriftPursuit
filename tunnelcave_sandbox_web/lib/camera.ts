import { add, scale, Vec3 } from "./vector";

export type CameraMode = "first" | "second" | "third";

export interface CameraRig {
  position: Vec3;
  target: Vec3;
}

export interface FollowProfile {
  followDistance: number;
  heightOffset: number;
  lateralOffset: number;
  lookAhead: number;
}

export interface FirstPersonProfile {
  forwardOffset: number;
  heightOffset: number;
  lookAhead: number;
}

export interface CameraParams {
  smoothing: number;
  collisionBuffer: number;
  firstPerson: FirstPersonProfile;
  secondPerson: FollowProfile;
  thirdPerson: FollowProfile;
}

export interface CameraGoal {
  position: Vec3;
  target: Vec3;
}

function clampAbs(value: number, limit: number) {
  if (limit <= 0) return 0;
  return Math.max(-limit, Math.min(limit, value));
}

function ensurePositive(value: number, fallback: number) {
  return value > 0 ? value : fallback;
}

export function createCameraRig(initialPosition: Vec3): CameraRig {
  return {
    position: [...initialPosition],
    target: [...initialPosition]
  };
}

export function computeCameraGoal(
  craftPosition: Vec3,
  forward: Vec3,
  right: Vec3,
  up: Vec3,
  params: CameraParams,
  mode: CameraMode,
  ringRadius: number,
  roughAmp: number
): CameraGoal {
  const clearance = Math.max(0, ringRadius - params.collisionBuffer - roughAmp);
  if (mode === "first") {
    const cockpit = add(
      add(craftPosition, scale(forward, params.firstPerson.forwardOffset)),
      scale(up, params.firstPerson.heightOffset)
    );
    const look = add(cockpit, scale(forward, ensurePositive(params.firstPerson.lookAhead, 5)));
    return { position: cockpit, target: look };
  }

  const profile = mode === "second" ? params.secondPerson : params.thirdPerson;
  const retreat = Math.min(profile.followDistance, clearance);
  if (retreat <= params.collisionBuffer * 0.25) {
    return computeCameraGoal(craftPosition, forward, right, up, params, "first", ringRadius, roughAmp);
  }
  const position = add(
    add(
      add(craftPosition, scale(forward, -retreat)),
      scale(up, clampAbs(profile.heightOffset, clearance * 0.75))
    ),
    scale(right, clampAbs(profile.lateralOffset, clearance * 0.75))
  );
  const look = add(craftPosition, scale(forward, ensurePositive(profile.lookAhead, 10)));
  return { position, target: look };
}

export function updateCameraRig(
  rig: CameraRig,
  craftPosition: Vec3,
  forward: Vec3,
  right: Vec3,
  up: Vec3,
  params: CameraParams,
  dt: number,
  mode: CameraMode,
  ringRadius: number,
  roughAmp: number
) {
  const goal = computeCameraGoal(craftPosition, forward, right, up, params, mode, ringRadius, roughAmp);
  const alpha = dt <= 0 ? 1 : 1 - Math.exp(-params.smoothing * dt);
  rig.position[0] += (goal.position[0] - rig.position[0]) * alpha;
  rig.position[1] += (goal.position[1] - rig.position[1]) * alpha;
  rig.position[2] += (goal.position[2] - rig.position[2]) * alpha;
  rig.target[0] += (goal.target[0] - rig.target[0]) * alpha;
  rig.target[1] += (goal.target[1] - rig.target[1]) * alpha;
  rig.target[2] += (goal.target[2] - rig.target[2]) * alpha;
}
