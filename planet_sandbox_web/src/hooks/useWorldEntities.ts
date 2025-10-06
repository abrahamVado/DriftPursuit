import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createWorldSession,
  type EntityTransform,
  type WorldSessionHandle
} from '@client/networking/worldSession';
import {
  buildFallbackToken,
  resolveBrokerConfig,
  type BrokerConfig
} from '../lib/backendConfig';

type WorldStatus = 'idle' | 'connecting' | 'connected' | 'error';

type Dependencies = {
  resolveConfig: () => BrokerConfig | null;
  createSession: typeof createWorldSession;
  buildToken: (subject: string) => string;
};

const DEFAULT_DEPENDENCIES: Dependencies = {
  resolveConfig: resolveBrokerConfig,
  createSession: createWorldSession,
  buildToken: buildFallbackToken
};

export interface UseWorldEntitiesOptions {
  dependencies?: Partial<Dependencies>;
}

export interface UseWorldEntitiesResult {
  status: WorldStatus;
  entities: Map<string, EntityTransform>;
  error?: string;
}

export function useWorldEntities(options?: UseWorldEntitiesOptions): UseWorldEntitiesResult {
  //1.- Merge optional dependency overrides so tests can inject fakes without mutating globals.
  const deps = useMemo(() => ({ ...DEFAULT_DEPENDENCIES, ...(options?.dependencies ?? {}) }), [options?.dependencies]);
  const [status, setStatus] = useState<WorldStatus>('idle');
  const [error, setError] = useState<string | undefined>();
  const [entities, setEntities] = useState<Map<string, EntityTransform>>(new Map());
  const sessionRef = useRef<WorldSessionHandle | null>(null);

  useEffect(() => {
    //1.- Resolve the broker configuration up front to short-circuit when misconfigured.
    const config = deps.resolveConfig();
    if (!config) {
      setStatus('error');
      setError('Broker URL not configured. Set VITE_BROKER_URL to enable live telemetry.');
      setEntities(new Map());
      return () => undefined;
    }

    let cancelled = false;
    const authToken = config.token && config.token.trim() !== '' ? config.token : undefined;
    const authSecret = config.secret && config.secret.trim() !== '' ? config.secret : undefined;
    const token = authToken ?? (authSecret ? undefined : deps.buildToken(config.subject));

    //2.- Create the world session so the hook can listen for roster and transform updates.
    const session = deps.createSession({
      dial: {
        url: config.url,
        protocols: config.protocols,
        auth: {
          subject: config.subject,
          token,
          secret: authSecret,
          audience: config.audience,
          ttlSeconds: config.ttlSeconds
        }
      }
    });
    sessionRef.current = session;

    const unsubscribe = session.store.subscribe((snapshot) => {
      //3.- Clone the world snapshot into component state whenever the broker publishes updates.
      if (cancelled) {
        return;
      }
      setEntities(new Map(snapshot));
    });

    const statusListener = (event: Event) => {
      //4.- Surface disconnects as actionable errors while leaving reconnect logic to the caller.
      if (cancelled) {
        return;
      }
      const detail = (event as CustomEvent<string>).detail;
      if (detail === 'disconnected') {
        setStatus('error');
        setError('Disconnected from broker.');
      }
    };
    session.client.addEventListener('status', statusListener as EventListener);

    setStatus('connecting');
    setError(undefined);

    session
      .connect()
      .then(() => {
        //5.- Confirm the live telemetry feed is active once the session resolves its first dial attempt.
        if (cancelled) {
          return;
        }
        setStatus('connected');
      })
      .catch((reason: unknown) => {
        if (cancelled) {
          return;
        }
        setStatus('error');
        const message = reason instanceof Error ? reason.message : 'Failed to connect to broker.';
        setError(message);
      });

    return () => {
      //6.- Dispose of the session cleanly to avoid leaking timers or WebSocket handles across re-renders.
      cancelled = true;
      session.client.removeEventListener('status', statusListener as EventListener);
      unsubscribe();
      session.dispose();
      sessionRef.current = null;
    };
  }, [deps]);

  return useMemo(
    () => ({
      status,
      entities,
      error
    }),
    [status, entities, error]
  );
}
