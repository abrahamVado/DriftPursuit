import { BaseWorldStreamer } from '../world/BaseWorldStreamer.js';

const THREE = (typeof window !== 'undefined' ? window.THREE : globalThis?.THREE) ?? null;
if (!THREE) throw new Error('Sandbox WorldStreamer requires THREE to be loaded globally');

export class WorldStreamer extends BaseWorldStreamer {
  constructor(options = {}){
    super({ ...options, THREE });
  }
}
