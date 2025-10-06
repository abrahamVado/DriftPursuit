import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'

import { createBattlefieldTerrainPreview } from './createBattlefieldTerrain'
import { assetRegistry } from '../assets/assetCatalog'
import type { BattlefieldConfig } from '../generateBattlefield'

describe('createBattlefieldTerrainPreview', () => {
  const createConfig = (): BattlefieldConfig => {
    //1.- Craft a representative battlefield snapshot that includes water, rocks, and foliage.
    const terrainSampler = {
      sampleGround: (x: number, z: number) => ({
        height: Math.sin(x * 0.02) * 2 + Math.cos(z * 0.02) * 1.5,
        normal: new THREE.Vector3(0, 1, 0),
        slopeRadians: 0.2,
      }),
      sampleCeiling: () => 48,
      sampleWater: (x: number, z: number) => (Math.hypot(x, z) < 10 ? 2 : Number.NEGATIVE_INFINITY),
      flatSpawnRadius: 6,
      registerWaterOverride: () => {},
    }
    return {
      seed: 7,
      fieldSize: 60,
      spawnPoint: new THREE.Vector3(0, 0, 0),
      terrain: { sampler: terrainSampler, spawnRadius: 6 },
      environment: {
        boundsRadius: 120,
        vehicleRadius: 2,
        slopeLimitRadians: 1,
        bounceDamping: 0.2,
        groundSnapStrength: 0,
        waterDrag: 0.5,
        waterBuoyancy: 0.3,
        waterMinDepth: 0.4,
        maxWaterSpeedScale: 0.9,
        wrapSize: 180,
      },
      rocks: [
        {
          archetypeIndex: 0,
          position: new THREE.Vector3(8, 1, -6),
          rotation: 0.4,
          scale: new THREE.Vector3(1.1, 0.9, 1.2),
        },
      ],
      trees: [
        {
          position: new THREE.Vector3(-5, 0, 4),
          trunkHeight: 6,
          canopyRadius: 4,
          branchCount: 3,
          variation: 1,
        },
      ],
      waters: [
        {
          position: new THREE.Vector3(0, 0, 0),
          level: 2,
        },
      ],
      assets: assetRegistry,
    }
  }

  it('builds meshes for each terrain layer and disposes them on request', () => {
    const config = createConfig()
    const preview = createBattlefieldTerrainPreview(config)
    const groundMesh = preview.group.getObjectByName('battlefield-ground') as THREE.Mesh
    const ceilingMesh = preview.group.getObjectByName('battlefield-ceiling') as THREE.Mesh
    const waterMesh = preview.group.getObjectByName('battlefield-water') as THREE.InstancedMesh | null
    const rockMesh = preview.group.getObjectByName('battlefield-rocks-0') as THREE.InstancedMesh | null
    const trunkMesh = preview.group.getObjectByName('battlefield-tree-trunks') as THREE.InstancedMesh | null
    const canopyMesh = preview.group.getObjectByName('battlefield-tree-canopies') as THREE.InstancedMesh | null

    expect(groundMesh).toBeTruthy()
    expect(ceilingMesh).toBeTruthy()
    expect(waterMesh).toBeTruthy()
    expect(rockMesh).toBeTruthy()
    expect(trunkMesh).toBeTruthy()
    expect(canopyMesh).toBeTruthy()

    const groundGeometryDispose = vi.spyOn(groundMesh.geometry, 'dispose')
    const groundMaterialDispose = vi.spyOn(groundMesh.material as THREE.Material, 'dispose')
    const ceilingGeometryDispose = vi.spyOn(ceilingMesh.geometry, 'dispose')
    const ceilingMaterialDispose = vi.spyOn(ceilingMesh.material as THREE.Material, 'dispose')

    const waterGeometryDispose = waterMesh ? vi.spyOn(waterMesh.geometry, 'dispose') : null
    const waterMaterialDispose = waterMesh
      ? vi.spyOn((waterMesh.material as THREE.Material), 'dispose')
      : null
    const waterMeshDispose = waterMesh ? vi.spyOn(waterMesh, 'dispose') : null

    const rockGeometryDispose = rockMesh ? vi.spyOn(rockMesh.geometry, 'dispose') : null
    const rockMaterialDispose = rockMesh
      ? vi.spyOn(rockMesh.material as THREE.Material, 'dispose')
      : null
    const rockMeshDispose = rockMesh ? vi.spyOn(rockMesh, 'dispose') : null

    const trunkGeometryDispose = trunkMesh ? vi.spyOn(trunkMesh.geometry, 'dispose') : null
    const trunkMaterialDispose = trunkMesh
      ? vi.spyOn(trunkMesh.material as THREE.Material, 'dispose')
      : null
    const trunkMeshDispose = trunkMesh ? vi.spyOn(trunkMesh, 'dispose') : null

    const canopyGeometryDispose = canopyMesh ? vi.spyOn(canopyMesh.geometry, 'dispose') : null
    const canopyMaterialDispose = canopyMesh
      ? vi.spyOn(canopyMesh.material as THREE.Material, 'dispose')
      : null
    const canopyMeshDispose = canopyMesh ? vi.spyOn(canopyMesh, 'dispose') : null

    preview.dispose()

    expect(groundGeometryDispose).toHaveBeenCalled()
    expect(groundMaterialDispose).toHaveBeenCalled()
    expect(ceilingGeometryDispose).toHaveBeenCalled()
    expect(ceilingMaterialDispose).toHaveBeenCalled()
    if (waterMesh) {
      expect(waterGeometryDispose).not.toBeNull()
      expect(waterMaterialDispose).not.toBeNull()
      expect(waterMeshDispose).not.toBeNull()
      expect(waterGeometryDispose?.mock.calls.length).toBeGreaterThan(0)
      expect(waterMaterialDispose?.mock.calls.length).toBeGreaterThan(0)
      expect(waterMeshDispose?.mock.calls.length).toBeGreaterThan(0)
    }
    if (rockMesh) {
      expect(rockGeometryDispose?.mock.calls.length).toBeGreaterThan(0)
      expect(rockMaterialDispose?.mock.calls.length).toBeGreaterThan(0)
      expect(rockMeshDispose?.mock.calls.length).toBeGreaterThan(0)
    }
    if (trunkMesh) {
      expect(trunkGeometryDispose?.mock.calls.length).toBeGreaterThan(0)
      expect(trunkMaterialDispose?.mock.calls.length).toBeGreaterThan(0)
      expect(trunkMeshDispose?.mock.calls.length).toBeGreaterThan(0)
    }
    if (canopyMesh) {
      expect(canopyGeometryDispose?.mock.calls.length).toBeGreaterThan(0)
      expect(canopyMaterialDispose?.mock.calls.length).toBeGreaterThan(0)
      expect(canopyMeshDispose?.mock.calls.length).toBeGreaterThan(0)
    }
  })
})
