import { Hono } from 'hono';
import { serve, type ServerType } from '@hono/node-server';

// ============================================================
// TYPES
// ============================================================

export interface HarnessLifecycle {
  readonly app: Hono;
  listen(port: number): Promise<void>;
  close(): Promise<void>;
}

// ============================================================
// ASSERT JSON OBJECT
// ============================================================

/**
 * Assert parsed value is non-null, non-array object.
 * Throws on null, array, or non-object types.
 * Returns narrowed Record<string, unknown>.
 * Ref: core/src/harness/http.ts:86-91
 */
export function assertJsonObject(parsed: unknown): Record<string, unknown> {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Request body must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

// ============================================================
// HARNESS LIFECYCLE
// ============================================================

/**
 * Create Hono app with serve/close lifecycle.
 * serverTweaks called after serve() with raw server.
 * close() is idempotent. Sync construction, async listen.
 * Ref: core/src/harness/http.ts:165-180
 */
export function createHarnessLifecycle(options?: {
  serverTweaks?: (server: unknown) => void;
}): HarnessLifecycle {
  const app = new Hono();
  let server: ServerType | undefined;

  async function listen(port: number): Promise<void> {
    if (server !== undefined) {
      throw new Error('Server is already listening');
    }
    return new Promise((resolve) => {
      server = serve({ fetch: app.fetch, port }, () => {
        options?.serverTweaks?.(server);
        resolve();
      });
    });
  }

  async function close(): Promise<void> {
    if (server !== undefined) {
      server.close();
      server = undefined;
    }
  }

  return { app, listen, close };
}
