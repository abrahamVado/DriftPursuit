import React from 'react'

export interface MiniMapEntitySnapshot {
  //1.- Unique identifier so React can stabilise list rendering.
  id: string
  //2.- Friendly label displayed inside the legend.
  label: string
  //3.- Horizontal position in world metres relative to the battlefield centre.
  x: number
  //4.- Depth position in world metres relative to the battlefield centre.
  z: number
}

export interface MiniMapOverlayProps {
  //1.- Size of the square battlefield so coordinates can be normalised into percentages.
  fieldSize: number
  //2.- Player craft location rendered with a highlighted marker.
  player: { x: number; z: number }
  //3.- Other pilots rendered as secondary markers with a supporting legend.
  peers: MiniMapEntitySnapshot[]
}

function clampPercent(value: number): number {
  //1.- Restrict percentages into the drawable SVG range to avoid rendering artefacts.
  return Math.min(100, Math.max(0, value))
}

function normaliseCoordinate(coordinate: number, fieldSize: number): number {
  //1.- Translate from world units into a 0-100 range while guarding against zero-sized fields.
  if (fieldSize <= 0) {
    return 50
  }
  const half = fieldSize / 2
  const normalised = ((coordinate + half) / fieldSize) * 100
  return clampPercent(normalised)
}

export function MiniMapOverlay({ fieldSize, player, peers }: MiniMapOverlayProps) {
  //1.- Convert world coordinates into map percentages for the player marker.
  const playerX = normaliseCoordinate(player.x, fieldSize)
  const playerY = 100 - normaliseCoordinate(player.z, fieldSize)
  return (
    <section aria-label="Battlefield minimap" className="hud-minimap" data-testid="hud-minimap">
      <svg className="hud-minimap__canvas" viewBox="0 0 100 100">
        {/* 1.- Draw the map background with rounded corners so the overlay fits the HUD theme. */}
        <rect className="hud-minimap__background" height="100" rx="10" ry="10" width="100" x="0" y="0" />
        {/* 2.- Render peer markers before the player so the local pilot always sits on top. */}
        {peers.map((peer) => {
          const peerX = normaliseCoordinate(peer.x, fieldSize)
          const peerY = 100 - normaliseCoordinate(peer.z, fieldSize)
          return (
            <circle
              className="hud-minimap__peer"
              cx={peerX}
              cy={peerY}
              data-label={peer.label}
              data-player-id={peer.id}
              data-testid="minimap-peer"
              key={peer.id}
              r={4}
            />
          )
        })}
        {/* 3.- Highlight the local craft marker with a larger radius. */}
        <circle className="hud-minimap__player" cx={playerX} cy={playerY} data-testid="minimap-player" r={6} />
      </svg>
      <div className="hud-minimap__legend" data-testid="minimap-legend">
        {/* 4.- Label the legend entries so pilots can correlate markers to callsigns. */}
        <p className="hud-minimap__legend-title">Formation</p>
        <ul className="hud-minimap__legend-list">
          <li className="hud-minimap__legend-item">You</li>
          {peers.map((peer) => (
            <li className="hud-minimap__legend-item" data-player-id={peer.id} key={`legend-${peer.id}`}>
              {peer.label}
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
