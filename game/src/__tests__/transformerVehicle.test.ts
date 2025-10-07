import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { buildTransformer, type TransformerApi } from '@/vehicles/transformer/build'

//1.- Validate the mech exposes a usable API for toggling between robot and plane configurations.
describe('Transformer vehicle', () => {
  it('switches between modes and animates a walk cycle only in robot form', () => {
    //1.- Build the craft and capture the runtime helpers wired through userData.
    const group = buildTransformer()
    const api = group.userData.transformer as TransformerApi | undefined
    expect(api).toBeDefined()
    expect(api?.getMode()).toBe('robot')

    const robot = group.getObjectByName('transformer-robot') as THREE.Object3D | null
    const plane = group.getObjectByName('transformer-plane') as THREE.Object3D | null
    expect(robot?.visible).toBe(true)
    expect(plane?.visible).toBe(false)

    //2.- Ensure the articulated legs move when the walk update executes in robot mode.
    const leftLeg = robot?.getObjectByName('transformer-left-leg') as THREE.Object3D | undefined
    expect(leftLeg).toBeDefined()
    const initialLegRotation = leftLeg?.rotation.x ?? 0
    api?.update(0.5)
    expect(leftLeg?.rotation.x).not.toBe(initialLegRotation)

    //3.- After transforming into the plane configuration the walk cycle should freeze.
    api?.setMode('plane')
    expect(api?.getMode()).toBe('plane')
    expect(robot?.visible).toBe(false)
    expect(plane?.visible).toBe(true)
    const planeLegRotation = leftLeg?.rotation.x ?? 0
    api?.update(0.5)
    expect(leftLeg?.rotation.x).toBe(planeLegRotation)

    //4.- Toggling again returns to the original state and restores the humanoid mesh.
    expect(api?.toggleMode()).toBe('robot')
    expect(robot?.visible).toBe(true)
    expect(plane?.visible).toBe(false)
  })
})
