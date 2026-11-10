import type { NoirClient } from './client';

/**
 * Lazy NOIR transport: the concrete client (live HTTP or deterministic mock)
 * is loaded on first method call, so its code never lands in the shared shell
 * bundle. Methods are promise delegates; `withToken` binds to the same loaded
 * client without polluting the caller's cache.
 */
export function createLazyNoirClient(load: () => Promise<NoirClient>): NoirClient {
  return new Proxy({} as NoirClient, {
    get(_target, prop) {
      if (prop === 'withToken') {
        return (sessionToken: string) =>
          createLazyNoirClient(() => load().then((c) => c.withToken(sessionToken)));
      }
      if (prop === 'session' || prop === 'player' || prop === 'actions') {
        return new Proxy(
          {},
          {
            get(_group, method) {
              return (...args: unknown[]) =>
                load().then((c) => {
                  const group = c[prop] as unknown as Record<string, (...a: unknown[]) => unknown>;
                  const fn = group[method as string];
                  if (typeof fn !== 'function') {
                    throw new Error(`noir: unknown method ${String(method)}`);
                  }
                  return fn(...args);
                });
            },
          },
        );
      }
      return undefined;
    },
  });
}
