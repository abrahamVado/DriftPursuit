import { getDifficultyState, onDifficultyChange } from '@/engine/difficulty'
import { getWorldSeedSnapshot } from './worldSeed'

// Tiny FBM noise to get hills/mountains
function hash(x:number, z:number) { return Math.sin(x*127.1 + z*311.7)*43758.5453 % 1 }
function lerp(a:number,b:number,t:number){return a+(b-a)*t}
function smoothstep(t:number){return t*t*(3-2*t)}
function noise(x:number,z:number){
  const xi=Math.floor(x), zi=Math.floor(z)
  const xf=x-xi, zf=z-zi
  const h00=hash(xi,zi), h10=hash(xi+1,zi), h01=hash(xi,zi+1), h11=hash(xi+1,zi+1)
  const u=smoothstep(xf), v=smoothstep(zf)
  return lerp(lerp(h00,h10,u), lerp(h01,h11,u), v)
}

export function fbm(x:number,z:number, octaves=5, lacunarity=2, gain=0.5){
  let amp=1, freq=0.005, sum=0
  for(let i=0;i<octaves;i++){
    sum += amp * noise(x*freq, z*freq)
    freq *= lacunarity
    amp *= gain
  }
  return sum
}

let envCache = getDifficultyState().environment
onDifficultyChange((state) => {
  //1.- Keep a cached environment reference so repeated height lookups avoid redundant allocations.
  envCache = state.environment
})

export function heightAt(x:number,z:number){
  //1.- Derive canyon width and vertical richness modifiers from the cached difficulty state.
  const width = Math.max(0.6, envCache.canyonWidth)
  const richness = 0.8 + envCache.propDensity * 0.1
  const { noiseOffsetX, noiseOffsetZ, frequencyJitter } = getWorldSeedSnapshot()
  //2.- Blend the negotiated world seed offsets into the FBM lookups so terrain aligns across observers.
  const jitterScale = 1 + frequencyJitter * 0.25
  const scaledX = (x + noiseOffsetX) / width
  const scaledZ = (z + noiseOffsetZ) / width
  const hills = fbm(scaledX * jitterScale,scaledZ * jitterScale,4,2.0 + frequencyJitter * 0.25,0.5 + frequencyJitter * 0.05) * 40 * richness * (0.9 + frequencyJitter * 0.2)
  const mountains = Math.pow(fbm(scaledX+1000 + frequencyJitter * 180,scaledZ+1000 + frequencyJitter * 180,5,2.1 + frequencyJitter * 0.2,0.45), 3) * 120 * (1 + envCache.windStrength * 0.05) * (0.9 + frequencyJitter * 0.2)
  const base = (hills + mountains) / Math.max(1, width * 0.9)
  const waterline = 8 - envCache.windStrength * 0.4
  return Math.max(base, waterline)
}

export function normalAt(x:number,z:number, eps=0.75){
  const hL = heightAt(x-eps, z)
  const hR = heightAt(x+eps, z)
  const hD = heightAt(x, z-eps)
  const hU = heightAt(x, z+eps)
  const n = { x: hL - hR, y: 2*eps, z: hD - hU }
  const len = Math.hypot(n.x, n.y, n.z) || 1
  return { x: n.x/len, y: n.y/len, z: n.z/len }
}
