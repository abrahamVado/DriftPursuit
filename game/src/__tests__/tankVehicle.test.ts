import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { buildTank, type TankApi } from '@/vehicles/tank/build'

describe('Tank vehicle', () => {
  it('switches between tracked and planet modes and responds to hotkeys', () => {
    //1.- Build the craft and capture the transformation API exposed through userData.
    const group = buildTank()
    const api = group.userData.tank as TankApi | undefined
    expect(api).toBeDefined()
    expect(api?.getMode()).toBe('vehicle')

    const vehicleMesh = group.getObjectByName('tank-vehicle') as THREE.Object3D | null
    const planetMesh = group.getObjectByName('tank-planet') as THREE.Object3D | null
    expect(vehicleMesh?.visible).toBe(true)
    expect(planetMesh?.visible).toBe(false)

    //2.- Flip to planet form via the direct setter and ensure the mesh visibility swaps accordingly.
    api?.setMode('planet')
    expect(api?.getMode()).toBe('planet')
    expect(vehicleMesh?.visible).toBe(false)
    expect(planetMesh?.visible).toBe(true)

    //3.- Exercise the input hook so holding the + key morphs the tank into its celestial state.
    const hooks = group.userData.vehicleHooks as
      | { update?: (dt: number, input: { pressed: (code: string) => boolean }) => void }
      | undefined
    expect(hooks?.update).toBeTypeOf('function')

    api?.setMode('vehicle')
    hooks?.update?.(0.016, {
      pressed: (code) => code === 'Equal' || code === 'NumpadAdd',
    })
    expect(api?.getMode()).toBe('planet')

    //4.- Simulate the - hotkey to verify the tracked chassis returns immediately.
    hooks?.update?.(0.016, {
      pressed: (code) => code === 'Minus' || code === 'NumpadSubtract',
    })
    expect(api?.getMode()).toBe('vehicle')
  })
})
