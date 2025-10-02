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

function loadSkiffStats(): VehicleStats {
  //1.- Parse the shared JSON payload once so both runtimes agree on the numbers.
  const payload = readFileSync(SKIFF_CONFIG_PATH, "utf-8");
  const parsed = JSON.parse(payload) as VehicleStats;
  //2.- Freeze the result to prevent mutation that could desynchronise client and server.
  return Object.freeze(parsed) as VehicleStats;
}

export const skiffStats: VehicleStats = loadSkiffStats();
