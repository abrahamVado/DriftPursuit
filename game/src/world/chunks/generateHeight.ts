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

export function heightAt(x:number,z:number){
  const hills = fbm(x,z,4,2.0,0.5) * 40
  const mountains = Math.pow(fbm(x+1000,z+1000,5,2.1,0.45), 3) * 120
  const base = hills + mountains
  const waterline = 8
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
