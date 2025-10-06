import type { VehicleModelBuilder } from "./modelTypes";
import { buildProceduralVehicleGeometry } from "./proceduralVehicleModel";

//1.- Generate placeholder geometry for the trail blazer entry using the shared pipeline.
export const buildTrailBlazerModel: VehicleModelBuilder = (params) => {
  //1.- Use the procedural generator so the placeholder remains visually represented.
  return buildProceduralVehicleGeometry(params);
};
