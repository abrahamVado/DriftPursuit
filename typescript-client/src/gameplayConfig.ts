import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface VehicleStats {
  maxSpeedMps: number;
  maxAngularSpeedDegPerSec: number;
  forwardAccelerationMps2: number;
  reverseAccelerationMps2: number;
  strafeAccelerationMps2: number;
  verticalAccelerationMps2: number;
  boostAccelerationMps2: number;
  boostDurationSeconds: number;
  boostCooldownSeconds: number;
}

const SKIFF_CONFIG_PATH = resolve(__dirname, "../../go-broker/internal/gameplay/skiff.json");
const SKIFF_LOADOUT_PATH = resolve(
  __dirname,
  "../../go-broker/internal/gameplay/skiff_loadouts.json",
);

export interface WeaponConfig {
  //1.- Track the weapon archetype so the HUD can surface the correct iconography.
  type: string;
  //2.- Capture the total ammunition or charge count bundled with the loadout.
  ammo: number;
}

export interface PassiveModifiers {
  //1.- Scale the linear velocity clamp derived from the base vehicle stats.
  speedMultiplier: number;
  //2.- Influence rotational and translational accelerations uniformly.
  agilityMultiplier: number;
  //3.- Apply a scalar to weapon damage values emitted by combat events.
  damageMultiplier: number;
  //4.- Adjust boost cooldown timings to reward efficiency focused kits.
  boostCooldownScale: number;
}

export interface VehicleLoadoutConfig {
  //1.- Stable identifier shared between the client UI and the broker runtime.
  id: string;
  //2.- Player facing label rendered in selection menus.
  displayName: string;
  //3.- Short description summarising the tactical role for the loadout.
  description: string;
  //4.- Relative asset path for the HUD icon representing the loadout.
  icon: string;
  //5.- Flag marking whether players can select the loadout in this build.
  selectable: boolean;
  //6.- Weapon bundle included with the loadout.
  weapons: readonly WeaponConfig[];
  //7.- Passive modifiers that transform physics and combat behaviour.
  passiveModifiers: PassiveModifiers;
}

interface SkiffLoadoutPayload {
  //1.- Match the on-disk JSON shape to keep parsing guarded and explicit.
  loadouts: VehicleLoadoutConfig[];
}

export interface GroundVehicleConfig {
  //1.- Expose descriptive metadata so future UI work can surface the upcoming roster.
  displayName: string;
  //2.- Flag whether the entry can be selected in the current build.
  selectable: boolean;
  //3.- Provide placeholder stats that will be replaced once design finalises the values.
  stats: VehicleStats;
  //4.- Human-readable note that explains why the vehicle remains disabled.
  notes: string;
}

function loadSkiffStats(): VehicleStats {
  //1.- Parse the shared JSON payload once so both runtimes agree on the numbers.
  const payload = readFileSync(SKIFF_CONFIG_PATH, "utf-8");
  const parsed = JSON.parse(payload) as VehicleStats;
  //2.- Freeze the result to prevent mutation that could desynchronise client and server.
  return Object.freeze(parsed) as VehicleStats;
}

export const skiffStats: VehicleStats = loadSkiffStats();

function loadSkiffLoadouts(): readonly VehicleLoadoutConfig[] {
  //1.- Mirror the Go runtime by parsing the shared JSON catalog exactly once.
  const payload = readFileSync(SKIFF_LOADOUT_PATH, "utf-8");
  const parsed = JSON.parse(payload) as SkiffLoadoutPayload;
  //2.- Freeze nested structures so caller code treats the payload as immutable data.
  return Object.freeze(
    parsed.loadouts.map((entry) => ({
      ...entry,
      weapons: Object.freeze(entry.weapons.map((weapon) => Object.freeze({ ...weapon }))),
      passiveModifiers: Object.freeze({ ...entry.passiveModifiers }),
    })),
  );
}

export const skiffLoadouts: readonly VehicleLoadoutConfig[] = loadSkiffLoadouts();

export function deriveStatsWithModifiers(base: VehicleStats, modifiers: PassiveModifiers): VehicleStats {
  //1.- Start from a shallow copy so downstream code receives an isolated structure.
  const adjusted = { ...base };
  //2.- Apply linear speed multiplier while guarding against invalid configuration.
  const speedMultiplier = modifiers.speedMultiplier > 0 ? modifiers.speedMultiplier : 1;
  adjusted.maxSpeedMps = base.maxSpeedMps * speedMultiplier;
  //3.- Scale rotational caps and all acceleration channels using the agility multiplier.
  const agilityMultiplier = modifiers.agilityMultiplier > 0 ? modifiers.agilityMultiplier : 1;
  adjusted.maxAngularSpeedDegPerSec = base.maxAngularSpeedDegPerSec * agilityMultiplier;
  adjusted.forwardAccelerationMps2 = base.forwardAccelerationMps2 * agilityMultiplier;
  adjusted.reverseAccelerationMps2 = base.reverseAccelerationMps2 * agilityMultiplier;
  adjusted.strafeAccelerationMps2 = base.strafeAccelerationMps2 * agilityMultiplier;
  adjusted.verticalAccelerationMps2 = base.verticalAccelerationMps2 * agilityMultiplier;
  adjusted.boostAccelerationMps2 = base.boostAccelerationMps2 * agilityMultiplier;
  //4.- Boost duration remains fixed while cooldown scales multiplicatively.
  const cooldownScale = modifiers.boostCooldownScale > 0 ? modifiers.boostCooldownScale : 1;
  adjusted.boostCooldownSeconds = base.boostCooldownSeconds * cooldownScale;
  //5.- Freeze before returning to align with the rest of the configuration surface.
  return Object.freeze(adjusted);
}

export function clampDamageMultiplier(multiplier: number): number {
  //1.- Treat non-positive multipliers as neutral to match the Go runtime semantics.
  if (!(multiplier > 0)) {
    return 1;
  }
  //2.- Return the configured multiplier untouched when it is valid.
  return multiplier;
}

export function getSkiffLoadoutStats(loadoutId: string): VehicleStats {
  //1.- Locate the matching loadout and fall back to the unmodified stats when absent.
  const loadout = skiffLoadouts.find((entry) => entry.id === loadoutId);
  if (!loadout) {
    return skiffStats;
  }
  //2.- Derive the stat block using the passive modifiers tied to the loadout.
  return deriveStatsWithModifiers(skiffStats, loadout.passiveModifiers);
}

export function getSkiffLoadoutDamageMultiplier(loadoutId: string): number {
  //1.- Default to a neutral multiplier whenever the loadout id is unknown.
  const loadout = skiffLoadouts.find((entry) => entry.id === loadoutId);
  if (!loadout) {
    return 1;
  }
  //2.- Clamp the configured multiplier so negative or zero values remain neutral.
  return clampDamageMultiplier(loadout.passiveModifiers.damageMultiplier);
}

export const groundVehiclePlaceholders: Record<string, GroundVehicleConfig> = Object.freeze({
  duneRunner: Object.freeze({
    //1.- Placeholder entry ensures UI wiring survives until dune runner stats land.
    displayName: "Dune Runner",
    //2.- Disable selection so ground vehicles stay off while physics support matures.
    selectable: false,
    stats: Object.freeze({
      //3.- Zeroed stats highlight that gameplay numbers are pending balancing work.
      maxSpeedMps: 0,
      maxAngularSpeedDegPerSec: 0,
      forwardAccelerationMps2: 0,
      reverseAccelerationMps2: 0,
      strafeAccelerationMps2: 0,
      verticalAccelerationMps2: 0,
      boostAccelerationMps2: 0,
      boostDurationSeconds: 0,
      boostCooldownSeconds: 0,
    }),
    //4.- Give future maintainers context about why the entry remains disabled.
    notes: "Waiting on ground handling tune before exposing dune runner to players.",
  }),
  trailBlazer: Object.freeze({
    //1.- Trail Blazer shares the same placeholder scaffolding for upcoming releases.
    displayName: "Trail Blazer",
    selectable: false,
    stats: Object.freeze({
      //2.- Leave accelerations empty until drivetrain specs arrive from design.
      maxSpeedMps: 0,
      maxAngularSpeedDegPerSec: 0,
      forwardAccelerationMps2: 0,
      reverseAccelerationMps2: 0,
      strafeAccelerationMps2: 0,
      verticalAccelerationMps2: 0,
      boostAccelerationMps2: 0,
      boostDurationSeconds: 0,
      boostCooldownSeconds: 0,
    }),
    //3.- Capture the pending dependency chain so we can remove the guard once satisfied.
    notes: "Requires completed suspension model and shared tuning sheet before launch.",
  }),
});
