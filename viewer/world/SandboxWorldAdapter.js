import { WorldStreamer } from '../sandbox/WorldStreamer.js';

const THREE = (typeof window !== 'undefined' ? window.THREE : globalThis?.THREE) ?? null;
if (!THREE) throw new Error('Sandbox world adapter requires THREE to be loaded globally');

export function createSandboxWorld({ scene, descriptor } = {}){
  if (!scene){
    throw new Error('createSandboxWorld requires a scene reference');
  }

  const chunkSize = Number(descriptor?.chunkSize) || Number(descriptor?.tileSize) || 640;
  const radius = Math.max(1, Math.round(Number(descriptor?.visibleRadius ?? 2)));
  let seed = descriptor?.seed ?? 982451653;
  if (typeof seed === 'string'){
    seed = hashStringToInt(seed);
  }
  if (!Number.isFinite(seed)){
    seed = 982451653;
  }

  const streamer = new WorldStreamer({ scene, chunkSize, radius, seed });

  return {
    update(focusPosition){
      if (!focusPosition) return;
      streamer.update(focusPosition);
    },
    handleOriginShift(shift){
      streamer.handleOriginShift(shift);
    },
    dispose(){
      streamer.dispose();
    },
    getHeightAt(x, y){
      return streamer.getHeightAt(x, y);
    },
    getObstaclesNear(x, y, queryRadius){
      return streamer.getObstaclesNear(x, y, queryRadius);
    },
  };
}

function hashStringToInt(value){
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1){
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
