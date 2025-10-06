import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { wrapToInterval, wrappedDelta, wrapVector3 } from './worldWrapping'

describe('worldWrapping', () => {
  it('wrapToInterval re-enters the tile bounds while preserving offset direction', () => {
    //1.- Sample positions far outside the tile and ensure they land within [-size/2, size/2).
    expect(wrapToInterval(230, 200)).toBeCloseTo(30)
    expect(wrapToInterval(-270, 200)).toBeCloseTo(-70)
  })

  it('wrappedDelta returns the shortest seam-aware difference', () => {
    //1.- Use points straddling the seam and confirm the delta reflects the continuous path.
    expect(wrappedDelta(-90, 90, 200)).toBeCloseTo(20)
    expect(wrappedDelta(90, -90, 200)).toBeCloseTo(-20)
  })

  it('wrapVector3 mutates vectors so repeated world tiles align perfectly', () => {
    //1.- Wrap both axes and confirm Y remains untouched for vertical positioning.
    const vector = new THREE.Vector3(210, 5, -230)
    wrapVector3(vector, 200)
    expect(vector.x).toBeCloseTo(10)
    expect(vector.y).toBe(5)
    expect(vector.z).toBeCloseTo(-30)
  })
})

