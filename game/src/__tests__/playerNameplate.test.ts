import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { createPlayer } from '@/vehicles/shared/player'

describe('createPlayer nameplate integration', () => {
  it('attaches and refreshes the pilot nameplate across vehicle swaps', () => {
    //1.- Force the helper to render by faking a browser-like user agent that bypasses the jsdom guard.
    const userAgentSpy = vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue('driftpursuit-test')
    const scene = new THREE.Scene()
    const pilotName = 'Test Pilot'

    try {
      const { group, setVehicle } = createPlayer('arrowhead', scene, pilotName)

      const initialSprites = group.children.filter((child): child is THREE.Sprite => child instanceof THREE.Sprite)
      expect(initialSprites).toHaveLength(1)
      expect(initialSprites[0].userData.nameplate).toEqual({ pilotName, vehicleKey: 'arrowhead' })

      setVehicle('cube')

      const refreshedSprites = group.children.filter((child): child is THREE.Sprite => child instanceof THREE.Sprite)
      expect(refreshedSprites).toHaveLength(1)
      expect(refreshedSprites[0].userData.nameplate).toEqual({ pilotName, vehicleKey: 'cube' })
    } finally {
      userAgentSpy.mockRestore()
    }
  })
})
