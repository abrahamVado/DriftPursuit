import type { VehicleModelBuilder } from "./modelTypes";
import { buildProceduralVehicleGeometry } from "./proceduralVehicleModel";

//1.- Generate placeholder geometry for the dune runner prototype using the shared pipeline.
export const buildDuneRunnerModel: VehicleModelBuilder = (params) => {
  //1.- Delegate to the procedural generator so placeholder stats still produce meshes.
  return buildProceduralVehicleGeometry(params);
};
