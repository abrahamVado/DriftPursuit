import type { FC } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

declare const global: { fetch: typeof fetch };

describe('SimulationBridgePanel', () => {
  beforeEach(() => {
    //1.- Provide a predictable fetch spy that individual tests can override.
    global.fetch = vi.fn();
    vi.resetModules();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('displays configuration guidance when the bridge URL is missing', async () => {
    vi.doMock('../../lib/backendConfig', () => ({
      resolveSimulationBridgeConfig: () => null
    }));
    const { default: Panel } = (await import('../SimulationBridgePanel')) as { default: FC };

    render(<Panel />);

    expect(screen.getByText(/simulation bridge offline/i)).toBeInTheDocument();
    expect(screen.getAllByText(/VITE_SIM_BRIDGE_URL/i).length).toBeGreaterThan(0);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('negotiates the handshake and sends commands to the configured bridge', async () => {
    const handshakeResponse = Promise.resolve(
      new Response(JSON.stringify({ message: 'Simulation bridge online' }), { status: 200 })
    );
    const commandResponse = Promise.resolve(
      new Response(JSON.stringify({ command: { command: 'throttle' } }), { status: 200 })
    );

    const fetchSpy = vi.fn().mockImplementation((url: RequestInfo | URL) => {
      if (`${url}`.endsWith('/handshake')) {
        return handshakeResponse;
      }
      return commandResponse;
    });
    global.fetch = fetchSpy;

    vi.doMock('../../lib/backendConfig', () => ({
      resolveSimulationBridgeConfig: () => ({
        baseUrl: 'http://localhost:8000',
        handshakeUrl: 'http://localhost:8000/handshake',
        commandUrl: 'http://localhost:8000/command',
        stateUrl: 'http://localhost:8000/state'
      })
    }));
    const { default: Panel } = (await import('../SimulationBridgePanel')) as { default: FC };

    render(<Panel />);

    await waitFor(() => expect(screen.getByText(/Simulation bridge online/i)).toBeInTheDocument());
    expect(fetchSpy).toHaveBeenCalledWith('http://localhost:8000/handshake', expect.any(Object));

    await userEvent.click(screen.getByRole('button', { name: /Throttle/i }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith('http://localhost:8000/command', expect.any(Object)));
    expect(screen.getByText(/Last command: throttle/i)).toBeInTheDocument();
  });

  it('surfaces handshake failures as actionable errors', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'not configured' }), { status: 500 })
    );
    global.fetch = fetchSpy;

    vi.doMock('../../lib/backendConfig', () => ({
      resolveSimulationBridgeConfig: () => ({
        baseUrl: 'http://localhost:8000',
        handshakeUrl: 'http://localhost:8000/handshake',
        commandUrl: 'http://localhost:8000/command',
        stateUrl: 'http://localhost:8000/state'
      })
    }));
    const { default: Panel } = (await import('../SimulationBridgePanel')) as { default: FC };

    render(<Panel />);

    await waitFor(() => expect(screen.getByText(/Handshake error/i)).toBeInTheDocument());
    expect(screen.getByText(/not configured/i)).toBeInTheDocument();
  });
});
