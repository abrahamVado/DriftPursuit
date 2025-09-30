import { BaseWorldStreamer } from '../world/BaseWorldStreamer.js';
import THREE from '../shared/threeProxy.js';

if (!THREE) throw new Error('Sandbox WorldStreamer requires THREE to be loaded globally');

export class WorldStreamer extends BaseWorldStreamer {
  constructor(options = {}){
    super({ ...options, THREE });
  }
}
