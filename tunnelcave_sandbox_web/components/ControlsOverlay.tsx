import styles from "./ControlsOverlay.module.css";

interface OverlayProps {
  speed: number;
  targetSpeed: number;
}

export function ControlsOverlay({ speed, targetSpeed }: OverlayProps) {
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
      </div>
      <div className={styles.instructions}>
        <p>Controls</p>
        <ul>
          <li>Arrow Up / Down – Raise or lower velocity target</li>
          <li>W / S – Pitch the craft up or down</li>
          <li>Q / E – Yaw the craft left or right</li>
          <li>A / B – Roll the craft left or right</li>
          <li>Space – Re-center orientation</li>
          <li>Shift – Boost follow camera tightness</li>
        </ul>
      </div>
    </div>
  );
}
