import { validateParams, routerErrorToStatus } from '@rcrsr/rill-agent';
import {
  assertJsonObject,
  createHarnessLifecycle,
} from '@rcrsr/rill-agent-hono-kit';
import type { AgentRouter, RunRequest } from '@rcrsr/rill-agent';
import type { Hono } from 'hono';

// ============================================================
// PUBLIC TYPES
// ============================================================

export interface HttpHarness {
  listen(port?: number): Promise<void>;
  close(): Promise<void>;
  readonly app: Hono;
}

// ============================================================
// HTTP HARNESS
// ============================================================

/**
 * Create an HTTP harness wrapping an AgentRouter.
 *
 * Routes:
 *   GET  /agents            — list agents with descriptions
 *   POST /agents/:name/run  — execute a named agent
 *   POST /run               — execute the default agent
 */
export function httpHarness(router: AgentRouter): HttpHarness {
  const lifecycle = createHarnessLifecycle();
  const { app } = lifecycle;

  // List agents
  app.get('/agents', (c) => {
    const names = router.agents();
    const agents = names.map((name) => ({
      name,
      description: router.describe(name),
      default: name === router.defaultAgent(),
    }));
    return c.json({ agents });
  });

  // Run named agent
  app.post('/agents/:name/run', async (c) => {
    const name = c.req.param('name');

    let body: Record<string, unknown>;
    try {
      const parsed: unknown = await c.req.json();
      body = assertJsonObject(parsed);
    } catch {
      return c.json({ error: 'Request body must be a JSON object' }, 400);
    }

    const params = (body['params'] as Record<string, unknown>) ?? {};

    const validationError = validateParams(params, name, router);
    if (validationError !== null) {
      return c.json({ error: validationError }, 400);
    }

    const request: RunRequest = {
      params,
      ...(typeof body['timeout'] === 'number'
        ? { timeout: body['timeout'] }
        : {}),
    };

    try {
      const response = await router.run(name, request);
      return c.json(response);
    } catch (err) {
      const status = routerErrorToStatus(err);
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, status as 404 | 500);
    }
  });

  // Run default agent
  app.post('/run', async (c) => {
    let body: Record<string, unknown>;
    try {
      const parsed: unknown = await c.req.json();
      body = assertJsonObject(parsed);
    } catch {
      return c.json({ error: 'Request body must be a JSON object' }, 400);
    }

    const params = (body['params'] as Record<string, unknown>) ?? {};
    const defaultName = router.defaultAgent();

    const validationError = validateParams(params, defaultName, router);
    if (validationError !== null) {
      return c.json({ error: validationError }, 400);
    }

    const request: RunRequest = {
      params,
      ...(typeof body['timeout'] === 'number'
        ? { timeout: body['timeout'] }
        : {}),
    };

    try {
      const response = await router.run('', request);
      return c.json(response);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  async function listen(port = 3000): Promise<void> {
    return lifecycle.listen(port);
  }

  return { listen, close: lifecycle.close, app };
}
