// lib/centerline.ts
import * as THREE from "three";

/**
 * Centerline: exposes arc-length parameterization over a 3D path.
 * Methods:
 *  - centerAt(s): world-space point at arc-length s
 *  - tangentAt(s): unit tangent at arc-length s
 *  - closestS(p): arc-length s of the closest point on the curve to p
 *  - length: total arc-length of the curve
 */
export class Centerline {
  private curve: THREE.CatmullRomCurve3;
  private lengths: number[]; // cumulative segment lengths for fast s->u mapping
  readonly length: number;

  constructor(points: THREE.Vector3[], options?: { closed?: boolean; tension?: number }) {
    if (points.length < 2) throw new Error("Centerline requires at least 2 points");
    this.curve = new THREE.CatmullRomCurve3(points, !!options?.closed, "catmullrom", options?.tension ?? 0.0);
    // Precompute arc length samples
    // THREE stores cumulative lengths for getUtoTmapping/getPointAt:
    const divisions = Math.max(2000, points.length * 20);
    this.lengths = this.curve.getLengths(divisions); // cumulative [0..length]
    this.length = this.lengths[this.lengths.length - 1];
  }

  // Map arc-length s (0..length) -> normalized u (0..1) using internal table
  private sToU(s: number): number {
    const clamped = THREE.MathUtils.clamp(s, 0, this.length);
    return this.curve.getUtoTmapping(clamped / this.length);
  }

  centerAt(s: number, out = new THREE.Vector3()): THREE.Vector3 {
    const u = this.sToU(s);
    return this.curve.getPointAt(u, out);
  }

  tangentAt(s: number, out = new THREE.Vector3()): THREE.Vector3 {
    const u = this.sToU(s);
    return this.curve.getTangentAt(u, out).normalize();
  }

  /**
   * Approximate closest arc-length using coarse sampling + local refine.
   * Good enough for guidance; can be replaced with KD-tree if needed.
   */
  closestS(p: THREE.Vector3): number {
    const tmp = new THREE.Vector3();
    const N = 512; // samples
    let bestU = 0;
    let bestD2 = Infinity;
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      this.curve.getPointAt(u, tmp);
      const d2 = tmp.distanceToSquared(p);
      if (d2 < bestD2) { bestD2 = d2; bestU = u; }
    }
    // Optional: refine around bestU
    const refineIters = 3;
    let u0 = Math.max(0, bestU - 1 / N);
    let u1 = Math.min(1, bestU + 1 / N);
    for (let k = 0; k < refineIters; k++) {
      let bestLocalU = u0, bestLocalD2 = Infinity;
      const M = 20;
      for (let j = 0; j <= M; j++) {
        const u = THREE.MathUtils.lerp(u0, u1, j / M);
        this.curve.getPointAt(u, tmp);
        const d2 = tmp.distanceToSquared(p);
        if (d2 < bestLocalD2) { bestLocalD2 = d2; bestLocalU = u; }
      }
      const span = (u1 - u0) * 0.35;
      u0 = THREE.MathUtils.clamp(bestLocalU - span, 0, 1);
      u1 = THREE.MathUtils.clamp(bestLocalU + span, 0, 1);
      bestU = bestLocalU;
    }
    // Convert normalized u -> arc-length s
    const s = bestU * this.length;
    return s;
  }
}
