import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildFallbackToken,
  resolveBrokerConfig,
  resolveSimulationBridgeConfig
} from '../backendConfig';

declare const process: { env: Record<string, string | undefined> };

const originalEnv = { ...process.env };

describe('backendConfig', () => {
  beforeEach(() => {
    //1.- Reset the environment map before each assertion to avoid cross-test pollution.
    process.env = {};
  });

  afterEach(() => {
    //1.- Restore the captured environment so other suites observe their preferred configuration.
    process.env = { ...originalEnv };
  });

  it('returns null when the broker URL is missing', () => {
    //1.- Without an explicit broker endpoint the hook should decline to connect.
    expect(resolveBrokerConfig()).toBeNull();
  });

  it('captures broker configuration from Vite-prefixed environment variables', () => {
    //1.- Seed the environment with Vite-compatible keys so the resolver can harvest them.
    process.env.VITE_BROKER_URL = ' ws://localhost:43127/ws ';
    process.env.VITE_BROKER_SUBJECT = ' Pilot 01 ';
    process.env.VITE_BROKER_PROTOCOLS = ' proto1 , proto2 ';
    process.env.VITE_BROKER_TTL_SECONDS = '120';
    process.env.VITE_BROKER_AUDIENCE = 'driftpursuit';
    process.env.VITE_BROKER_TOKEN = ' token-value ';

    const result = resolveBrokerConfig();
    expect(result).not.toBeNull();
    expect(result?.url).toBe('ws://localhost:43127/ws');
    expect(result?.subject).toBe('pilot-01');
    expect(result?.protocols).toEqual(['proto1', 'proto2']);
    expect(result?.ttlSeconds).toBe(120);
    expect(result?.audience).toBe('driftpursuit');
    expect(result?.token).toBe('token-value');
  });

  it('derives a fallback token using the sandbox prefix', () => {
    //1.- Construct a deterministic credential for local development scenarios.
    expect(buildFallbackToken('pilot-03')).toBe('sandbox-pilot-03');
  });

  it('produces simulation bridge URLs when configured', () => {
    //1.- Provide the bridge origin so the resolver can expand the endpoint paths.
    process.env.VITE_SIM_BRIDGE_URL = 'http://localhost:8000/';
    const config = resolveSimulationBridgeConfig();
    expect(config).not.toBeNull();
    expect(config?.baseUrl).toBe('http://localhost:8000');
    expect(config?.handshakeUrl).toBe('http://localhost:8000/handshake');
    expect(config?.commandUrl).toBe('http://localhost:8000/command');
    expect(config?.stateUrl).toBe('http://localhost:8000/state');
  });
});
