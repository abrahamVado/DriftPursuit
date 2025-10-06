import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EntityTransform, WorldSessionHandle } from '@client/networking/worldSession';
import { useWorldEntities } from '../useWorldEntities';

describe('useWorldEntities', () => {
  afterEach(() => {
    //1.- Ensure mocks reset between tests so each scenario starts from a clean slate.
    vi.clearAllMocks();
  });

  it('reports an error when the broker configuration is missing', () => {
    const { result } = renderHook(() =>
      useWorldEntities({
        dependencies: {
          resolveConfig: () => null
        }
      })
    );

    expect(result.current.status).toBe('error');
    expect(result.current.error).toContain('Broker URL not configured');
    expect(result.current.entities.size).toBe(0);
  });

  it('connects to the broker and publishes entity snapshots', async () => {
    const storeSubscribers = new Set<(snapshot: ReadonlyMap<string, EntityTransform>) => void>();
    const fakeEntity: EntityTransform = {
      entityId: 'craft-1',
      tickId: 42,
      capturedAtMs: 1_000,
      keyframe: true,
      position: { x: 1, y: 2, z: 3 },
      orientation: { yawDeg: 0, pitchDeg: 0, rollDeg: 0 }
    };

    let resolveConnect: (() => void) | undefined;
    const connectPromise = new Promise<void>((resolve) => {
      resolveConnect = resolve;
    });

    const createSession = vi.fn(() => {
      const client = new EventTarget();
      const handle: WorldSessionHandle = {
        client,
        store: {
          subscribe: (subscriber) => {
            storeSubscribers.add(subscriber);
            subscriber(new Map([[fakeEntity.entityId, fakeEntity]]));
            return () => {
              storeSubscribers.delete(subscriber);
            };
          }
        },
        connect: () => connectPromise,
        disconnect: vi.fn(),
        dispose: vi.fn(),
        trackEntity: () => () => undefined
      };
      return handle;
    });

    const { result } = renderHook(() =>
      useWorldEntities({
        dependencies: {
          resolveConfig: () => ({
            url: 'ws://broker.test/ws',
            subject: 'pilot',
            token: 'token'
          }),
          createSession
        }
      })
    );

    expect(result.current.status).toBe('connecting');
    expect(result.current.entities.size).toBe(1);

    await act(async () => {
      resolveConnect?.();
      await connectPromise;
    });

    expect(result.current.status).toBe('connected');
    expect(result.current.entities.get('craft-1')).toEqual(fakeEntity);

    await act(async () => {
      for (const subscriber of storeSubscribers) {
        subscriber(new Map());
      }
      await Promise.resolve();
    });

    expect(result.current.entities.size).toBe(0);
  });

  it('surfaces connection failures as errors', async () => {
    const failure = new Error('dial failed');
    const createSession = vi.fn(() => {
      const client = new EventTarget();
      const handle: WorldSessionHandle = {
        client,
        store: {
          subscribe: () => () => undefined
        },
        connect: () => Promise.reject(failure),
        disconnect: vi.fn(),
        dispose: vi.fn(),
        trackEntity: () => () => undefined
      };
      return handle;
    });

    const { result } = renderHook(() =>
      useWorldEntities({
        dependencies: {
          resolveConfig: () => ({ url: 'ws://broker/ws', subject: 'pilot' }),
          createSession
        }
      })
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('dial failed');
  });

  it('emits an error when the session broadcasts a disconnected status', async () => {
    let resolveConnect: (() => void) | undefined;
    const connectPromise = new Promise<void>((resolve) => {
      resolveConnect = resolve;
    });

    const client = new EventTarget();
    const createSession = vi.fn(() => {
      const handle: WorldSessionHandle = {
        client,
        store: {
          subscribe: () => () => undefined
        },
        connect: () => connectPromise,
        disconnect: vi.fn(),
        dispose: vi.fn(),
        trackEntity: () => () => undefined
      };
      return handle;
    });

    const { result } = renderHook(() =>
      useWorldEntities({
        dependencies: {
          resolveConfig: () => ({ url: 'ws://broker/ws', subject: 'pilot', token: 'token' }),
          createSession
        }
      })
    );

    await act(async () => {
      resolveConnect?.();
      await connectPromise;
    });

    expect(result.current.status).toBe('connected');

    await act(async () => {
      client.dispatchEvent(new CustomEvent('status', { detail: 'disconnected' }));
      await Promise.resolve();
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('Disconnected from broker.');
  });
});
