import type { VehicleStats } from "../../gameplayConfig";
import type {
  VehicleLoadoutSummary,
  VehicleRosterEntry,
} from "../../vehicleRoster";

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

//1.- Materialised configuration with all defaults resolved for fast access.
interface ResolvedVehicleFactoryConfig {
  scale: number;
  lengthBias: number;
  lengthFactor: number;
  widthBias: number;
  widthFactor: number;
  heightBias: number;
  heightFactor: number;
  minLength: number;
  minWidth: number;
  minHeight: number;
  spoilerWidthMultiplier: number;
  spoilerDepthMultiplier: number;
  spoilerHeightMultiplier: number;
  spoilerScale: number;
  wheelRadiusBias: number;
  wheelRadiusFactor: number;
  wheelWidthBias: number;
  wheelWidthFactor: number;
  minWheelRadius: number;
  minWheelWidth: number;
  wheelBaseMultiplier: number;
  wheelTrackMultiplier: number;
  suspensionTravel: number;
  wheelSegments: number;
}

//1.- Structure describing the derived geometric measurements for consumers and tests.
export interface VehicleGeometryDimensions {
  //1.- Total chassis length along the longitudinal axis.
  length: number;
  //2.- Total chassis width along the lateral axis.
  width: number;
  //3.- Total chassis height measured from ground to roof.
  height: number;
  //4.- Distance between the front and rear wheel centres.
  wheelBase: number;
  //5.- Distance between the left and right wheels.
  wheelTrack: number;
  //6.- Wheel radius after suspension adjustments.
  wheelRadius: number;
  //7.- Wheel width along the axial direction.
  wheelWidth: number;
  //8.- Spoiler width along the lateral axis.
  spoilerWidth: number;
  //9.- Spoiler depth along the longitudinal axis.
  spoilerDepth: number;
  //10.- Spoiler height above the chassis roof.
  spoilerHeight: number;
}

//1.- Bundle the geometry instances along with metadata for downstream use.
export interface VehicleGeometryResult {
  //1.- Procedurally generated body mesh aligned to the origin.
  body: import("three").BufferGeometry;
  //2.- Wheel mesh oriented with the rotation axis along the local X axis.
  wheel: import("three").BufferGeometry;
  //3.- Spoiler mesh already translated to sit above the rear of the chassis.
  spoiler: import("three").BufferGeometry;
  //4.- Reference metadata describing the generated dimensions and provenance.
  metadata: {
    //1.- Source roster identifier informing asset selection pipelines.
    vehicleId: string;
    //2.- Optional loadout identifier shaping the variant specific geometry.
    loadoutId?: string;
    //3.- Copy of the resolved overrides used during generation.
    config: ResolvedVehicleFactoryConfig;
    //4.- Dimension snapshot enabling UI previews to stay in sync with geometry.
    dimensions: VehicleGeometryDimensions;
  };
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

//1.- Helper used by tests to round floats with predictable tolerance.
function clampMinimum(value: number, minimum: number): number {
  //1.- Enforce sanity constraints while preserving calculated proportionality.
  return value < minimum ? minimum : value;
}

//1.- Optional context passed when generating geometry from raw stats.
interface GenerationContext {
  //1.- Identifier for the roster entry guiding metadata generation.
  vehicleId: string;
  //2.- Optional loadout summary to introduce variant based tweaks.
  loadout?: VehicleLoadoutSummary;
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
    context: GenerationContext,
  ): Promise<VehicleGeometryResult> {
    //1.- Derive the chassis and accessory dimensions from the provided stats.
    const dimensions = this.computeDimensions(stats, context.loadout);
    //2.- Lazily import three.js only once per process.
    const THREE = await resolveThree();
    //3.- Build the main chassis geometry using a simple box representation.
    const body = new THREE.BoxGeometry(
      dimensions.length,
      dimensions.height,
      dimensions.width,
    );
    //4.- Ensure a bounding box exists so previews can query extents without recomputing.
    body.computeBoundingBox();
    //5.- Generate a single wheel mesh that can be instanced for each axle.
    const wheel = this.buildWheelGeometry(THREE, dimensions);
    //6.- Produce a spoiler mesh already aligned to the rear of the chassis.
    const spoiler = this.buildSpoilerGeometry(THREE, dimensions);
    //7.- Return the geometry bundle alongside metadata helpful for UI and physics.
    return {
      body,
      wheel,
      spoiler,
      metadata: {
        vehicleId: context.vehicleId,
        loadoutId: context.loadout?.id,
        config: { ...this.config },
        dimensions,
      },
    };
  }

  //1.- Internal helper that prepares the wheel geometry using the resolved dimensions.
  private buildWheelGeometry(
    THREE: typeof import("three"),
    dimensions: VehicleGeometryDimensions,
  ): import("three").BufferGeometry {
    //1.- Construct the wheel as a cylinder aligned with the local Y axis by default.
    const rawWheel = new THREE.CylinderGeometry(
      dimensions.wheelRadius,
      dimensions.wheelRadius,
      dimensions.wheelWidth,
      this.config.wheelSegments,
    );
    //2.- Rotate the wheel so the spin axis matches the vehicle's forward X axis.
    rawWheel.rotateZ(Math.PI / 2);
    //3.- Shift the wheel upward by half its radius to align the lowest point to the origin.
    const offsetMatrix = new THREE.Matrix4().makeTranslation(
      0,
      dimensions.wheelRadius,
      0,
    );
    rawWheel.applyMatrix4(offsetMatrix);
    //4.- Recompute the bounding box to reflect the applied transformations.
    rawWheel.computeBoundingBox();
    return rawWheel;
  }

  //1.- Internal helper that builds the spoiler geometry and positions it above the chassis.
  private buildSpoilerGeometry(
    THREE: typeof import("three"),
    dimensions: VehicleGeometryDimensions,
  ): import("three").BufferGeometry {
    //1.- Create the spoiler volume using the derived dimensions.
    const spoiler = new THREE.BoxGeometry(
      dimensions.spoilerDepth,
      dimensions.spoilerHeight,
      dimensions.spoilerWidth,
    );
    //2.- Translate the spoiler so it rests on the rear edge of the chassis roof.
    const translation = new THREE.Matrix4().makeTranslation(
      dimensions.length / 2 - dimensions.spoilerDepth / 2,
      dimensions.height / 2 + dimensions.spoilerHeight / 2,
      0,
    );
    spoiler.applyMatrix4(translation);
    //3.- Precompute the bounding box to simplify downstream usage.
    spoiler.computeBoundingBox();
    return spoiler;
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

  //1.- Convert vehicle stats and loadout modifiers into concrete geometry dimensions.
  private computeDimensions(
    stats: VehicleStats,
    loadout?: VehicleLoadoutSummary,
  ): VehicleGeometryDimensions {
    //1.- Factor the configured scale into every measurement for simple uniform resizing.
    const scale = this.config.scale;
    //2.- Use passive modifiers when present to further exaggerate differences between loadouts.
    const speedModifier = loadout?.passiveModifiers?.speedMultiplier ?? 1;
    const agilityModifier = loadout?.passiveModifiers?.agilityMultiplier ?? 1;
    //3.- Derive chassis length from speed so faster vehicles appear sleeker.
    const rawLength =
      (this.config.lengthBias + stats.maxSpeedMps * this.config.lengthFactor * speedModifier) *
      scale;
    //4.- Derive chassis width from strafe acceleration so agile craft feel wider.
    const rawWidth =
      (this.config.widthBias + stats.strafeAccelerationMps2 * this.config.widthFactor) *
      scale *
      agilityModifier;
    //5.- Derive chassis height from vertical control stats.
    const rawHeight =
      (this.config.heightBias + stats.verticalAccelerationMps2 * this.config.heightFactor) *
      scale;
    //6.- Clamp each dimension to guard against unrealistically tiny meshes.
    const length = clampMinimum(rawLength, this.config.minLength * scale);
    const width = clampMinimum(rawWidth, this.config.minWidth * scale);
    const height = clampMinimum(rawHeight, this.config.minHeight * scale);
    //7.- Compute wheel related dimensions using vertical and rotational stats.
    const rawWheelRadius =
      (this.config.wheelRadiusBias + stats.verticalAccelerationMps2 * this.config.wheelRadiusFactor) *
      scale;
    const rawWheelWidth =
      (this.config.wheelWidthBias + stats.maxAngularSpeedDegPerSec * this.config.wheelWidthFactor) *
      scale;
    //8.- Guard the wheel dimensions against degeneracy and include suspension travel.
    const wheelRadius =
      clampMinimum(rawWheelRadius, this.config.minWheelRadius * scale) +
      this.config.suspensionTravel;
    const wheelWidth = clampMinimum(rawWheelWidth, this.config.minWheelWidth * scale);
    //9.- Derive wheel placement values used by downstream positioning code.
    const wheelBase = length * this.config.wheelBaseMultiplier;
    const wheelTrack = width * this.config.wheelTrackMultiplier;
    //10.- Calculate spoiler dimensions responding to loadout speed modifiers.
    const spoilerWidth = width * this.config.spoilerWidthMultiplier;
    const spoilerDepth = length * this.config.spoilerDepthMultiplier;
    const spoilerHeight =
      height * this.config.spoilerHeightMultiplier * this.config.spoilerScale * speedModifier;
    //11.- Return the dimension summary for metadata and subsequent builders.
    return {
      length,
      width,
      height,
      wheelBase,
      wheelTrack,
      wheelRadius,
      wheelWidth,
      spoilerWidth,
      spoilerDepth,
      spoilerHeight,
    };
  }
}
