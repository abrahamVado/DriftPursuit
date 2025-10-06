import { describe, expect, it } from 'vitest'

import { generateRockyPlanetTexture } from './rockyPlanetTexture'

describe('generateRockyPlanetTexture', () => {
  it('produces packed RGBA data with visible tonal variation', () => {
    const bundle = generateRockyPlanetTexture({ size: 32, seed: 7 })
    //1.- Ensure the generator honours the requested resolution and returns a packed RGBA buffer.
    expect(bundle.size).toBe(32)
    expect(bundle.data).toBeInstanceOf(Uint8Array)
    expect(bundle.data).toHaveLength(32 * 32 * 4)
    //2.- Ensure the packed pixels span a range of brightness values to read as rocky relief instead of a flat tone.
    let min = 255
    let max = 0
    let sum = 0
    let count = 0
    for (let i = 0; i < bundle.data.length; i += 4) {
      const brightness = (bundle.data[i] + bundle.data[i + 1] + bundle.data[i + 2]) / 3
      min = Math.min(min, brightness)
      max = Math.max(max, brightness)
      sum += brightness
      count += 1
    }
    expect(max - min).toBeGreaterThan(20)
    //3.- Verify the average luminance lifts above deep blues so the rocky shell contrasts the surrounding atmosphere.
    expect(sum / count).toBeGreaterThan(110)
  })

  it('returns texture data backed by a transferable ArrayBuffer', () => {
    const bundle = generateRockyPlanetTexture({ size: 16, seed: 19 })
    //1.- Confirm the buffer advertises ArrayBuffer so strict DOM typings accept the data as a WebGL upload source.
    expect(bundle.data.buffer).toBeInstanceOf(ArrayBuffer)
    //2.- Ensure the view references the full allocated buffer so no byte offsets are introduced unexpectedly.
    expect(bundle.data.byteOffset).toBe(0)
    expect(bundle.data.byteLength).toBe(bundle.size * bundle.size * 4)
  })
})
