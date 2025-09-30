import { TerraWorldStreamer } from './TerraWorldStreamer.js';
import { TileMapWorld } from './TileMapWorld.js';
import {
  cloneMapDefinition,
  cloneMapDescriptor,
  cloneTileDescriptor,
  cloneProceduralConfig,
} from './maps.js';

export const DEFAULT_WORLD_ENVIRONMENT = {
  bodyBackground: 'linear-gradient(180deg, #79a7ff 0%, #cfe5ff 45%, #f6fbff 100%)',
  backgroundColor: 0x90b6ff,
  fog: { color: 0xa4c6ff, near: 1500, far: 4200 },
  sun: { color: 0xffffff, intensity: 1.05, position: [-420, 580, 780] },
  hemisphere: { skyColor: 0xdce9ff, groundColor: 0x2b4a2e, intensity: 0.85 },
};

function assignVector3(target, source){
  if (!target || source == null) return;
  if (Array.isArray(source) && source.length >= 3){
    target.set(source[0], source[1], source[2]);
    return;
  }
  const { x, y, z } = source;
  if (typeof x === 'number' && typeof y === 'number' && typeof z === 'number'){
    target.set(x, y, z);
    return;
  }
  if (typeof x === 'number') target.x = x;
  if (typeof y === 'number') target.y = y;
  if (typeof z === 'number') target.z = z;
}

export function applyMapEnvironment({
  mapDefinition,
  scene,
  documentRef,
  hemisphere,
  sun,
  defaults = DEFAULT_WORLD_ENVIRONMENT,
} = {}){
  const environment = mapDefinition?.descriptor?.environment ?? mapDefinition?.environment ?? {};
  if (documentRef?.body){
    documentRef.body.style.background = environment.bodyBackground ?? defaults.bodyBackground;
  }
  if (scene){
    const background = environment.background ?? defaults.backgroundColor;
    if (scene.background){
      scene.background.set ? scene.background.set(background) : scene.background = background;
    } else {
      scene.background = scene.background ?? background;
      if (scene.background?.set){
        scene.background.set(background);
      }
    }
    if (scene.fog){
      const fogConfig = environment.fog ?? {};
      scene.fog.color.set(fogConfig.color ?? defaults.fog.color);
      scene.fog.near = Number.isFinite(fogConfig.near) ? fogConfig.near : defaults.fog.near;
      scene.fog.far = Number.isFinite(fogConfig.far) ? fogConfig.far : defaults.fog.far;
    }
  }

  if (hemisphere){
    const hemisphereConfig = environment.hemisphere ?? {};
    hemisphere.color.set(hemisphereConfig.skyColor ?? defaults.hemisphere.skyColor);
    hemisphere.groundColor.set(hemisphereConfig.groundColor ?? defaults.hemisphere.groundColor);
    hemisphere.intensity = Number.isFinite(hemisphereConfig.intensity)
      ? hemisphereConfig.intensity
      : defaults.hemisphere.intensity;
  }

  if (sun){
    const sunConfig = environment.sun ?? {};
    sun.color.set(sunConfig.color ?? defaults.sun.color);
    sun.intensity = Number.isFinite(sunConfig.intensity) ? sunConfig.intensity : defaults.sun.intensity;
    if (sunConfig.position){
      assignVector3(sun.position, sunConfig.position);
    } else {
      assignVector3(sun.position, defaults.sun.position);
    }
  }
}

function buildDescriptorFromDefinition(mapDefinition){
  if (!mapDefinition) return null;
  let descriptor = null;
  if (mapDefinition.descriptor && typeof mapDefinition.descriptor === 'object'){
    descriptor = cloneMapDescriptor(mapDefinition.descriptor);
    descriptor.id = descriptor.id ?? mapDefinition.id;
    descriptor.type = descriptor.type ?? mapDefinition.type;
    if (!descriptor.tileSize && Number.isFinite(mapDefinition.tileSize)){
      descriptor.tileSize = mapDefinition.tileSize;
    }
    if (!descriptor.visibleRadius){
      const fallbackRadius = Number.isFinite(mapDefinition.visibleRadius)
        ? mapDefinition.visibleRadius
        : Number.isFinite(mapDefinition.radius)
          ? mapDefinition.radius
          : null;
      if (Number.isFinite(fallbackRadius)){
        descriptor.visibleRadius = fallbackRadius;
      }
    }
  } else if (mapDefinition.type === 'tilemap'){
    descriptor = { ...mapDefinition };
  }
  return descriptor;
}

function createWorldFromDescriptor({ scene, mapDefinition }){
  const descriptor = buildDescriptorFromDefinition(mapDefinition);
  const descriptorType = typeof descriptor?.type === 'string'
    ? descriptor.type.toLowerCase()
    : descriptor?.type;

  if (descriptorType === 'tilemap'){
    descriptor.type = 'tilemap';
    descriptor.tiles = Array.isArray(descriptor.tiles)
      ? descriptor.tiles.map((tile) => cloneTileDescriptor(tile))
      : Array.isArray(mapDefinition?.tiles)
        ? mapDefinition.tiles.map((tile) => cloneTileDescriptor(tile))
        : [];
    if (!descriptor.tileSize){
      descriptor.tileSize = Number.isFinite(mapDefinition?.tileSize)
        ? mapDefinition.tileSize
        : Number.isFinite(mapDefinition?.chunkSize)
          ? mapDefinition.chunkSize
          : 640;
    }
    if (Number.isFinite(descriptor.visibleRadius)){
      mapDefinition.visibleRadius = descriptor.visibleRadius;
    }
    mapDefinition.tiles = descriptor.tiles.map((tile) => cloneTileDescriptor(tile));
    mapDefinition.tileSize = descriptor.tileSize;
    return new TileMapWorld({ scene, descriptor });
  }

  if (!mapDefinition.procedural && descriptor?.procedural){
    const proceduralClone = cloneProceduralConfig(descriptor.procedural);
    if (proceduralClone) mapDefinition.procedural = proceduralClone;
  }
  const chunkSize = Number.isFinite(mapDefinition?.chunkSize)
    ? mapDefinition.chunkSize
    : Number.isFinite(descriptor?.chunkSize)
      ? descriptor.chunkSize
      : 640;
  const radius = Number.isFinite(mapDefinition?.radius)
    ? mapDefinition.radius
    : Number.isFinite(descriptor?.radius)
      ? descriptor.radius
      : 3;
  const seed = Number.isFinite(mapDefinition?.seed) ? mapDefinition.seed : 982451653;
  const generatorConfig = mapDefinition?.procedural
    ?? mapDefinition?.generator
    ?? descriptor?.procedural
    ?? descriptor?.generator
    ?? null;
  return new TerraWorldStreamer({ scene, chunkSize, radius, seed, generator: generatorConfig });
}

export function initializeWorldForMap({
  scene,
  mapDefinition,
  currentWorld = null,
  collisionSystem,
  projectileManager,
  environment = {},
  defaults = DEFAULT_WORLD_ENVIRONMENT,
} = {}){
  const normalizedDefinition = mapDefinition
    ? cloneMapDefinition(mapDefinition)
    : null;

  if (currentWorld?.dispose){
    collisionSystem?.setWorld?.(null);
    projectileManager?.setWorld?.(null);
    currentWorld.dispose();
  }

  const world = createWorldFromDescriptor({ scene, mapDefinition: normalizedDefinition ?? cloneMapDefinition(mapDefinition) ?? {} });

  if (collisionSystem){
    collisionSystem.setWorld(world);
  }
  if (projectileManager){
    projectileManager.setWorld(world);
  }

  applyMapEnvironment({
    mapDefinition: normalizedDefinition,
    scene,
    documentRef: environment.document,
    hemisphere: environment.hemisphere,
    sun: environment.sun,
    defaults,
  });

  return { world, collisionSystem, projectileManager, mapDefinition: normalizedDefinition };
}
