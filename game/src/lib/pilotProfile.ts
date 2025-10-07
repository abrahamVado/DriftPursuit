//1.- Define the canonical set of vehicle options that the lobby and engine agree on.
export const VEHICLE_KEYS = [
  'arrowhead',
  'octahedron',
  'pyramid',
  'icosahedron',
  'cube'
] as const

//1.- Expose the vehicle key union for type-safe interactions throughout the game loop.
export type VehicleKey = (typeof VEHICLE_KEYS)[number]

//1.- Provide readable defaults so gameplay can recover gracefully when inputs are missing.
export const DEFAULT_PILOT_NAME = 'Rookie Pilot'
export const DEFAULT_VEHICLE_KEY: VehicleKey = 'arrowhead'

//1.- Trim and scrub a raw pilot name so UI fields cannot smuggle control characters into logs.
export function normalizePilotName(input: string | null | undefined): string {
  if (typeof input !== 'string') {
    return ''
  }
  const trimmed = input.trim()
  if (!trimmed) {
    return ''
  }
  const condensed = trimmed.replace(/\s+/g, ' ')
  const safe = condensed.replace(/[\u0000-\u001f\u007f]+/g, '')
  return safe
}

//1.- Clamp vehicle selections to the small whitelist exposed by the player builder.
export function normalizeVehicleChoice(input: string | null | undefined): VehicleKey {
  if (!input) {
    return DEFAULT_VEHICLE_KEY
  }
  const lower = input.toLowerCase() as VehicleKey
  return VEHICLE_KEYS.includes(lower) ? lower : DEFAULT_VEHICLE_KEY
}

//1.- Internal helper to slugify the pilot name into a broker-safe identifier.
function toPilotIdentifier(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const safeSlug = slug || 'rookie-pilot'
  return `pilot-${safeSlug}`
}

export type PilotProfile = {
  name: string
  vehicle: VehicleKey
  clientId: string
  usedFallbackName: boolean
  usedFallbackVehicle: boolean
}

//1.- Bundle the sanitised pilot properties so both the lobby and gameplay can share a single contract.
export function createPilotProfile(raw: {
  name: string | null | undefined
  vehicle: string | null | undefined
}): PilotProfile {
  const normalisedName = normalizePilotName(raw.name)
  const usedFallbackName = !normalisedName
  const safeName = normalisedName || DEFAULT_PILOT_NAME
  const vehicle = normalizeVehicleChoice(raw.vehicle)
  const suppliedVehicle = typeof raw.vehicle === 'string' ? raw.vehicle.toLowerCase() : ''
  const usedFallbackVehicle = !suppliedVehicle || !VEHICLE_KEYS.includes(suppliedVehicle as VehicleKey)
  return {
    name: safeName,
    vehicle,
    clientId: toPilotIdentifier(safeName),
    usedFallbackName,
    usedFallbackVehicle
  }
}
