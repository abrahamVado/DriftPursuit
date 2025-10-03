import { describe, expect, it } from "vitest";
import type { VehicleStats } from "../../gameplayConfig";
import type {
  VehicleLoadoutSummary,
  VehicleRosterEntry,
} from "../../vehicleRoster";
import { VehicleGeometryFactory } from "./vehicleFactory";

//1.- Helper building a mock loadout summary with derived stats for testing.
function buildLoadout(
  id: string,
  stats: VehicleStats,
  passiveOverrides?: Partial<VehicleLoadoutSummary["passiveModifiers"]>,
): VehicleLoadoutSummary {
  return {
    id,
    displayName: id,
    description: `${id} loadout`,
    icon: "icon.png",
    selectable: true,
    weapons: [],
    passiveModifiers: {
      speedMultiplier: 1,
      agilityMultiplier: 1,
      damageMultiplier: 1,
      boostCooldownScale: 1,
      ...passiveOverrides,
    },
    stats,
  };
}

//1.- Provide a baseline stats object shared across multiple test scenarios.
const baseStats: VehicleStats = {
  maxSpeedMps: 80,
  maxAngularSpeedDegPerSec: 120,
  forwardAccelerationMps2: 10,
  reverseAccelerationMps2: 6,
  strafeAccelerationMps2: 8,
  verticalAccelerationMps2: 5,
  boostAccelerationMps2: 18,
  boostDurationSeconds: 5,
  boostCooldownSeconds: 12,
};

describe("VehicleGeometryFactory", () => {
  //1.- Validate that raw stats produce the expected geometry dimensions and bounding boxes.
  it("generates BufferGeometry instances with computed bounding boxes", async () => {
    const factory = new VehicleGeometryFactory();
    const result = await factory.createFromStats(baseStats, {
      vehicleId: "custom",
    });

    const body = result.body;
    const wheel = result.wheel;
    const spoiler = result.spoiler;

    const bodyPositions = body.getAttribute("position");
    expect(bodyPositions).toBeDefined();
    expect(bodyPositions.count).toBe(24);

    const wheelPositions = wheel.getAttribute("position");
    expect(wheelPositions).toBeDefined();
    expect(wheelPositions.count).toBeGreaterThan(0);

    const spoilerPositions = spoiler.getAttribute("position");
    expect(spoilerPositions).toBeDefined();
    expect(spoilerPositions.count).toBe(24);

    const bodyBox = body.boundingBox;
    expect(bodyBox).toBeDefined();
    const dimensions = result.metadata.dimensions;
    expect(bodyBox!.max.x - bodyBox!.min.x).toBeCloseTo(dimensions.length, 5);
    expect(bodyBox!.max.y - bodyBox!.min.y).toBeCloseTo(dimensions.height, 5);
    expect(bodyBox!.max.z - bodyBox!.min.z).toBeCloseTo(dimensions.width, 5);

    const spoilerBox = spoiler.boundingBox;
    expect(spoilerBox).toBeDefined();
    expect(spoilerBox!.max.y).toBeGreaterThan(bodyBox!.max.y);

    const wheelBox = wheel.boundingBox;
    expect(wheelBox).toBeDefined();
    expect(wheelBox!.min.y).toBeGreaterThanOrEqual(0);
    expect(wheelBox!.min.y).toBeLessThan(dimensions.wheelRadius * 0.2);
    const wheelHeight = wheelBox!.max.y - wheelBox!.min.y;
    expect(wheelHeight).toBeGreaterThan(dimensions.wheelRadius * 1.6);
    expect(wheelHeight).toBeLessThan(dimensions.wheelRadius * 2.1);
  });

  //1.- Ensure loadout specific stats influence the resulting geometry.
  it("responds to loadout variants when deriving dimensions", async () => {
    const factory = new VehicleGeometryFactory();
    const fastStats: VehicleStats = {
      ...baseStats,
      maxSpeedMps: 110,
      strafeAccelerationMps2: 7,
    };
    const agileStats: VehicleStats = {
      ...baseStats,
      maxSpeedMps: 82,
      strafeAccelerationMps2: 11,
      verticalAccelerationMps2: 6,
    };

    const loadouts: VehicleLoadoutSummary[] = [
      buildLoadout("base", baseStats),
      buildLoadout("fast", fastStats, { speedMultiplier: 1.2 }),
      buildLoadout("agile", agileStats, { agilityMultiplier: 1.3 }),
    ];

    const roster: VehicleRosterEntry = {
      id: "prototype",
      displayName: "Prototype",
      stats: baseStats,
      selectable: true,
      loadouts,
      defaultLoadoutId: "base",
    };

    const baseGeometry = await factory.createFromRoster(roster, "base");
    const fastGeometry = await factory.createFromRoster(roster, "fast");
    const agileGeometry = await factory.createFromRoster(roster, "agile");

    expect(fastGeometry.metadata.dimensions.length).toBeGreaterThan(
      baseGeometry.metadata.dimensions.length,
    );
    expect(agileGeometry.metadata.dimensions.width).toBeGreaterThan(
      baseGeometry.metadata.dimensions.width,
    );
    expect(agileGeometry.metadata.dimensions.spoilerHeight).toBeGreaterThan(
      baseGeometry.metadata.dimensions.spoilerHeight,
    );
  });

  //1.- Check that runtime override updates rescale produced geometry and wheel radius.
  it("applies runtime overrides for scaling and suspension travel", async () => {
    const factory = new VehicleGeometryFactory();
    const baseline = await factory.createFromStats(baseStats, {
      vehicleId: "custom",
    });

    factory.updateConfig({ scale: 1.4, suspensionTravel: 0.3 });
    const modified = await factory.createFromStats(baseStats, {
      vehicleId: "custom",
    });

    expect(modified.metadata.dimensions.length).toBeGreaterThan(
      baseline.metadata.dimensions.length,
    );
    expect(modified.metadata.dimensions.wheelRadius).toBeGreaterThan(
      baseline.metadata.dimensions.wheelRadius,
    );

    const wheelBox = modified.wheel.boundingBox;
    expect(wheelBox).toBeDefined();
    const wheelHeight = wheelBox!.max.y - wheelBox!.min.y;
    expect(wheelHeight).toBeGreaterThan(modified.metadata.dimensions.wheelRadius * 1.6);
    expect(wheelHeight).toBeLessThan(modified.metadata.dimensions.wheelRadius * 2.1);
  });
});
