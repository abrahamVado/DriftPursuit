import type { VehicleStats } from "../../gameplayConfig";
import type { VehicleLoadoutSummary } from "../../vehicleRoster";
import type * as THREE from "three";

//1.- Capture the resolved configuration applied during geometry generation so builders receive consistent values.
export interface ResolvedVehicleFactoryConfig {
  //1.- Uniform scale factor applied to every derived measurement.
  scale: number;
  //2.- Baseline chassis length offset prior to stat contributions.
  lengthBias: number;
  //3.- Scalar mapping maximum speed into chassis length adjustments.
  lengthFactor: number;
  //4.- Baseline chassis width offset.
  widthBias: number;
  //5.- Scalar mapping lateral acceleration into width adjustments.
  widthFactor: number;
  //6.- Baseline chassis height offset.
  heightBias: number;
  //7.- Scalar mapping vertical acceleration into height adjustments.
  heightFactor: number;
  //8.- Minimum allowable chassis length.
  minLength: number;
  //9.- Minimum allowable chassis width.
  minWidth: number;
  //10.- Minimum allowable chassis height.
  minHeight: number;
  //11.- Multiplier deriving spoiler width from chassis width.
  spoilerWidthMultiplier: number;
  //12.- Multiplier deriving spoiler depth from chassis length.
  spoilerDepthMultiplier: number;
  //13.- Multiplier deriving spoiler height from chassis height.
  spoilerHeightMultiplier: number;
  //14.- Additional multiplier exaggerating spoiler height.
  spoilerScale: number;
  //15.- Baseline wheel radius prior to stat contributions.
  wheelRadiusBias: number;
  //16.- Scalar mapping vertical acceleration into wheel radius adjustments.
  wheelRadiusFactor: number;
  //17.- Baseline wheel width prior to stat contributions.
  wheelWidthBias: number;
  //18.- Scalar mapping angular speed into wheel width adjustments.
  wheelWidthFactor: number;
  //19.- Minimum allowable wheel radius.
  minWheelRadius: number;
  //20.- Minimum allowable wheel width.
  minWheelWidth: number;
  //21.- Multiplier mapping chassis length to wheel base.
  wheelBaseMultiplier: number;
  //22.- Multiplier mapping chassis width to wheel track.
  wheelTrackMultiplier: number;
  //23.- Suspension travel added on top of wheel radius.
  suspensionTravel: number;
  //24.- Radial segmentation used when constructing wheels.
  wheelSegments: number;
}

//1.- Shape describing metadata that accompanies geometry for previews and testing.
export interface VehicleGeometryDimensions {
  //1.- Overall chassis length.
  length: number;
  //2.- Overall chassis width.
  width: number;
  //3.- Overall chassis height.
  height: number;
  //4.- Distance between front and rear axles.
  wheelBase: number;
  //5.- Distance between left and right wheels.
  wheelTrack: number;
  //6.- Wheel radius including suspension travel.
  wheelRadius: number;
  //7.- Wheel width along the rotation axis.
  wheelWidth: number;
  //8.- Spoiler width along the lateral axis.
  spoilerWidth: number;
  //9.- Spoiler depth along the longitudinal axis.
  spoilerDepth: number;
  //10.- Spoiler height above the chassis roof.
  spoilerHeight: number;
}

//1.- Context describing which vehicle and loadout triggered the geometry build.
export interface VehicleModelBuildContext {
  //1.- Roster identifier for the vehicle entry.
  vehicleId: string;
  //2.- Optional loadout shaping passive modifiers.
  loadout?: VehicleLoadoutSummary;
}

//1.- Input payload consumed by vehicle model builders.
export interface VehicleModelBuildParams {
  //1.- Stats payload steering the procedural measurements.
  stats: VehicleStats;
  //2.- Context describing the originating vehicle request.
  context: VehicleModelBuildContext;
  //3.- Resolved configuration defining heuristics.
  config: ResolvedVehicleFactoryConfig;
  //4.- Preloaded three.js module used to instantiate BufferGeometry instances.
  THREE: typeof THREE;
}

//1.- Bundle generated meshes with metadata so callers can reason about the results.
export interface VehicleGeometryResult {
  //1.- Procedurally generated body geometry.
  body: THREE.BufferGeometry;
  //2.- Wheel geometry that can be instanced per axle.
  wheel: THREE.BufferGeometry;
  //3.- Spoiler geometry positioned relative to the chassis.
  spoiler: THREE.BufferGeometry;
  //4.- Metadata describing provenance and measurements.
  metadata: {
    //1.- Roster identifier for the generated vehicle.
    vehicleId: string;
    //2.- Optional loadout identifier influencing geometry.
    loadoutId?: string;
    //3.- Snapshot of the resolved configuration.
    config: ResolvedVehicleFactoryConfig;
    //4.- Derived dimension summary used by previews and tests.
    dimensions: VehicleGeometryDimensions;
  };
}

//1.- Function signature implemented by individual vehicle model builders.
export type VehicleModelBuilder = (
  params: VehicleModelBuildParams,
) => VehicleGeometryResult;
