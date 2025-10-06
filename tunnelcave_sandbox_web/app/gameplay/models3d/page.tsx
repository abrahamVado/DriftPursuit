import React from 'react'

import { VEHICLE_DESCRIPTIONS, VEHICLE_IDS, VEHICLE_LABELS } from '../vehicles'

export default function Models3dPage() {
  //1.- Present the fleet hangar overview so pilots can browse every available craft.
  return (
    <main className="models3d-layout" data-testid="models3d-page">
      <header className="models3d-intro">
        <h1>Vehicle Hangar</h1>
        <p>Inspect the current fleet and review the role of each prototype before launching into the cavern.</p>
      </header>
      <section aria-label="Vehicle catalogue" className="models3d-grid" data-testid="models3d-grid">
        {/* //2.- Surface each craft with narrative context so visitors understand their battlefield role. */}
        {VEHICLE_IDS.map((vehicleId) => (
          <article className="models3d-card" data-testid={`models3d-${vehicleId}`} key={vehicleId}>
            <h2>{VEHICLE_LABELS[vehicleId]}</h2>
            <p>{VEHICLE_DESCRIPTIONS[vehicleId]}</p>
            <dl>
              <div>
                <dt>Callsign</dt>
                <dd>{vehicleId}</dd>
              </div>
            </dl>
          </article>
        ))}
      </section>
    </main>
  )
}
