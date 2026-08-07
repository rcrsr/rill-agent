import {
  validateParams,
  routerErrorToStatus,
  createRouter,
  assembleManifest,
} from '@rcrsr/rill-agent';
import {
  assertJsonObject,
  createHarnessLifecycle,
  runRillServe,
  readHarnessPort,
  assertCompiledHandlers,
  type RillHarness,
} from '@rcrsr/rill-agent-hono-kit';
import type { AgentRouter, RunRequest } from '@rcrsr/rill-agent';
import type { Hono } from 'hono';

const HARNESS_NAME = '@rcrsr/rill-agent-http';

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

// ============================================================
// RILL CLI HARNESS ADAPTER
// ============================================================

/**
 * Default export consumed by the rill CLI (`rill install --replace`,
 * `rill run`) when this package is declared as a bundle harness. `serve`
 * assembles a router from the bundle's compiled packages and hosts it over the
 * HTTP harness on `config.port` (default 3000).
 */
const harness: RillHarness = {
  name: HARNESS_NAME,
  postBuild: async (ctx) => {
    assertCompiledHandlers(ctx);
  },
  serve: (ctx) =>
    runRillServe(ctx, async (entries) => {
      const router = await createRouter(await assembleManifest(entries));
      const server = httpHarness(router);
      const port = readHarnessPort(ctx.config, 3000);
      await server.listen(port);
      ctx.logger.info(`[${HARNESS_NAME}] listening on :${port}`);
      return server;
    }),
};

export default harness;
