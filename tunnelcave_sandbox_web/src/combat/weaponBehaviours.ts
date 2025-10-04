import { decoyBalance, resolveWeaponBalance } from "@client/gameplayConfig";
import type { ResolvedWeaponBalance } from "@client/gameplayConfig";

import { createHash } from "node:crypto";

export interface WeaponFirePlan {
  //1.- Behaviour snapshot mirrored from the shared gameplay configuration.
  behaviour: ResolvedWeaponBalance;
  //2.- Projectile flight time expressed in seconds for ballistic archetypes.
  travelTimeSeconds: number;
  //3.- Beam persistence in seconds for hitscan archetypes.
  beamDurationSeconds: number;
  //4.- Probability that an active decoy spoofs missiles using this plan.
  decoyBreakProbability: number;
}

export interface MissileSpoofOptions {
  //1.- Shared match seed ensuring deterministic ECM resolution between client and server.
  matchSeed: string;
  //2.- Unique missile identifier emitted by the projectile system.
  missileId: string;
  //3.- Target entity identifier the missile is pursuing.
  targetId: string;
  //4.- Whether a decoy is active when the missile evaluates the spoof roll.
  decoyActive: boolean;
  //5.- Optional probability override for special missiles with custom ECM tuning.
  breakProbabilityOverride?: number;
}

export interface DecoyActivationPlan {
  //1.- Duration in seconds that the decoy remains active.
  durationSeconds: number;
  //2.- Spoof probability applied to missiles while the decoy is active.
  breakProbability: number;
}

const ECM_NAMESPACE = "combat.ecm\u0000";

export function planWeaponFire(weaponId: string, distanceMeters: number): WeaponFirePlan {
  //1.- Resolve the shared weapon behaviour and merge archetype defaults with variant overrides.
  const behaviour = resolveWeaponBalance(weaponId);
  const projectileSpeed = behaviour.projectileSpeed ?? 0;
  const travelTimeSeconds = projectileSpeed > 0 && distanceMeters > 0 ? distanceMeters / projectileSpeed : 0;
  const beamDurationSeconds = behaviour.beamDurationSeconds ?? 0;
  const decoyBreakProbability = behaviour.decoyBreakProbability ?? 0;
  //2.- Freeze the plan so presentation logic cannot mutate shared behaviour at runtime.
  return Object.freeze({
    behaviour,
    travelTimeSeconds,
    beamDurationSeconds,
    decoyBreakProbability,
  });
}

export function planDecoyActivation(): DecoyActivationPlan {
  //1.- Return a frozen activation plan so HUD widgets operate on immutable data.
  return Object.freeze({
    durationSeconds: decoyBalance.activationDurationSeconds,
    breakProbability: decoyBalance.breakProbability,
  });
}

export function resolveMissileSpoof(plan: WeaponFirePlan, options: MissileSpoofOptions): boolean {
  //1.- Skip spoof resolution when no decoy is active or the archetype does not use missiles.
  const probability = options.breakProbabilityOverride ?? plan.decoyBreakProbability;
  if (!options.decoyActive || !probability || probability <= 0) {
    return false;
  }
  if (!options.matchSeed || !options.missileId || !options.targetId) {
    return false;
  }
  //2.- Compute the deterministic random roll using the same recipe as the Go runtime.
  const roll = deterministicRoll(options.matchSeed, options.missileId, options.targetId);
  return roll < clampProbability(probability);
}

function deterministicRoll(matchSeed: string, missileId: string, targetId: string): number {
  //1.- Hash the identifiers so identical tuples generate the same pseudo-random sequence.
  const hash = createHash("sha256");
  hash.update(ECM_NAMESPACE, "utf8");
  hash.update(matchSeed, "utf8");
  hash.update("\u0000", "utf8");
  hash.update(missileId, "utf8");
  hash.update("\u0000", "utf8");
  hash.update(targetId, "utf8");
  const digest = hash.digest();
  //2.- Consume eight byte chunks until a non-zero seed emerges, mirroring the Go routine.
  for (let offset = 0; offset + 8 <= digest.length; offset += 8) {
    const seed = digest.readBigUInt64LE(offset);
    if (seed !== 0n) {
      return numberFromSeed(seed);
    }
  }
  return numberFromSeed(1n);
}

function numberFromSeed(seed: bigint): number {
  //1.- Convert the 64-bit seed into a floating point number within [0, 1).
  const max = BigInt(1) << BigInt(53);
  const masked = seed & (max - BigInt(1));
  return Number(masked) / Number(max);
}

function clampProbability(probability: number): number {
  //1.- Keep the probability bounded to avoid NaNs or infinities from surfacing in consumers.
  if (!Number.isFinite(probability)) {
    return 0;
  }
  if (probability < 0) {
    return 0;
  }
  if (probability > 1) {
    return 1;
  }
  return probability;
}
