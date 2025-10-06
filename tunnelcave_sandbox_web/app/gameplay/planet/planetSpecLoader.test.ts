import { describe, expect, it, vi } from 'vitest'
import {
  PlanetSpecValidationError,
  createPlanetConfiguration,
  loadPlanetConfiguration,
  loadPlanetConfigurationFromJson,
  parsePlanetSpec,
} from './planetSpecLoader'

describe('planetSpecLoader', () => {
  it('parses raw JSON objects into immutable PlanetSpecs', () => {
    //1.- Compose a representative payload that mirrors the PlanetSpec contract.
    const raw = {
      seed: 1337,
      radii: [180, 185, 200],
      frequencies: [0.25, 0.5, 1.0],
      amplitudes: [12, 6, 2],
      lodThresholds: [0.08, 0.04, 0.02],
      seaLevel: 150,
      surfaceClearance: 2,
      atmosphereHeight: 35,
    }
    //2.- Execute the parser to normalise shape and freeze arrays for sharing across systems.
    const spec = parsePlanetSpec(raw)
    expect(spec.seed).toBe(1337)
    expect(spec.radii).toEqual([180, 185, 200])
    expect(Object.isFrozen(spec.radii)).toBe(true)
    expect(spec.frequencies).toEqual([0.25, 0.5, 1.0])
    expect(spec.amplitudes).toEqual([12, 6, 2])
    expect(spec.lodThresholds).toEqual([0.08, 0.04, 0.02])
  })

  it('refuses to parse when amplitude and frequency counts diverge', () => {
    //1.- Deliver a malformed payload with mismatched FBM layers.
    const raw = {
      seed: 42,
      radii: [100],
      frequencies: [1, 2],
      amplitudes: [3],
      lodThresholds: [0.1],
      seaLevel: 80,
      surfaceClearance: 1.5,
      atmosphereHeight: 20,
    }
    //2.- Verify the loader surfaces a targeted validation error for the caller.
    expect(() => parsePlanetSpec(raw)).toThrow(PlanetSpecValidationError)
  })

  it('creates deterministic configuration bundles from parsed specs', () => {
    //1.- Build a valid spec and produce the runtime configuration view.
    const raw = {
      seed: 9001,
      radii: [210, 240],
      frequencies: [0.4, 0.8],
      amplitudes: [5.5, 2.75],
      lodThresholds: [0.12, 0.06],
      seaLevel: 200,
      surfaceClearance: 3.5,
      atmosphereHeight: 60,
    }
    const spec = parsePlanetSpec(raw)
    const configuration = createPlanetConfiguration(spec)
    //2.- Confirm noise layers pair amplitudes and frequencies while keeping slices immutable.
    expect(configuration).toEqual({
      seed: 9001,
      radii: spec.radii,
      noiseLayers: [
        { frequency: 0.4, amplitude: 5.5 },
        { frequency: 0.8, amplitude: 2.75 },
      ],
      lodThresholds: spec.lodThresholds,
      seaLevel: spec.seaLevel,
      surfaceClearance: spec.surfaceClearance,
      atmosphereHeight: spec.atmosphereHeight,
    })
    expect(Object.isFrozen(configuration.noiseLayers)).toBe(true)
  })

  it('parses PlanetSpecs from JSON strings', () => {
    //1.- Provide a JSON document as it would be shipped from disk.
    const json = JSON.stringify({
      seed: 77,
      radii: [150],
      frequencies: [0.6],
      amplitudes: [4.2],
      lodThresholds: [0.05],
      seaLevel: 120,
      surfaceClearance: 1.2,
      atmosphereHeight: 25,
    })
    //2.- Ensure loader surfaces the composed configuration and respects the numeric payload.
    const configuration = loadPlanetConfigurationFromJson(json)
    expect(configuration.seed).toBe(77)
    expect(configuration.radii).toEqual([150])
    expect(configuration.seaLevel).toBe(120)
  })

  it('raises a descriptive error on invalid JSON syntax', () => {
    //1.- Attempt to parse a broken payload to ensure syntax feedback is actionable.
    expect(() => loadPlanetConfigurationFromJson('{"seed"')).toThrow(PlanetSpecValidationError)
  })

  it('fetches PlanetSpecs over HTTP using a caller supplied fetch implementation', async () => {
    //1.- Prepare a deterministic fetch stub that returns a viable specification document.
    const fetchStub = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        seed: 314,
        radii: [175, 190],
        frequencies: [0.3, 0.9],
        amplitudes: [8, 3],
        lodThresholds: [0.07, 0.035],
        seaLevel: 140,
        surfaceClearance: 2.2,
        atmosphereHeight: 45,
      }),
    }))
    //2.- Load the configuration and verify the fetch call contract and parsed data.
    const configuration = await loadPlanetConfiguration('/planet/spec.json', fetchStub)
    expect(fetchStub).toHaveBeenCalledWith('/planet/spec.json')
    expect(configuration.noiseLayers).toEqual([
      { frequency: 0.3, amplitude: 8 },
      { frequency: 0.9, amplitude: 3 },
    ])
    expect(configuration.seaLevel).toBe(140)
  })

  it('reports network failures with the HTTP status text', async () => {
    //1.- Simulate an HTTP error to ensure the loader emits actionable diagnostics.
    const fetchStub = vi.fn(async () => ({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: async () => ({}),
    }))
    //2.- Confirm the rejected promise propagates as a PlanetSpecValidationError.
    await expect(
      loadPlanetConfiguration('/missing/spec.json', fetchStub)
    ).rejects.toThrow(PlanetSpecValidationError)
  })
})
