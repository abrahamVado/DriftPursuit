import type { PlanetConfiguration } from './planetSpecLoader'
import type { RadialDisplacementField } from './noiseDisplacement'

export interface SurfaceClassification {
  readonly seaLevel: number
  readonly surfaceRadii: Float32Array
  readonly oceanMask: Uint8Array
  readonly oceanVertexCount: number
  readonly landVertexCount: number
}

export function classifySurfaceBySeaLevel(
  field: RadialDisplacementField,
  configuration: PlanetConfiguration
): SurfaceClassification {
  //1.- Allocate typed buffers mirroring the vertex count so shaders can branch on ocean membership.
  const vertexCount = field.radii.length
  const surfaceRadii = new Float32Array(vertexCount)
  const oceanMask = new Uint8Array(vertexCount)
  let oceanCount = 0
  //2.- Clamp each vertex radius against the sea level and flag the classification mask.
  for (let index = 0; index < vertexCount; index += 1) {
    const radius = field.radii[index]
    if (radius <= configuration.seaLevel) {
      surfaceRadii[index] = configuration.seaLevel
      oceanMask[index] = 1
      oceanCount += 1
    } else {
      surfaceRadii[index] = radius
      oceanMask[index] = 0
    }
  }
  const landCount = vertexCount - oceanCount
  const classification: SurfaceClassification = {
    seaLevel: configuration.seaLevel,
    surfaceRadii,
    oceanMask,
    oceanVertexCount: oceanCount,
    landVertexCount: landCount,
  }
  return Object.freeze(classification)
}

