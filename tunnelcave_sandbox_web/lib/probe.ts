import type { RingStation } from "./terrain";
import { add, normalize, scale, Vec3 } from "./vector";

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
  ringRadius: number;
}

export function chooseSpawn(rings: RingStation[], craftRadius: number): SpawnPose | null {
  let bestScore = -Infinity;
  let best: { ring: RingStation; clearance: RingClearance } | null = null;
  for (const ring of rings) {
    const clearance = analyzeRing(ring);
    const margin = clearance.minDiameter * 0.5 - craftRadius;
    if (margin < 0.5) {
      continue;
    }
    const score = clearance.meanDiameter - clearance.stdDiameter * 0.5 + margin * 2;
    if (score > bestScore) {
      bestScore = score;
      best = { ring, clearance };
    }
  }
  if (!best) {
    return null;
  }
  const { ring, clearance } = best;
  const angle = clearance.bestAngle;
  const offset = add(
    scale(ring.frame.right, Math.cos(angle) * (clearance.minDiameter * 0.25)),
    scale(ring.frame.up, Math.sin(angle) * (clearance.minDiameter * 0.25))
  );
  const position = add(ring.position, offset);
  const forward = ring.frame.forward;
  const right = normalize(scale(ring.frame.right, Math.cos(angle)));
  const up = normalize(scale(ring.frame.up, Math.sin(angle)));
  return {
    ringIndex: ring.index,
    position,
    forward,
    right,
    up,
    rollHint: angle,
    ringRadius: ring.maxRadius
  };
}
