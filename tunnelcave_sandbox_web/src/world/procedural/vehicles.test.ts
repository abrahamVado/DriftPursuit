import { describe, expect, it } from "vitest";
import * as THREE from "three";

import { buildVehicle } from "./vehicles";

//1.- Validate the baseline Arrowhead preset construction and structural metadata.
describe("buildVehicle arrowhead preset", () => {
  it("creates the expected meshes and userData for the default preset", () => {
    const group = buildVehicle("arrowhead");

    expect(group).toBeInstanceOf(THREE.Group);
    expect(group.children).toHaveLength(10);

    const spinParts = group.userData.spinParts;
    expect(spinParts).toBeDefined();
    expect(spinParts.rings).toHaveLength(5);
    expect(spinParts.speed).toBeCloseTo(Math.PI / 3);

    const frontState = group.userData.frontState;
    const tailState = group.userData.tailState;

    expect(frontState.rings).toHaveLength(2);
    expect(frontState.spacing).toBeCloseTo(0.8);
    expect(tailState.rings).toHaveLength(3);
    expect(tailState.spacing).toBeCloseTo(0.7);
  });
});

//2.- Confirm overrides merge into presets and mutate resulting meshes and metadata.
describe("buildVehicle preset overrides", () => {
  it("applies overrides to wing placement and FX spin", () => {
    const group = buildVehicle({
      preset: "arrowhead",
      overrides: {
        wings: {
          position: { x: -2, y: 0.3, z: 0 },
        },
        fx: {
          spinSpeed: Math.PI,
          front: {
            separation: 0.9,
          },
        },
      },
    });

    const wingMeshes = group.children.slice(1, 3) as THREE.Mesh[];
    wingMeshes.forEach((mesh) => {
      expect(mesh.position.x).toBeCloseTo(-2);
      expect(mesh.position.y).toBeCloseTo(0.3);
    });

    expect(group.userData.spinParts.speed).toBeCloseTo(Math.PI);
    expect(group.userData.frontState.spacing).toBeCloseTo(0.9);
  });
});

