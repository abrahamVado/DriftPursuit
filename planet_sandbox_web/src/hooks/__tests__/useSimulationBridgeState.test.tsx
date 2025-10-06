import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SimulationBridgeConfig } from '../../lib/backendConfig';
import { useSimulationBridgeState } from '../useSimulationBridgeState';

describe('useSimulationBridgeState', () => {
  const bridgeConfig: SimulationBridgeConfig = {
    baseUrl: 'http://localhost:8000',
    handshakeUrl: 'http://localhost:8000/handshake',
    commandUrl: 'http://localhost:8000/command',
    stateUrl: 'http://localhost:8000/state'
  };

  afterEach(() => {
    //1.- Restore the environment between tests so spies do not leak into other suites.
    vi.clearAllMocks();
  });

  it('reports a disabled status when the bridge URL is missing', () => {
    const { result } = renderHook(() =>
      useSimulationBridgeState({
        dependencies: {
          resolveConfig: () => null
        }
      })
    );

    expect(result.current.status).toBe('disabled');
    expect(result.current.snapshot).toBeNull();
    expect(result.current.error).toMatch(/VITE_SIM_BRIDGE_URL/);
  });

  it('polls the state endpoint and normalises vehicle telemetry', async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(
        JSON.stringify({
          status: 'ok',
          tickId: 24,
          capturedAtMs: 1_234,
          vehicles: {
            alpha: { x: 1.5, y: '2', z: 3, speed: '450' },
            beta: { x: -5, y: 0.5, z: 8 }
          }
        }),
        { status: 200 }
      )
    );

    const { result, unmount } = renderHook(() =>
      useSimulationBridgeState({
        pollIntervalMs: 10_000,
        dependencies: {
          resolveConfig: () => bridgeConfig,
          fetch: fetchSpy,
          now: () => 9_999
        }
      })
    );

    await waitFor(() => {
      //1.- Wait for the hook to transition into the ready state before reading the snapshot.
      expect(result.current.status).toBe('ready');
    });

    expect(fetchSpy).toHaveBeenCalledWith('http://localhost:8000/state', expect.any(Object));
    expect(result.current.error).toBeUndefined();
    expect(result.current.snapshot).not.toBeNull();
    expect(result.current.snapshot?.tickId).toBe(24);
    expect(result.current.snapshot?.capturedAtMs).toBe(1_234);
    expect(result.current.snapshot?.receivedAtMs).toBe(9_999);
    expect(result.current.snapshot?.vehicles).toEqual([
      {
        id: 'alpha',
        position: { x: 1.5, y: 2, z: 3 },
        speed: 450
      },
      {
        id: 'beta',
        position: { x: -5, y: 0.5, z: 8 }
      }
    ]);

    unmount();
  });

  it('surfaces errors returned by the bridge', async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify({ message: 'bridge offline' }), { status: 503 })
    );

    const { result, unmount } = renderHook(() =>
      useSimulationBridgeState({
        dependencies: {
          resolveConfig: () => bridgeConfig,
          fetch: fetchSpy
        }
      })
    );

    await waitFor(() => {
      //1.- Confirm the hook surfaced the error before asserting on the message contents.
      expect(result.current.status).toBe('error');
    });
    expect(result.current.error).toMatch(/bridge offline/);
    unmount();
  });
});
