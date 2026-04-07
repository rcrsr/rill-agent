import { Hono } from 'hono';
import { serve, type ServerType } from '@hono/node-server';
import type { AgentRouter, RunRequest } from '../types.js';

// ============================================================
// PUBLIC TYPES
// ============================================================

export interface HttpHarness {
  listen(port?: number): Promise<void>;
  close(): Promise<void>;
  readonly app: Hono;
}

// ============================================================
// PARAM VALIDATION
// ============================================================

function validateParams(
  params: Record<string, unknown>,
  agentName: string,
  router: AgentRouter
): string | null {
  const desc = router.describe(agentName);
  if (desc === null) return null;

  for (const param of desc.params) {
    const value = params[param.name];
    if (param.required && value === undefined) {
      return `Missing required parameter: ${param.name}`;
    }
    if (value !== undefined && param.type !== 'any') {
      const actual = typeof value;
      const expected = param.type === 'dict' ? 'object' : param.type;
      if (expected === 'list') {
        if (!Array.isArray(value)) {
          return `Parameter "${param.name}" must be a list, got ${actual}`;
        }
      } else if (actual !== expected) {
        return `Parameter "${param.name}" must be ${param.type}, got ${actual}`;
      }
    }
  }

  return null;
}

// ============================================================
// HTTP HARNESS
// ============================================================

/**
 * Create an HTTP harness wrapping an AgentRouter.
 *
 * Routes:
 *   POST /agents/:name/run  — execute a named agent
 *   POST /run               — execute the default agent
 *   GET  /agents            — list agents with descriptions
 */
export function httpHarness(router: AgentRouter): HttpHarness {
  const app = new Hono();
  let server: ServerType | undefined;

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
    const body = (await c.req.json()) as Record<string, unknown>;
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
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('not found')) {
        return c.json({ error: message }, 404);
      }
      return c.json({ error: message }, 500);
    }
  });

  // Run default agent
  app.post('/run', async (c) => {
    const body = (await c.req.json()) as Record<string, unknown>;
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
    return new Promise((resolve) => {
      server = serve({ fetch: app.fetch, port }, () => {
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

  return { listen, close, app };
}
