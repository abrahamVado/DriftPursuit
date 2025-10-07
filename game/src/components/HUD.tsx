'use client'
import { useEffect, useState } from 'react'

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

export function HUD({
  getState,
  actions,
}: {
  getState: () => HudState | undefined
  actions: () => {
    activateSpecial?: (index: number) => void
    fireMissile?: () => void
    fireLaser?: () => void
    dropBomb?: () => void
    firePrimary?: () => void
    shield?: () => void
    heal?: () => void
    dash?: () => void
    ultimate?: () => void
  }
}) {
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

  // ---------- Toolbar wiring ----------
  const acts = actions?.()
  const hotkeys = ['1','2','3','4','5','6','7','8']
  const labels  = ['Missile','Laser','Bomb','Gatling','Shield','Heal','Dash','Ult']

  const laserMax = 4000 // ms (design)
  const cooldownPct = [
    0,
    Math.max(0, Math.min(1, (state?.laserCooldown ?? 0) / laserMax)), // slot 2 (Laser)
    0, 0, 0, 0, 0, 0,
  ]

  const counts: number[] = [
    state?.missiles ?? 0,          // 1 Missile
    Math.ceil((state?.laserCooldown ?? 0) / 1000), // 2 Laser (seconds left)
    state?.bombArmed ? 1 : 0,      // 3 Bomb armed
    state?.ammo ?? 0,              // 4 Gatling ammo
    0, 0, 0, 0,                    // 5..8 misc
  ]

  function trigger(i: number) {
    if (acts?.activateSpecial) return acts.activateSpecial(i)
    switch (i) {
      case 0: return acts?.fireMissile?.()
      case 1: return acts?.fireLaser?.()
      case 2: return acts?.dropBomb?.()
      case 3: return acts?.firePrimary?.()
      case 4: return acts?.shield?.()
      case 5: return acts?.heal?.()
      case 6: return acts?.dash?.()
      case 7: return acts?.ultimate?.()
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const idx = hotkeys.indexOf(e.key)
      if (idx >= 0) {
        e.preventDefault()
        trigger(idx)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acts])

  // ---------- UI ----------
  return (
    <div style={{ position:'absolute', inset:0, pointerEvents:'none' }}>
      {/* TL stats */}
      <div style={{ position:'absolute', left:16, top:12, display:'grid', gap:6, fontFamily:'monospace' }}>
        <div>SPD: <b>{state?.speed?.toFixed?.(0) ?? '--'}</b> m/s</div>
        <div>ALT: <b>{state?.altitude?.toFixed?.(0) ?? '--'}</b> m AGL</div>
        <div>STAGE: <b>{state?.stage ?? 1}</b></div>
        <div>SCORE: <b>{state?.score ?? 0}</b></div>
      </div>

      {/* TR weapon readouts */}
      <div style={{ position:'absolute', right:16, top:12, textAlign:'right', fontFamily:'monospace' }}>
        <div>WEAPON: <b>{state?.weapon ?? 'GATLING'}</b></div>
        <div>AMMO: <b>{state?.ammo ?? 0}</b></div>
        <div>MIS: <b>{state?.missiles ?? 0}</b></div>
        <div>LASER CD: <b>{Math.max(0, (state?.laserCooldown ?? 0)/1000).toFixed(1)}</b>s</div>
      </div>

      {/* Center reticle */}
      <div style={{ position:'absolute', inset:0, display:'grid', placeItems:'center', opacity:0.85 }}>
        <div style={{
          width:18, height:18, border:'2px solid #8cf', borderRadius:4,
          boxShadow:'0 0 12px #9df', transform:'translateY(-8px)'
        }}/>
      </div>

      {/* Help hint */}
      <div style={{ position:'absolute', left:'50%', top:'50%', transform:'translate(-50%, -50%) translateY(32px)', fontSize:12, opacity:.6 }}>
        move: mouse • throttle: W/S • roll: Q/E • yaw: A/D • boost: Shift • fire: Space • bomb: F • 1..8 specials
      </div>

      {/* Bottom-center toolbar (8 specials) */}
      <div
        style={{
          position:'absolute', left:'50%', bottom:36, transform:'translateX(-50%)',
          pointerEvents:'auto', fontFamily:'monospace'
        }}
        aria-label="Special toolbar"
      >
        <div
          style={{
            padding:'8px 12px',
            background:'#3a2a1b', border:'3px solid #493b2a', borderRadius:12,
            boxShadow:'inset 0 0 0 2px #0008, 0 8px 0 #0006, 0 0 14px #000c'
          }}
        >
          <div style={{ display:'flex', gap:10 }}>
            {Array.from({length:8}).map((_, i) => {
              const cd = Math.max(0, Math.min(1, cooldownPct[i] || 0))
              return (
                <button
                  key={i}
                  onClick={() => trigger(i)}
                  title={`${labels[i]}  [${hotkeys[i]}]`}
                  style={{
                    position:'relative', width:64, height:64, borderRadius:10, cursor:'pointer',
                    background:'#1a2230', border:'3px solid #0e1219',
                    boxShadow:'inset 0 0 0 2px #0007, 0 4px 0 #0006, 0 0 10px #000b',
                    color:'#fff', textShadow:'1px 1px 0 #000a', pointerEvents:'auto'
                  }}
                >
                  {/* hotkey badge */}
                  <span style={{
                    position:'absolute', left:6, top:4, fontSize:12, fontWeight:700,
                    color:'#8de1ff', background:'#2d3e53', border:'2px solid #101922',
                    borderRadius:6, padding:'1px 5px'
                  }}>{hotkeys[i]}</span>

                  {/* label or replace with an icon later */}
                  <span style={{ fontSize:12, opacity:.9 }}>{labels[i]}</span>

                  {/* count (ammo / secs) */}
                  {typeof counts[i] === 'number' ? (
                    <span style={{ position:'absolute', right:6, bottom:4, fontWeight:700 }}>
                      {counts[i]}
                    </span>
                  ) : null}

                  {/* cooldown veil (fills from bottom) */}
                  <div style={{
                    position:'absolute', left:0, right:0, bottom:0,
                    height: `${cd*100}%`,
                    background: 'linear-gradient(#0008,#0000 30%), repeating-linear-gradient(135deg,#0004 0 6px,#0000 6px 12px)',
                    borderBottomLeftRadius:7, borderBottomRightRadius:7,
                    pointerEvents:'none'
                  }}/>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
