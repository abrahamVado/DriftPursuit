import React from 'react'
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

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
    render(<PlanetaryMapPanel />)

    expect(screen.queryByTestId('planet-map-panel')).not.toBeNull()
    expect(screen.queryByText('Planet Sandbox')).not.toBeNull()
    //2.- The initial telemetry should list the seeded vehicles immediately.
    expect(screen.getByTestId('planet-map-fleet').textContent).toMatch(/scout/)
    expect(screen.getByTestId('planet-map-fleet').textContent).toMatch(/freighter/)
    expect(screen.getByTestId('planet-map-fleet').textContent).toMatch(/racer/)
  })
})
