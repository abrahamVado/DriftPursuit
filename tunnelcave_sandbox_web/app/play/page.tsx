import React from 'react'

import type { VehiclePresetName } from '../../src/world/procedural/vehicles'
import FullScreenSession from '../components/FullScreenSession'

const AVAILABLE_VEHICLES: VehiclePresetName[] = ['arrowhead', 'aurora', 'duskfall', 'steelwing']

type SearchParamsMap = Record<string, string | string[]>

interface PlayPageProps {
  //1.- Query string derived from the shared URL.
  searchParams?: Promise<SearchParamsMap>
}

function normalisePilot(value: string | string[] | undefined): string {
  //1.- Reduce array parameters to the first value and trim excess whitespace.
  const first = Array.isArray(value) ? value[0] ?? '' : value ?? ''
  return first.trim()
}

function normaliseVehicle(value: string | string[] | undefined): VehiclePresetName {
  //1.- Coerce the candidate into lowercase so preset comparisons stay predictable.
  const candidate = (Array.isArray(value) ? value[0] ?? '' : value ?? '').toLowerCase() as VehiclePresetName
  return AVAILABLE_VEHICLES.includes(candidate) ? candidate : 'arrowhead'
}

export default async function PlayPage({ searchParams }: PlayPageProps) {
  //1.- Await the Next.js provided search parameters so the play route stays compatible with async request handlers.
  const resolvedParams: SearchParamsMap = (searchParams ? await searchParams : {}) as SearchParamsMap
  const pilotName = normalisePilot(resolvedParams.pilot)
  const vehicleId = normaliseVehicle(resolvedParams.vehicle)
  return <FullScreenSession pilotName={pilotName} vehicleId={vehicleId} />
}
