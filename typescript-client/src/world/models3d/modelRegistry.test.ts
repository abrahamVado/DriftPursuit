import { describe, expect, it } from "vitest";
import type { VehicleStats } from "../../gameplayConfig";
import { VehicleGeometryFactory } from "../procedural/vehicleFactory";
import { resolveVehicleModelBuilder } from "./modelRegistry";

//1.- Provide a reusable stats payload representative of a nimble hovercraft.
const sampleStats: VehicleStats = {
  maxSpeedMps: 80,
  maxAngularSpeedDegPerSec: 90,
  forwardAccelerationMps2: 10,
  reverseAccelerationMps2: 6,
  strafeAccelerationMps2: 7,
  verticalAccelerationMps2: 5,
  boostAccelerationMps2: 18,
  boostDurationSeconds: 4,
  boostCooldownSeconds: 12,
};

describe("modelRegistry", () => {
  //1.- Ensure registered vehicles resolve to their dedicated builders.
  it("resolves specialised builders for known vehicles", async () => {
    const THREE = await import("three");
    const factory = new VehicleGeometryFactory();
    const builder = resolveVehicleModelBuilder("skiff");

    const result = builder({
      stats: sampleStats,
      context: { vehicleId: "skiff" },
      config: factory.getConfig(),
      THREE,
    });

    expect(result.metadata.vehicleId).toBe("skiff");
    expect(result.body.boundingBox).toBeDefined();
  });

  //1.- Verify placeholder ground vehicles also resolve to dedicated builders.
  it("resolves placeholder builders for unreleased ground vehicles", async () => {
    const THREE = await import("three");
    const factory = new VehicleGeometryFactory();
    const builder = resolveVehicleModelBuilder("duneRunner");

    const result = builder({
      stats: { ...sampleStats, maxSpeedMps: 0 },
      context: { vehicleId: "duneRunner" },
      config: factory.getConfig(),
      THREE,
    });

    expect(result.metadata.vehicleId).toBe("duneRunner");
    expect(result.metadata.dimensions.length).toBeGreaterThan(0);
  });

  //1.- Confirm unknown identifiers fall back to the default procedural builder.
  it("falls back to the default builder for experimental identifiers", async () => {
    const THREE = await import("three");
    const factory = new VehicleGeometryFactory();
    const builder = resolveVehicleModelBuilder("prototype");

    const result = builder({
      stats: sampleStats,
      context: { vehicleId: "prototype" },
      config: factory.getConfig(),
      THREE,
    });

    expect(result.metadata.vehicleId).toBe("prototype");
    expect(result.metadata.dimensions.width).toBeGreaterThan(0);
  });
});
