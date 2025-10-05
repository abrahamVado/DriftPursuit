export interface RockArchetype {
  name: string
  geometry: 'icosahedron' | 'box' | 'cylinder'
  radius: number
  height: number
  noiseAmplitude: number
}

export interface TreeLodDefinition {
  lod: 'near' | 'mid' | 'far'
  trunkSides: number
  leafDetail: number
  leafShape: 'icosphere' | 'card'
}

export interface TreeSpeciesDefinition {
  name: string
  trunkRadius: number
  trunkHeight: number
  canopyRadius: number
  branchCount: number
  lods: TreeLodDefinition[]
}

export interface AssetRegistry {
  rootFolder: string
  rocks: RockArchetype[]
  trees: TreeSpeciesDefinition[]
}

export const assetRegistry: AssetRegistry = {
  //1.- Declare a dedicated root for authored and procedural meshes so downstream tooling can locate them consistently.
  rootFolder: 'tunnelcave_sandbox_web/app/gameplay/assets',
  //2.- Provide a limited set of rock archetypes that the procedural generator can instance with per-instance transforms.
  rocks: [
    {
      name: 'basalt-slab',
      geometry: 'box',
      radius: 1.6,
      height: 1,
      noiseAmplitude: 0.35,
    },
    {
      name: 'granite-spire',
      geometry: 'icosahedron',
      radius: 1.3,
      height: 2.4,
      noiseAmplitude: 0.42,
    },
    {
      name: 'shale-stack',
      geometry: 'cylinder',
      radius: 1.1,
      height: 1.8,
      noiseAmplitude: 0.28,
    },
  ],
  //3.- Describe a single tree species with built-in LOD definitions to keep the render budget predictable.
  trees: [
    {
      name: 'sky-pine',
      trunkRadius: 0.35,
      trunkHeight: 6,
      canopyRadius: 3.5,
      branchCount: 4,
      lods: [
        { lod: 'near', trunkSides: 8, leafDetail: 2, leafShape: 'icosphere' },
        { lod: 'mid', trunkSides: 6, leafDetail: 1, leafShape: 'icosphere' },
        { lod: 'far', trunkSides: 4, leafDetail: 0, leafShape: 'card' },
      ],
    },
  ],
}
