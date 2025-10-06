import React from 'react'

import { listVehicleModelDefinitions } from '../3dmodel/vehicles'
import { VEHICLE_DESCRIPTIONS } from '../vehicles'
import VehiclePreviewCanvas from './VehiclePreviewCanvas'

export default function VehiclePreviewPage() {
  //1.- Gather the fleet definitions once so the UI can iterate without recomputing geometry factories.
  const vehicleDefinitions = listVehicleModelDefinitions()

  return (
    <main className="vehicle-preview-layout" data-testid="vehicle-preview-page">
      <header className="vehicle-preview-intro">
        <h1>Vehicle Preview Gallery</h1>
        <p>
          Tour the full fleet in an interactive bay. Each craft renders immediately so you can compare silhouettes
          and canopy profiles before committing to a loadout.
        </p>
      </header>
      <section aria-label="Vehicle previews" className="vehicle-preview-grid" data-testid="vehicle-preview-grid">
        {vehicleDefinitions.map((definition) => (
          <article className="vehicle-preview-card" data-testid={`vehicle-preview-card-${definition.id}`} key={definition.id}>
            <h2>{definition.label}</h2>
            {/* //2.- Delegate drawing to the dedicated canvas so each card manages its own renderer lifecycle. */}
            <VehiclePreviewCanvas vehicleId={definition.id} />
            <p>{VEHICLE_DESCRIPTIONS[definition.id]}</p>
          </article>
        ))}
      </section>
    </main>
  )
}
