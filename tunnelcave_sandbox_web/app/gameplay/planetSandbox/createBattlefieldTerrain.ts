import {
  BackSide,
  BufferAttribute,
  CylinderGeometry,
  DynamicDrawUsage,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from 'three'

import type { BattlefieldConfig } from '../generateBattlefield'
import { createRockGeometry } from '../rocks/createRockGeometry'

export interface BattlefieldTerrainPreview {
  group: Group
  dispose: () => void
}

export const createBattlefieldTerrainPreview = (config: BattlefieldConfig): BattlefieldTerrainPreview => {
  //1.- Build a root group that holds all battlefield terrain primitives for reuse within the planet map.
  const group = new Group()
  group.name = 'battlefield-terrain-preview'

  const disposables: Array<() => void> = []

  const terrainSampler = config.terrain.sampler

  //2.- Generate a displaced plane that mirrors the ground height samples from the procedural battlefield.
  const groundSegments = 160
  const groundGeometry = new PlaneGeometry(config.fieldSize, config.fieldSize, groundSegments, groundSegments)
  groundGeometry.rotateX(-Math.PI / 2)
  const groundPositions = groundGeometry.getAttribute('position') as BufferAttribute
  for (let index = 0; index < groundPositions.count; index += 1) {
    const x = groundPositions.getX(index)
    const z = groundPositions.getZ(index)
    const sample = terrainSampler.sampleGround(x, z)
    groundPositions.setY(index, sample.height)
  }
  groundPositions.needsUpdate = true
  groundGeometry.computeVertexNormals()
  const groundMaterial = new MeshStandardMaterial({ color: 0x2e4f30, roughness: 0.88, metalness: 0.08 })
  const groundMesh = new Mesh(groundGeometry, groundMaterial)
  groundMesh.name = 'battlefield-ground'
  groundMesh.receiveShadow = true
  group.add(groundMesh)
  disposables.push(() => {
    groundGeometry.dispose()
    groundMaterial.dispose()
  })

  //3.- Raise a translucent ceiling slab so the cavern silhouette remains recognizable on the planet panel.
  const ceilingGeometry = new PlaneGeometry(config.fieldSize, config.fieldSize, 16, 16)
  ceilingGeometry.rotateX(Math.PI / 2)
  const ceilingPositions = ceilingGeometry.getAttribute('position') as BufferAttribute
  for (let index = 0; index < ceilingPositions.count; index += 1) {
    const x = ceilingPositions.getX(index)
    const z = ceilingPositions.getZ(index)
    const ceilingHeight = terrainSampler.sampleCeiling(x, z)
    ceilingPositions.setY(index, ceilingHeight)
  }
  ceilingPositions.needsUpdate = true
  const ceilingMaterial = new MeshStandardMaterial({
    color: 0x1b1b2f,
    side: BackSide,
    roughness: 0.35,
    metalness: 0.08,
    transparent: true,
    opacity: 0.65,
  })
  const ceilingMesh = new Mesh(ceilingGeometry, ceilingMaterial)
  ceilingMesh.name = 'battlefield-ceiling'
  group.add(ceilingMesh)
  disposables.push(() => {
    ceilingGeometry.dispose()
    ceilingMaterial.dispose()
  })

  //4.- Project any water samples into instanced quads so lakes and rivers remain visible in the miniature.
  if (config.waters.length > 0) {
    const waterCellSize = config.fieldSize / 32
    const waterGeometry = new PlaneGeometry(1, 1)
    waterGeometry.rotateX(-Math.PI / 2)
    const waterMaterial = new MeshStandardMaterial({
      color: 0x335c81,
      transparent: true,
      opacity: 0.6,
      roughness: 0.35,
      metalness: 0.1,
    })
    const waterMesh = new InstancedMesh(waterGeometry, waterMaterial, config.waters.length)
    waterMesh.name = 'battlefield-water'
    waterMesh.instanceMatrix.setUsage(DynamicDrawUsage)
    const waterMatrix = new Matrix4()
    const waterQuaternion = new Quaternion()
    config.waters.forEach((sample, index) => {
      waterMatrix.compose(
        new Vector3(sample.position.x, sample.level + 0.01, sample.position.z),
        waterQuaternion,
        new Vector3(waterCellSize, 1, waterCellSize),
      )
      waterMesh.setMatrixAt(index, waterMatrix)
    })
    waterMesh.instanceMatrix.needsUpdate = true
    group.add(waterMesh)
    disposables.push(() => {
      waterGeometry.dispose()
      waterMaterial.dispose()
      waterMesh.dispose()
    })
  }

  //5.- Combine the procedural rock instances into instanced meshes for each archetype to keep draw calls manageable.
  const rockGeometries = config.assets.rocks.map((_, index) =>
    createRockGeometry(index, config.seed + index * 13, config.assets),
  )
  const rockCounts = config.assets.rocks.map(() => 0)
  config.rocks.forEach((rock) => {
    rockCounts[rock.archetypeIndex] += 1
  })
  const rockMeshes: InstancedMesh[] = []
  const rockMatrix = new Matrix4()
  const rockQuaternion = new Quaternion()
  const rockScale = new Vector3()
  const rockOffsets = config.assets.rocks.map(() => 0)
  config.assets.rocks.forEach((archetype, index) => {
    const count = Math.max(1, rockCounts[index])
    const material = new MeshStandardMaterial({ color: 0x5a615c, roughness: 0.92, metalness: 0.18 })
    const mesh = new InstancedMesh(rockGeometries[index], material, count)
    mesh.name = `battlefield-rocks-${index}`
    mesh.instanceMatrix.setUsage(DynamicDrawUsage)
    group.add(mesh)
    rockMeshes.push(mesh)
    disposables.push(() => {
      rockGeometries[index].dispose()
      material.dispose()
      mesh.dispose()
    })
  })
  config.rocks.forEach((rock) => {
    const archetype = config.assets.rocks[rock.archetypeIndex]
    const mesh = rockMeshes[rock.archetypeIndex]
    const instanceIndex = rockOffsets[rock.archetypeIndex]
    rockOffsets[rock.archetypeIndex] += 1
    rockQuaternion.setFromAxisAngle(new Vector3(0, 1, 0), rock.rotation)
    rockScale.set(archetype.radius * rock.scale.x, archetype.height * rock.scale.y, archetype.radius * rock.scale.z)
    rockMatrix.compose(rock.position, rockQuaternion, rockScale)
    mesh.setMatrixAt(instanceIndex, rockMatrix)
  })
  rockMeshes.forEach((mesh) => {
    mesh.instanceMatrix.needsUpdate = true
  })

  //6.- Populate tree trunks and canopies with instanced meshes so forests appear around the miniature battlefield.
  const treeCount = config.trees.length
  if (treeCount > 0) {
    const species = config.assets.trees[0]
    const trunkGeometry = new CylinderGeometry(1, 1, 2, species.lods[0].trunkSides)
    trunkGeometry.translate(0, 1, 0)
    const canopyGeometry = new IcosahedronGeometry(1, species.lods[0].leafDetail)
    const trunkMaterial = new MeshStandardMaterial({ color: 0x4d2c1c, roughness: 0.85, metalness: 0.1 })
    const canopyMaterial = new MeshStandardMaterial({ color: 0x4a7c59, roughness: 0.65, metalness: 0.1 })

    const trunkMesh = new InstancedMesh(trunkGeometry, trunkMaterial, treeCount)
    trunkMesh.name = 'battlefield-tree-trunks'
    const canopyMesh = new InstancedMesh(canopyGeometry, canopyMaterial, treeCount)
    canopyMesh.name = 'battlefield-tree-canopies'

    const trunkMatrix = new Matrix4()
    const canopyMatrix = new Matrix4()

    config.trees.forEach((tree, index) => {
      trunkMatrix.compose(
        new Vector3(tree.position.x, tree.position.y + tree.trunkHeight * 0.5, tree.position.z),
        new Quaternion(),
        new Vector3(tree.variation * 0.8, tree.trunkHeight, tree.variation * 0.8),
      )
      canopyMatrix.compose(
        new Vector3(tree.position.x, tree.position.y + tree.trunkHeight, tree.position.z),
        new Quaternion(),
        new Vector3(tree.canopyRadius, tree.canopyRadius, tree.canopyRadius),
      )
      trunkMesh.setMatrixAt(index, trunkMatrix)
      canopyMesh.setMatrixAt(index, canopyMatrix)
    })

    trunkMesh.instanceMatrix.needsUpdate = true
    canopyMesh.instanceMatrix.needsUpdate = true

    group.add(trunkMesh)
    group.add(canopyMesh)

    disposables.push(() => {
      trunkGeometry.dispose()
      canopyGeometry.dispose()
      trunkMaterial.dispose()
      canopyMaterial.dispose()
      trunkMesh.dispose()
      canopyMesh.dispose()
    })
  }

  //7.- Return the assembled group with a disposer so callers can clean GPU resources when the preview unmounts.
  return {
    group,
    dispose: () => {
      disposables.forEach((dispose) => {
        dispose()
      })
    },
  }
}
