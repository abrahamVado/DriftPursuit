import styles from "./ControlsOverlay.module.css";

interface OverlayProps {
  speed: number;
  targetSpeed: number;
  assistEnabled: boolean;
}

export function ControlsOverlay({ speed, targetSpeed, assistEnabled }: OverlayProps) {
  return (
    <div className={styles.overlay}>
      <div>
        <h1 className={styles.title}>Tunnelcave Sandbox</h1>
        <p className={styles.subtitle}>Procedural endless cave flight demo</p>
      </div>
      <div className={styles.metrics}>
        <span>
          Speed: <strong>{speed.toFixed(1)} m/s</strong>
        </span>
        <span>
          Target: <strong>{targetSpeed.toFixed(1)} m/s</strong>
        </span>
        <span>
          Assist: <strong>{assistEnabled ? "Guided" : "Free flight"}</strong>
        </span>
      </div>
      <div className={styles.instructions}>
        <p>Controls</p>
        <ul>
          <li>F – Toggle guided assist ({assistEnabled ? "on" : "off"})</li>
          <li>W / S or ↑ / ↓ – Throttle forward / reverse</li>
          <li>A / D (Q / E) – Roll left / right</li>
          <li>I / K – Pitch up / down</li>
          <li>← / → – Yaw left / right</li>
          <li>J / L or PgDn / PgUp – Vertical thrust down / up</li>
          <li>Shift / Space – Boost</li>
          <li>R – Reset to spawn, B – Beam, M – Missile</li>
        </ul>
      </div>
    </div>
  );
}
