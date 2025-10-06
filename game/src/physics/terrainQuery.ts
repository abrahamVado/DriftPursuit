import { heightAt, normalAt } from '@/world/chunks/generateHeight'

export function altitudeAGL(x:number, y:number, z:number){
  return y - heightAt(x,z)
}

export function surfaceNormal(x:number,z:number){
  return normalAt(x,z)
}
