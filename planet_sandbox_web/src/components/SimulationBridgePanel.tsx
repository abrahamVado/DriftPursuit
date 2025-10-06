import { useCallback, useEffect, useMemo, useState } from 'react';
import { resolveSimulationBridgeConfig } from '../lib/backendConfig';

type CommandName = 'throttle' | 'brake';

const DEFAULT_STATUS = 'Simulation bridge offline.';
const CONFIG_HINT = 'Set VITE_SIM_BRIDGE_URL (e.g. http://localhost:8000) to enable interactive control.';

const SimulationBridgePanel = () => {
  //1.- Capture the configured bridge endpoints once so the component can reuse them across renders.
  const bridgeConfig = useMemo(() => resolveSimulationBridgeConfig(), []);
  const [status, setStatus] = useState(DEFAULT_STATUS);
  const [error, setError] = useState('');
  const [lastCommand, setLastCommand] = useState('none');

  useEffect(() => {
    //1.- Abort any pending handshake when the component unmounts or the configuration changes.
    const controller = new AbortController();
    let cancelled = false;

    if (!bridgeConfig) {
      setStatus(DEFAULT_STATUS);
      setError(CONFIG_HINT);
      return () => controller.abort();
    }

    //2.- Initiate the handshake workflow to confirm the Python bridge is reachable.
    setStatus('Negotiating with simulation bridge…');
    setError('');
    fetch(bridgeConfig.handshakeUrl, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as { message?: string };
        if (!response.ok) {
          const message = typeof payload.message === 'string' ? payload.message : `Handshake failed with status ${response.status}`;
          throw new Error(message);
        }
        if (!cancelled) {
          setStatus(payload.message ?? 'Simulation bridge online');
          setError('');
        }
      })
      .catch((reason: unknown) => {
        if (cancelled) {
          return;
        }
        const message = reason instanceof Error ? reason.message : 'Unknown handshake error';
        setStatus(DEFAULT_STATUS);
        setError(`Handshake error: ${message}`);
      });

    return () => {
      //3.- Cancel the outstanding fetch so React strict mode remounts do not leak requests.
      cancelled = true;
      controller.abort();
    };
  }, [bridgeConfig]);

  const handleCommand = useCallback(
    async (command: CommandName) => {
      //1.- Prevent command dispatches when the bridge has not been configured yet.
      if (!bridgeConfig) {
        setError(CONFIG_HINT);
        return;
      }
      try {
        setError('');
        const response = await fetch(bridgeConfig.commandUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command, issuedAtMs: Date.now() })
        });
        const payload = (await response.json().catch(() => ({}))) as { command?: { command?: string } };
        if (!response.ok) {
          const message = typeof payload?.command?.command === 'string' ? payload.command.command : undefined;
          throw new Error(message ?? `Command failed with status ${response.status}`);
        }
        setLastCommand(payload.command?.command ?? command);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : 'Unknown command error';
        setError(`Command error: ${message}`);
      }
    },
    [bridgeConfig]
  );

  return (
    <section className="bridge-panel" aria-live="polite">
      <header>
        <h2>Simulation Bridge</h2>
        <p>{status}</p>
      </header>
      <div className="bridge-status">
        {bridgeConfig ? (
          <span className="bridge-target">Target: {bridgeConfig.baseUrl}</span>
        ) : (
          <span className="bridge-hint">{CONFIG_HINT}</span>
        )}
        {error && <span className="bridge-error">{error}</span>}
      </div>
      <div className="bridge-controls">
        <button type="button" onClick={() => void handleCommand('throttle')}>
          Throttle
        </button>
        <button type="button" onClick={() => void handleCommand('brake')}>
          Brake
        </button>
      </div>
      <p className="bridge-last-command">Last command: {lastCommand}</p>
    </section>
  );
};

export default SimulationBridgePanel;
