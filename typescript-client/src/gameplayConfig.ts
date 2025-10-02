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
