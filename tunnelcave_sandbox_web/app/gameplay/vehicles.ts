//1.- Central registry of craft identifiers so gameplay routes stay in sync when the roster evolves.
export const VEHICLE_IDS = ['arrowhead', 'aurora', 'duskfall', 'steelwing'] as const

export type VehicleId = (typeof VEHICLE_IDS)[number]

export const VEHICLE_LABELS: Record<VehicleId, string> = {
  //1.- Human friendly names ensure interface copy feels immersive and approachable.
  arrowhead: 'Arrowhead Interceptor',
  aurora: 'Aurora Glider',
  duskfall: 'Duskfall Raider',
  steelwing: 'Steelwing Vanguard',
}

//2.- Narrative blurbs keep UI components consistent when referencing vehicle lore.
export const VEHICLE_DESCRIPTIONS: Record<VehicleId, string> = {
  //1.- Short flavour blurbs provide context for how each craft fits into the fleet roster.
  arrowhead:
    'Balanced interceptor tuned for precision strikes and agile responses deep within the cavern airspace.',
  aurora: 'Glider platform engineered for graceful traversal and extended scouting runs across the stalactite fields.',
  duskfall: 'Raid specialist featuring aggressive thrust and responsive handling for daring cavern swoops.',
  steelwing: 'Armoured escort craft reinforced to weather subterranean debris and turbulent thermal drafts.',
}
