import React from 'react'
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as THREE from 'three'

import type { BattlefieldConfig } from '../generateBattlefield'
import { assetRegistry } from '../assets/assetCatalog'

const createStubBattlefield = (): BattlefieldConfig => {
  //1.- Provide a minimal battlefield snapshot so the planet panel receives terrain data even in mocked WebGL environments.
  return {
    seed: 1,
    fieldSize: 120,
    spawnPoint: new THREE.Vector3(0, 0, 0),
    terrain: {
      sampler: {
        sampleGround: () => ({ height: 0, normal: new THREE.Vector3(0, 1, 0), slopeRadians: 0 }),
        sampleCeiling: () => 50,
        sampleWater: () => Number.NEGATIVE_INFINITY,
        flatSpawnRadius: 12,
        registerWaterOverride: () => {},
      },
      spawnRadius: 12,
    },
    environment: {
      boundsRadius: 200,
      vehicleRadius: 2,
      slopeLimitRadians: 1,
      bounceDamping: 0.2,
      groundSnapStrength: 0,
      waterDrag: 0.5,
      waterBuoyancy: 0.4,
      waterMinDepth: 0.5,
      maxWaterSpeedScale: 0.8,
      wrapSize: 300,
    },
    rocks: [],
    trees: [],
    waters: [],
    assets: assetRegistry,
  }
}

describe('PlanetaryMapPanel', () => {
  const originalWebGl = globalThis.window?.WebGLRenderingContext

  beforeEach(() => {
    //1.- Force the component to skip WebGL setup within the test environment.
    Object.defineProperty(window, 'WebGLRenderingContext', {
      configurable: true,
      value: undefined,
      writable: true,
    })
  })

  afterEach(() => {
    Object.defineProperty(window, 'WebGLRenderingContext', {
      configurable: true,
      value: originalWebGl,
      writable: true,
    })
  })

  it('renders telemetry using the initial blueprint snapshots', async () => {
    const { default: PlanetaryMapPanel } = await import('./PlanetaryMapPanel')
    render(<PlanetaryMapPanel battlefield={createStubBattlefield()} />)

    expect(screen.queryByTestId('planet-map-panel')).not.toBeNull()
    expect(screen.queryByText('Planet Sandbox')).not.toBeNull()
    //2.- The initial telemetry should list the seeded vehicles immediately.
    expect(screen.getByTestId('planet-map-fleet').textContent).toMatch(/scout/)
    expect(screen.getByTestId('planet-map-fleet').textContent).toMatch(/freighter/)
    expect(screen.getByTestId('planet-map-fleet').textContent).toMatch(/racer/)
  })
})
