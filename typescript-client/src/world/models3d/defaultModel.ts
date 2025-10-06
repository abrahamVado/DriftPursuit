import type { VehicleModelBuilder } from "./modelTypes";
import { buildProceduralVehicleGeometry } from "./proceduralVehicleModel";

//1.- Provide a fallback generator so experimental identifiers still yield preview geometry.
export const buildDefaultVehicleModel: VehicleModelBuilder = (params) => {
  //1.- Reuse the procedural pipeline with the supplied stats.
  return buildProceduralVehicleGeometry(params);
};
