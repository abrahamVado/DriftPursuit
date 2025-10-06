import type { VehicleStats } from "../../gameplayConfig";
import type {
  VehicleLoadoutSummary,
  VehicleRosterEntry,
} from "../../vehicleRoster";
import {
  resolveVehicleModelBuilder,
} from "../models3d/modelRegistry";
import type {
  ResolvedVehicleFactoryConfig,
  VehicleGeometryDimensions,
  VehicleGeometryResult,
  VehicleModelBuildContext,
} from "../models3d/modelTypes";
export type {
  ResolvedVehicleFactoryConfig,
  VehicleGeometryDimensions,
  VehicleGeometryResult,
  VehicleModelBuildContext,
} from "../models3d/modelTypes";

//1.- Provide a strongly typed shape describing runtime overrides applied to geometry generation.
export interface VehicleFactoryConfig {
  //1.- Global scalar applied across all derived dimensions.
  scale?: number;
  //2.- Bias influencing the base length before stat derived contributions.
  lengthBias?: number;
  //3.- Contribution factor translating maximum speed into longitudinal length.
  lengthFactor?: number;
  //4.- Bias controlling the default chassis width when stats are minimal.
  widthBias?: number;
  //5.- Factor mapping strafe acceleration into lateral width adjustments.
  widthFactor?: number;
  //6.- Bias used for the chassis height baseline.
  heightBias?: number;
  //7.- Factor mapping vertical acceleration into chassis height variance.
  heightFactor?: number;
  //8.- Minimum chassis length clamp protecting against degenerate geometries.
  minLength?: number;
  //9.- Minimum chassis width clamp.
  minWidth?: number;
  //10.- Minimum chassis height clamp.
  minHeight?: number;
  //11.- Scalar defining the spoiler width relative to the chassis width.
  spoilerWidthMultiplier?: number;
  //12.- Scalar defining the spoiler depth relative to chassis length.
  spoilerDepthMultiplier?: number;
  //13.- Scalar defining spoiler height relative to chassis height.
  spoilerHeightMultiplier?: number;
  //14.- Additional spoiler emphasis multiplier to reflect loadout variants.
  spoilerScale?: number;
  //15.- Baseline wheel radius applied before stat derived adjustments.
  wheelRadiusBias?: number;
  //16.- Factor translating vertical acceleration into wheel radius changes.
  wheelRadiusFactor?: number;
  //17.- Baseline wheel width applied before rotational stat influence.
  wheelWidthBias?: number;
  //18.- Factor translating angular speed into wheel width variance.
  wheelWidthFactor?: number;
  //19.- Minimum wheel radius clamp for stability.
  minWheelRadius?: number;
  //20.- Minimum wheel width clamp for stability.
  minWheelWidth?: number;
  //21.- Proportion of chassis length used to compute the wheel base.
  wheelBaseMultiplier?: number;
  //22.- Proportion of chassis width used to compute the wheel track.
  wheelTrackMultiplier?: number;
  //23.- Suspension travel distance applied to wheel radius for bounding boxes.
  suspensionTravel?: number;
  //24.- Radial segments used when tessellating the wheel geometry.
  wheelSegments?: number;
}

//1.- Centralised defaults ensure geometry stays consistent across factory instances.
const DEFAULT_CONFIG: ResolvedVehicleFactoryConfig = {
  scale: 1,
  lengthBias: 3,
  lengthFactor: 0.04,
  widthBias: 1.6,
  widthFactor: 0.03,
  heightBias: 1.2,
  heightFactor: 0.015,
  minLength: 2.4,
  minWidth: 1.2,
  minHeight: 0.8,
  spoilerWidthMultiplier: 0.9,
  spoilerDepthMultiplier: 0.18,
  spoilerHeightMultiplier: 0.25,
  spoilerScale: 1,
  wheelRadiusBias: 0.45,
  wheelRadiusFactor: 0.01,
  wheelWidthBias: 0.26,
  wheelWidthFactor: 0.001,
  minWheelRadius: 0.35,
  minWheelWidth: 0.18,
  wheelBaseMultiplier: 0.62,
  wheelTrackMultiplier: 0.82,
  suspensionTravel: 0.12,
  wheelSegments: 14,
};

//1.- Cache the lazily imported three.js module so repeated calls stay efficient.
let cachedThreeModule: Promise<typeof import("three")> | undefined;

//1.- Resolve the three.js module on demand to support CommonJS builds consuming the ESM package.
async function resolveThree(): Promise<typeof import("three")> {
  //1.- Use memoisation to avoid duplicate dynamic imports across factory invocations.
  if (!cachedThreeModule) {
    cachedThreeModule = import("three");
  }
  return cachedThreeModule;
}

//1.- Main factory orchestrating procedural geometry creation based on vehicle stats.
export class VehicleGeometryFactory {
  //1.- Store the resolved overrides used by subsequent generation calls.
  private config: ResolvedVehicleFactoryConfig;

  //1.- Initialise the factory with optional overrides applied on top of defaults.
  constructor(overrides: VehicleFactoryConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...overrides };
  }

  //1.- Allow runtime mutation of overrides so UI sliders can adjust geometry live.
  updateConfig(overrides: VehicleFactoryConfig): void {
    this.config = { ...this.config, ...overrides };
  }

  //1.- Surface the currently resolved configuration for debugging and previews.
  getConfig(): ResolvedVehicleFactoryConfig {
    return { ...this.config };
  }

  //1.- Generate geometry for a roster entry selecting an optional loadout variant.
  async createFromRoster(
    rosterEntry: VehicleRosterEntry,
    loadoutId?: string,
  ): Promise<VehicleGeometryResult> {
    //1.- Determine whether a specific loadout was requested and fall back gracefully.
    const loadout = this.selectLoadout(rosterEntry, loadoutId);
    //2.- Use the variant stats when present otherwise default to the roster baseline.
    const stats = loadout ? loadout.stats : rosterEntry.stats;
    //3.- Delegate to the shared generation pipeline with the derived context payload.
    return this.createFromStats(stats, {
      vehicleId: rosterEntry.id,
      loadout,
    });
  }

  //1.- Generate geometry directly from a stats payload with optional context metadata.
  async createFromStats(
    stats: VehicleStats,
    context: VehicleModelBuildContext,
  ): Promise<VehicleGeometryResult> {
    //1.- Lazily import three.js only once per process.
    const THREE = await resolveThree();
    //2.- Resolve the appropriate model builder for the requested vehicle.
    const builder = resolveVehicleModelBuilder(context.vehicleId);
    //3.- Delegate the geometry creation to the model-specific builder.
    return builder({
      stats,
      context,
      config: this.config,
      THREE,
    });
  }

  //1.- Select an appropriate loadout based on the provided hint and roster defaults.
  private selectLoadout(
    rosterEntry: VehicleRosterEntry,
    loadoutId?: string,
  ): VehicleLoadoutSummary | undefined {
    //1.- Attempt to resolve the explicit loadout identifier first.
    if (loadoutId) {
      const resolved = rosterEntry.loadouts.find((entry) => entry.id === loadoutId);
      if (resolved) {
        return resolved;
      }
    }
    //2.- Fall back to the roster default loadout when defined.
    if (rosterEntry.defaultLoadoutId) {
      const resolved = rosterEntry.loadouts.find(
        (entry) => entry.id === rosterEntry.defaultLoadoutId,
      );
      if (resolved) {
        return resolved;
      }
    }
    //3.- Return the first selectable loadout otherwise fall back to the first entry.
    return rosterEntry.loadouts.find((entry) => entry.selectable) ?? rosterEntry.loadouts[0];
  }

}
