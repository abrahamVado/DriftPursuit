import { useEffect, useMemo, useState } from 'react';
import { resolveSimulationBridgeConfig, type SimulationBridgeConfig } from '../lib/backendConfig';

export type SimulationBridgeStatus = 'disabled' | 'idle' | 'loading' | 'ready' | 'error';

export interface BridgeVehicleSnapshot {
  id: string;
  position: { x: number; y: number; z: number };
  speed?: number;
}

export interface SimulationBridgeSnapshot {
  tickId: number;
  capturedAtMs: number;
  receivedAtMs: number;
  vehicles: BridgeVehicleSnapshot[];
}

type Dependencies = {
  resolveConfig: () => SimulationBridgeConfig | null;
  fetch: typeof fetch;
  now: () => number;
};

const DEFAULT_DEPENDENCIES: Dependencies = {
  //1.- Reuse the shared configuration resolver so the hook honours `.env.local` overrides.
  resolveConfig: resolveSimulationBridgeConfig,
  //2.- Delegate HTTP calls to the global fetch implementation for browser compatibility.
  fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init),
  //3.- Capture the current timestamp via `Date.now` so timestamps stay consistent across environments.
  now: () => Date.now()
};

export interface UseSimulationBridgeStateOptions {
  pollIntervalMs?: number;
  dependencies?: Partial<Dependencies>;
}

export interface UseSimulationBridgeStateResult {
  status: SimulationBridgeStatus;
  snapshot: SimulationBridgeSnapshot | null;
  error?: string;
}

interface BridgeStatePayload {
  status?: string;
  message?: string;
  tickId?: unknown;
  capturedAtMs?: unknown;
  vehicles?: unknown;
}

const DEFAULT_HINT = 'Set VITE_SIM_BRIDGE_URL (e.g. http://localhost:8000) to enable interactive control.';
const DEFAULT_POLL_INTERVAL_MS = 3_000;

function normaliseVehicles(source: unknown): BridgeVehicleSnapshot[] {
  //1.- Treat non-object payloads as empty telemetry so the UI can degrade gracefully.
  if (!source || typeof source !== 'object') {
    return [];
  }
  const vehicles: BridgeVehicleSnapshot[] = [];
  for (const [id, raw] of Object.entries(source as Record<string, unknown>)) {
    if (!id || !raw || typeof raw !== 'object') {
      continue;
    }
    const vector = raw as Record<string, unknown>;
    const x = Number(vector.x);
    const y = Number(vector.y);
    const z = Number(vector.z);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      continue;
    }
    const speedValue = Number((vector as Record<string, unknown>).speed);
    vehicles.push({
      id,
      position: { x, y, z },
      speed: Number.isFinite(speedValue) ? speedValue : undefined
    });
  }
  vehicles.sort((a, b) => a.id.localeCompare(b.id));
  return vehicles;
}

export function useSimulationBridgeState(
  options?: UseSimulationBridgeStateOptions
): UseSimulationBridgeStateResult {
  //1.- Merge dependency overrides so tests can stub fetch and configuration behaviour.
  const deps = useMemo(
    () => ({ ...DEFAULT_DEPENDENCIES, ...(options?.dependencies ?? {}) }),
    [options?.dependencies]
  );
  const [status, setStatus] = useState<SimulationBridgeStatus>('idle');
  const [snapshot, setSnapshot] = useState<SimulationBridgeSnapshot | null>(null);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    //1.- Resolve the simulation bridge configuration and surface actionable guidance when absent.
    const config = deps.resolveConfig();
    if (!config) {
      setStatus('disabled');
      setSnapshot(null);
      setError(DEFAULT_HINT);
      return () => undefined;
    }

    let cancelled = false;
    let controller: AbortController | null = null;

    const pollState = async () => {
      //1.- Abort the previous request to avoid overlapping polls when the interval fires quickly.
      controller?.abort();
      const nextController = new AbortController();
      controller = nextController;
      setStatus((previous) => (previous === 'ready' ? 'ready' : 'loading'));
      setError(undefined);
      try {
        const response = await deps.fetch(config.stateUrl, {
          cache: 'no-store',
          signal: nextController.signal
        });
        const payload = (await response.json().catch(() => ({}))) as BridgeStatePayload;
        if (!response.ok) {
          const message =
            typeof payload.message === 'string'
              ? payload.message
              : `State request failed with status ${response.status}`;
          throw new Error(message);
        }
        if (cancelled || nextController.signal.aborted) {
          return;
        }
        const receivedAtMs = deps.now();
        const tickId = typeof payload.tickId === 'number' ? payload.tickId : 0;
        const capturedAtMs =
          typeof payload.capturedAtMs === 'number' ? payload.capturedAtMs : receivedAtMs;
        const vehicles = normaliseVehicles(payload.vehicles);
        setSnapshot({
          tickId,
          capturedAtMs,
          receivedAtMs,
          vehicles
        });
        setStatus('ready');
        setError(undefined);
      } catch (cause) {
        if (cancelled || nextController.signal.aborted) {
          return;
        }
        const message = cause instanceof Error ? cause.message : 'Unknown state error';
        setStatus('error');
        setError(`State error: ${message}`);
      }
    };

    void pollState();
    const intervalMs = Math.max(1_000, options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
    const intervalId = window.setInterval(() => {
      void pollState();
    }, intervalMs);

    return () => {
      cancelled = true;
      controller?.abort();
      window.clearInterval(intervalId);
    };
  }, [deps, options?.pollIntervalMs]);

  return useMemo(
    () => ({
      status,
      snapshot,
      error
    }),
    [status, snapshot, error]
  );
}
