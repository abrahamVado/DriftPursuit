'use client'
export function LoadingOverlay() {
  return (
    <div style={{
      position:'absolute', inset:0, display:'grid', placeItems:'center',
      background:'linear-gradient(180deg,#0a0d12,#090c11 40%, #0b0f15)'
    }}>
      <div style={{textAlign:'center'}}>
        <div style={{fontSize:28, letterSpacing:2}}>Spooling Up The War Machine...</div>
        <div style={{opacity:0.7, marginTop:8}}>Initializing terrain, vehicles, and enemies</div>
      </div>
    </div>
  )
}
