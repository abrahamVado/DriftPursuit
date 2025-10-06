import { buildDefaultVehicleModel } from "./defaultModel";
import { buildDuneRunnerModel } from "./duneRunnerModel";
import type { VehicleModelBuilder } from "./modelTypes";
import { buildSkiffModel } from "./skiffModel";
import { buildTrailBlazerModel } from "./trailBlazerModel";

//1.- Catalogue the available vehicle model builders keyed by roster identifier.
const registry: Record<string, VehicleModelBuilder> = {
  //1.- Skiff geometry for the current playable hovercraft.
  skiff: buildSkiffModel,
  //2.- Placeholder dune runner geometry using the procedural defaults.
  duneRunner: buildDuneRunnerModel,
  //3.- Placeholder trail blazer geometry using the procedural defaults.
  trailBlazer: buildTrailBlazerModel,
};

//1.- Resolve the correct vehicle model builder with a fallback for experimental identifiers.
export function resolveVehicleModelBuilder(vehicleId: string): VehicleModelBuilder {
  //1.- Return the registered builder when present otherwise use the default generator.
  return registry[vehicleId] ?? buildDefaultVehicleModel;
}
