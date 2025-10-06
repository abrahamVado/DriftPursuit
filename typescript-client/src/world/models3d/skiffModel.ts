import type { VehicleModelBuilder } from "./modelTypes";
import { buildProceduralVehicleGeometry } from "./proceduralVehicleModel";

//1.- Generate geometry for the agile skiff hovercraft using the shared procedural pipeline.
export const buildSkiffModel: VehicleModelBuilder = (params) => {
  //1.- Delegate to the procedural generator tuned by the caller supplied configuration.
  return buildProceduralVehicleGeometry(params);
};
