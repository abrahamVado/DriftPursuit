/* eslint-disable @typescript-eslint/no-explicit-any */
declare const process: undefined | { env?: Record<string, string | undefined> };

export interface BrokerConfig {
  url: string;
  subject: string;
  token?: string;
  secret?: string;
  audience?: string;
  ttlSeconds?: number;
  protocols?: string | string[];
}

export interface SimulationBridgeConfig {
  baseUrl: string;
  handshakeUrl: string;
  commandUrl: string;
  stateUrl: string;
}

const DEFAULT_SUBJECT = 'planet-sandbox';

function getMetaEnv(): Record<string, string | undefined> {
  //1.- Reach into the Vite-provided environment map while guarding against undefined during tests.
  const meta = (typeof import.meta !== 'undefined' ? (import.meta as any).env : undefined) as
    | Record<string, string | undefined>
    | undefined;
  return meta ?? {};
}

function getProcessEnv(): Record<string, string | undefined> {
  //1.- Capture Node-style environment variables so Vitest and scripts can override configuration.
  if (typeof process !== 'undefined' && process?.env) {
    return process.env;
  }
  return {};
}

function normalise(value: string | undefined): string {
  //1.- Trim whitespace and collapse empty strings to a single reusable sentinel value.
  const trimmed = value?.trim() ?? '';
  return trimmed;
}

function readEnvValue(...names: string[]): string {
  //1.- Resolve the first matching environment entry across Vite, Node, and compatibility prefixes.
  const metaEnv = getMetaEnv();
  const procEnv = getProcessEnv();
  for (const name of names) {
    const direct = normalise(metaEnv[name]);
    if (direct) {
      return direct;
    }
    if (!name.startsWith('VITE_')) {
      const viteAlias = normalise(metaEnv[`VITE_${name}`]);
      if (viteAlias) {
        return viteAlias;
      }
    }
    if (name.startsWith('NEXT_PUBLIC_')) {
      const suffix = name.replace(/^NEXT_PUBLIC_/, '');
      const vitePublic = normalise(metaEnv[`VITE_${suffix}`]);
      if (vitePublic) {
        return vitePublic;
      }
    }
    const proc = normalise(procEnv[name]);
    if (proc) {
      return proc;
    }
  }
  return '';
}

function normaliseSubject(candidate: string | undefined): string {
  //1.- Canonicalise the pilot subject so broker topics remain URL friendly.
  const trimmed = normalise(candidate);
  if (!trimmed) {
    return DEFAULT_SUBJECT;
  }
  const slug = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || DEFAULT_SUBJECT;
}

export function resolveBrokerConfig(): BrokerConfig | null {
  //1.- Collect the broker connection URL, returning null when it is missing.
  const url = normalise(readEnvValue('VITE_BROKER_URL', 'NEXT_PUBLIC_BROKER_URL', 'BROKER_URL'));
  if (!url) {
    return null;
  }
  //2.- Gather optional authentication material to hand off to the WebSocket dialer.
  const token = normalise(readEnvValue('VITE_BROKER_TOKEN', 'NEXT_PUBLIC_BROKER_TOKEN'));
  const secret = normalise(readEnvValue('VITE_BROKER_SECRET', 'NEXT_PUBLIC_BROKER_SECRET'));
  const audience = normalise(readEnvValue('VITE_BROKER_AUDIENCE', 'NEXT_PUBLIC_BROKER_AUDIENCE'));
  const ttlRaw = normalise(readEnvValue('VITE_BROKER_TTL_SECONDS', 'NEXT_PUBLIC_BROKER_TTL_SECONDS'));
  const ttlSeconds = ttlRaw ? Number.parseInt(ttlRaw, 10) : undefined;
  const protocolsRaw = normalise(readEnvValue('VITE_BROKER_PROTOCOLS', 'NEXT_PUBLIC_BROKER_PROTOCOLS'));
  const protocolsList = protocolsRaw
    ? protocolsRaw
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
    : [];
  const protocols: string | string[] | undefined =
    protocolsList.length === 0 ? undefined : protocolsList.length === 1 ? protocolsList[0] : protocolsList;
  return {
    url,
    subject: normaliseSubject(readEnvValue('VITE_BROKER_SUBJECT', 'NEXT_PUBLIC_BROKER_SUBJECT')),
    token: token || undefined,
    secret: secret || undefined,
    audience: audience || undefined,
    ttlSeconds: Number.isFinite(ttlSeconds ?? NaN) ? ttlSeconds : undefined,
    protocols
  };
}

export function resolveSimulationBridgeConfig(): SimulationBridgeConfig | null {
  //1.- Prefer the explicitly configured browser-facing base URL and fall back to server hints.
  const baseCandidate = normalise(readEnvValue('VITE_SIM_BRIDGE_URL', 'NEXT_PUBLIC_SIM_BRIDGE_URL', 'SIM_BRIDGE_URL'));
  if (!baseCandidate) {
    return null;
  }
  const baseUrl = baseCandidate.replace(/\/$/, '');
  return {
    baseUrl,
    handshakeUrl: `${baseUrl}/handshake`,
    commandUrl: `${baseUrl}/command`,
    stateUrl: `${baseUrl}/state`
  };
}

export function buildFallbackToken(subject: string): string {
  //1.- Create a deterministic developer token so local setups authenticate without extra configuration.
  return `sandbox-${subject}`;
}
