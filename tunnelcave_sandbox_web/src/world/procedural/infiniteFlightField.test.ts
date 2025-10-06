import { describe, expect, it } from 'vitest'
import * as THREE from 'three'

import { createInfiniteFlightField, debugGenerateFlightTile } from './infiniteFlightField'

//1.- Confirm deterministic tile generation so infinite map streaming stays stable across sessions.
describe('debugGenerateFlightTile', () => {
  it('generates reproducible terrain metrics per tile index', () => {
    const first = debugGenerateFlightTile(1337, { x: 0, z: 0 }, 160, 17)
    const second = debugGenerateFlightTile(1337, { x: 0, z: 0 }, 160, 17)
    expect(first.tile.metrics).toEqual(second.tile.metrics)
    expect(Array.from(first.tile.heights)).toEqual(Array.from(second.tile.heights))
  })

  it('varies heights between neighbouring tiles so repetition is avoided', () => {
    const base = debugGenerateFlightTile(2001, { x: 0, z: 0 }, 200, 17)
    const neighbour = debugGenerateFlightTile(2001, { x: 1, z: 0 }, 200, 17)
    expect(base.tile.metrics.maxHeight).not.toBeCloseTo(neighbour.tile.metrics.maxHeight)
  })
})

//2.- Validate the streaming loader loads and unloads tiles relative to the viewer position.
describe('createInfiniteFlightField', () => {
  it('loads tiles around the observer and clears stale tiles when moving', () => {
    const loaded: string[] = []
    const unloaded: string[] = []
    const field = createInfiniteFlightField({
      seed: 99,
      tileSize: 100,
      resolution: 17,
      viewDistance: 1,
      onTileLoaded: (tile) => loaded.push(tile.id),
      onTileUnloaded: (tile) => unloaded.push(tile.id),
    })

    field.update(new THREE.Vector3(10, 0, 10))
    expect(field.tiles.size).toBe(9)
    expect(loaded).toHaveLength(9)

    loaded.length = 0

    field.update(new THREE.Vector3(210, 0, 10))
    expect(field.tiles.size).toBe(9)
    expect(loaded).toContain('2:0')
    expect(unloaded).toContain('-1:-1')

    field.dispose()
  })

  it('normalises resolution to odd values to preserve a central vertex', () => {
    const field = createInfiniteFlightField({ resolution: 12 })
    field.update(new THREE.Vector3(0, 0, 0))
    const [tile] = [...field.tiles.values()]
    expect(tile?.resolution % 2).toBe(1)
    field.dispose()
  })
})
