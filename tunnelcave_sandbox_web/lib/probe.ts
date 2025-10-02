import type { RingStation } from "./terrain";
import { add, cross, length, scale, Vec3 } from "./vector";

function radialDistance(ring: RingStation, angle: number): number {
  const radius = ring.radius + ring.roughness(angle);
  return Math.max(0.5, radius);
}

export interface RingClearance {
  minDiameter: number;
  meanDiameter: number;
  stdDiameter: number;
  bestAngle: number;
}

export function analyzeRing(ring: RingStation, samples = 16): RingClearance {
  const diameters: number[] = [];
  let best = { diameter: 0, angle: 0 };
  for (let i = 0; i < samples; i += 1) {
    const theta = (i / samples) * Math.PI * 2;
    const diameter = radialDistance(ring, theta) + radialDistance(ring, theta + Math.PI);
    diameters.push(diameter);
    if (diameter > best.diameter) {
      best = { diameter, angle: theta };
    }
  }
  const sum = diameters.reduce((acc, v) => acc + v, 0);
  const mean = sum / diameters.length;
  const variance = diameters.reduce((acc, v) => acc + (v - mean) * (v - mean), 0) / diameters.length;
  return {
    minDiameter: Math.min(...diameters),
    meanDiameter: mean,
    stdDiameter: Math.sqrt(variance),
    bestAngle: best.angle
  };
}

export interface SpawnPose {
  ringIndex: number;
  position: Vec3;
  forward: Vec3;
  right: Vec3;
  up: Vec3;
  rollHint: number;
}

export function chooseSpawn(rings: RingStation[], craftRadius: number): SpawnPose | null {
  const safetyPadding = 0.75;
  let bestScore = -Infinity;
  let bestPose: SpawnPose | null = null;
  for (const ring of rings) {
    const clearance = analyzeRing(ring);
    const angle = clearance.bestAngle;
    const surfaceForward = radialDistance(ring, angle);
    const surfaceBackward = radialDistance(ring, angle + Math.PI);
    const forwardRoom = surfaceForward - (craftRadius + safetyPadding);
    const backwardRoom = surfaceBackward - (craftRadius + safetyPadding);
    if (forwardRoom <= 0 || backwardRoom <= 0) {
      continue;
    }

    let radial = add(
      scale(ring.frame.right, Math.cos(angle)),
      scale(ring.frame.up, Math.sin(angle))
    );
    const radialLen = length(radial);
    if (radialLen > 1e-5) {
      radial = scale(radial, 1 / radialLen);
    } else {
      radial = ring.frame.up;
    }

    const offset = (forwardRoom - backwardRoom) * 0.5;
    const position = add(ring.position, scale(radial, offset));
    const forward = ring.frame.forward;
    let right = cross(forward, radial);
    const rightLen = length(right);
    if (rightLen > 1e-5) {
      right = scale(right, 1 / rightLen);
    } else {
      right = ring.frame.right;
    }
    let up = cross(right, forward);
    const upLen = length(up);
    if (upLen > 1e-5) {
      up = scale(up, 1 / upLen);
    } else {
      up = ring.frame.up;
    }

    const balancedClearance = Math.min(forwardRoom, backwardRoom);
    const score = balancedClearance + clearance.meanDiameter - clearance.stdDiameter * 0.35;
    if (score > bestScore) {
      bestScore = score;
      bestPose = { ringIndex: ring.index, position, forward, right, up, rollHint: angle };
    }
  }
  return bestPose;
}
