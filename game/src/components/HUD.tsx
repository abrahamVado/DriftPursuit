'use client'
import { useEffect, useRef, useState } from 'react'

type HudState = {
  speed: number
  altitude: number
  stage: number
  score: number
  weapon: string
  ammo: number
  missiles: number
  laserCooldown: number
  bombArmed: boolean
}

export function HUD({ getState, actions }: { getState: () => HudState | undefined, actions: () => any }) {
  const [state, setState] = useState<HudState | undefined>(undefined)
  useEffect(() => {
    let raf = 0
    const loop = () => {
      setState(getState())
      raf = requestAnimationFrame(loop)
    }
    loop()
    return () => cancelAnimationFrame(raf)
  }, [getState])

  return (
    <div style={{ position:'absolute', inset:0, pointerEvents:'none' }}>
      <div style={{ position:'absolute', left:16, top:12, display:'grid', gap:6, fontFamily:'monospace' }}>
        <div>SPD: <b>{state?.speed.toFixed?.(0) ?? '--'}</b> m/s</div>
        <div>ALT: <b>{state?.altitude.toFixed?.(0) ?? '--'}</b> m AGL</div>
        <div>STAGE: <b>{state?.stage ?? 1}</b></div>
        <div>SCORE: <b>{state?.score ?? 0}</b></div>
      </div>
      <div style={{ position:'absolute', right:16, top:12, textAlign:'right', fontFamily:'monospace' }}>
        <div>WEAPON: <b>{state?.weapon ?? 'GATLING'}</b></div>
        <div>AMMO: <b>{state?.ammo ?? 0}</b></div>
        <div>MIS: <b>{state?.missiles ?? 0}</b></div>
        <div>LASER CD: <b>{Math.max(0, (state?.laserCooldown ?? 0)/1000).toFixed(1)}</b>s</div>
      </div>
      <div style={{ position:'absolute', inset:0, display:'grid', placeItems:'center', opacity:0.85 }}>
        <div style={{
          width:18, height:18, border:'2px solid #8cf', borderRadius:4,
          boxShadow:'0 0 12px #9df', transform:'translateY(-8px)'
        }}/>
      </div>
      <div style={{ position:'absolute', left:'50%', top:'50%', transform:'translate(-50%, -50%) translateY(32px)', fontSize:12, opacity:.6 }}>
        move: mouse • throttle: W/S • roll: Q/E • yaw: A/D • boost: Shift • fire: Space • bomb: F • 1..4 switch
      </div>
    </div>
  )
}
