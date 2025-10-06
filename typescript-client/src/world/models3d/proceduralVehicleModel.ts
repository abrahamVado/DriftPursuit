import type { VehicleStats } from "../../gameplayConfig";
import type {
  VehicleGeometryDimensions,
  VehicleGeometryResult,
  VehicleModelBuildParams,
} from "./modelTypes";

//1.- Guard against degenerate geometry by enforcing minimum values.
function clampMinimum(value: number, minimum: number): number {
  //1.- Preserve proportional relationships while respecting lower bounds.
  return value < minimum ? minimum : value;
}

//1.- Derive chassis and accessory dimensions from the incoming stats payload.
function computeDimensions(
  stats: VehicleStats,
  params: VehicleModelBuildParams,
): VehicleGeometryDimensions {
  //1.- Capture the resolved configuration for convenience within this scope.
  const config = params.config;
  //2.- Apply the uniform scale across all derived measurements.
  const scale = config.scale;
  //3.- Inspect the passive modifiers supplied by the active loadout if available.
  const speedModifier = params.context.loadout?.passiveModifiers?.speedMultiplier ?? 1;
  const agilityModifier = params.context.loadout?.passiveModifiers?.agilityMultiplier ?? 1;
  //4.- Compute raw chassis dimensions directly from the stats payload.
  const rawLength =
    (config.lengthBias + stats.maxSpeedMps * config.lengthFactor * speedModifier) * scale;
  const rawWidth =
    (config.widthBias + stats.strafeAccelerationMps2 * config.widthFactor) * scale * agilityModifier;
  const rawHeight =
    (config.heightBias + stats.verticalAccelerationMps2 * config.heightFactor) * scale;
  //5.- Clamp the chassis dimensions to prevent near-zero geometry artefacts.
  const length = clampMinimum(rawLength, config.minLength * scale);
  const width = clampMinimum(rawWidth, config.minWidth * scale);
  const height = clampMinimum(rawHeight, config.minHeight * scale);
  //6.- Compute wheel radii and widths derived from acceleration and rotation stats.
  const rawWheelRadius =
    (config.wheelRadiusBias + stats.verticalAccelerationMps2 * config.wheelRadiusFactor) * scale;
  const rawWheelWidth =
    (config.wheelWidthBias + stats.maxAngularSpeedDegPerSec * config.wheelWidthFactor) * scale;
  //7.- Clamp wheel dimensions and add suspension travel to the radius for bounding boxes.
  const wheelRadius =
    clampMinimum(rawWheelRadius, config.minWheelRadius * scale) + config.suspensionTravel;
  const wheelWidth = clampMinimum(rawWheelWidth, config.minWheelWidth * scale);
  //8.- Compute wheel placement metrics re-used by gameplay previews.
  const wheelBase = length * config.wheelBaseMultiplier;
  const wheelTrack = width * config.wheelTrackMultiplier;
  //9.- Determine spoiler dimensions influenced by loadout speed modifiers.
  const spoilerWidth = width * config.spoilerWidthMultiplier;
  const spoilerDepth = length * config.spoilerDepthMultiplier;
  const spoilerHeight =
    height * config.spoilerHeightMultiplier * config.spoilerScale * speedModifier;
  //10.- Return the derived dimension summary for downstream geometry builders.
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

//1.- Construct the BufferGeometry representing a single wheel instance.
function buildWheelGeometry(
  THREE: typeof import("three"),
  dimensions: VehicleGeometryDimensions,
  segments: number,
): import("three").BufferGeometry {
  //1.- Start with a cylinder aligned along the Y axis.
  const rawWheel = new THREE.CylinderGeometry(
    dimensions.wheelRadius,
    dimensions.wheelRadius,
    dimensions.wheelWidth,
    segments,
  );
  //2.- Rotate the wheel so the rotation axis aligns with the X axis.
  rawWheel.rotateZ(Math.PI / 2);
  //3.- Translate the wheel upwards so the base touches the origin plane.
  const offsetMatrix = new THREE.Matrix4().makeTranslation(0, dimensions.wheelRadius, 0);
  rawWheel.applyMatrix4(offsetMatrix);
  //4.- Ensure the bounding box reflects the applied rotation and translation.
  rawWheel.computeBoundingBox();
  return rawWheel;
}

//1.- Construct the BufferGeometry representing the spoiler accessory.
function buildSpoilerGeometry(
  THREE: typeof import("three"),
  dimensions: VehicleGeometryDimensions,
): import("three").BufferGeometry {
  //1.- Create the spoiler volume from the derived dimensions.
  const spoiler = new THREE.BoxGeometry(
    dimensions.spoilerDepth,
    dimensions.spoilerHeight,
    dimensions.spoilerWidth,
  );
  //2.- Translate the spoiler above and behind the chassis midpoint.
  const translation = new THREE.Matrix4().makeTranslation(
    dimensions.length / 2 - dimensions.spoilerDepth / 2,
    dimensions.height / 2 + dimensions.spoilerHeight / 2,
    0,
  );
  spoiler.applyMatrix4(translation);
  //3.- Cache the bounding box to simplify downstream processing.
  spoiler.computeBoundingBox();
  return spoiler;
}

//1.- Shared procedural pipeline used by multiple vehicles that derive geometry from stats.
export function buildProceduralVehicleGeometry(
  params: VehicleModelBuildParams,
): VehicleGeometryResult {
  //1.- Derive the dimension summary taking loadout modifiers into account.
  const dimensions = computeDimensions(params.stats, params);
  //2.- Build the chassis geometry as a simple box aligned with the world axes.
  const body = new params.THREE.BoxGeometry(
    dimensions.length,
    dimensions.height,
    dimensions.width,
  );
  //3.- Precompute the bounding box for the body to aid selection previews.
  body.computeBoundingBox();
  //4.- Construct the accessory geometries using the derived dimensions.
  const wheel = buildWheelGeometry(params.THREE, dimensions, params.config.wheelSegments);
  const spoiler = buildSpoilerGeometry(params.THREE, dimensions);
  //5.- Return the geometry bundle along with metadata capturing provenance.
  return {
    body,
    wheel,
    spoiler,
    metadata: {
      vehicleId: params.context.vehicleId,
      loadoutId: params.context.loadout?.id,
      config: { ...params.config },
      dimensions,
    },
  };
}
