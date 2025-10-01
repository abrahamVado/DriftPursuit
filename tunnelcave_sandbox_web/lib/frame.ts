import { angleBetween, cross, dot, length, normalize, scale, Vec3 } from "./vector";

export interface OrthonormalFrame {
  forward: Vec3;
  right: Vec3;
  up: Vec3;
}

export function createInitialFrame(direction: Vec3): OrthonormalFrame {
  const forward = normalize(direction);
  const hint: Vec3 = Math.abs(forward[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  let right = normalize(cross(hint, forward));
  if (length(right) === 0) {
    right = [1, 0, 0];
  }
  const up = normalize(cross(forward, right));
  return { forward, right, up };
}

export function transportFrame(
  frame: OrthonormalFrame,
  newForward: Vec3
): OrthonormalFrame {
  const fOld = frame.forward;
  const fNew = normalize(newForward);
  const angle = angleBetween(fOld, fNew);
  if (angle < 1e-5) {
    return { forward: fNew, right: frame.right, up: frame.up };
  }
  const axis = cross(fOld, fNew);
  const axisLen = length(axis);
  if (axisLen === 0) {
    return { forward: fNew, right: frame.right, up: frame.up };
  }
  const k = [axis[0] / axisLen, axis[1] / axisLen, axis[2] / axisLen] as Vec3;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  const rotate = (v: Vec3): Vec3 => {
    const term1 = scale(v, cos);
    const term2 = scale(cross(k, v), sin);
    const term3 = scale(k, dot(k, v) * (1 - cos));
    return [term1[0] + term2[0] + term3[0], term1[1] + term2[1] + term3[1], term1[2] + term2[2] + term3[2]];
  };

  const right = normalize(rotate(frame.right));
  const up = normalize(rotate(frame.up));
  return { forward: fNew, right, up };
}
