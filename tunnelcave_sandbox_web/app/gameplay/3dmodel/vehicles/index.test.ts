import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { VEHICLE_IDS } from '../../vehicles'
import { createVehicleModel, listVehicleModelDefinitions } from './index'

describe('vehicle model definitions', () => {
  it('exposes a definition for every registered vehicle', () => {
    const definitions = listVehicleModelDefinitions()
    //1.- The hangar preview should surface the same roster of vehicles as the gameplay flow.
    expect(definitions).toHaveLength(VEHICLE_IDS.length)
    expect(definitions.map((definition) => definition.id)).toEqual(VEHICLE_IDS)
  })

  it('creates distinct mesh groups for each craft', () => {
    VEHICLE_IDS.forEach((vehicleId) => {
      const model = createVehicleModel(vehicleId)
      //1.- Ensure the mesh factory returns a populated group ready for rendering.
      expect(model).toBeInstanceOf(THREE.Group)
      expect(model.children.length).toBeGreaterThan(0)
    })
  })
})
