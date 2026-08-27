import { existsSync } from 'node:fs';
import path from 'node:path';
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
    return new Promise((resolve, reject) => {
      const started = serve({ fetch: app.fetch, port }, () => {
        started.off('error', onError);
        options?.serverTweaks?.(started);
        resolve();
      });
      function onError(err: Error): void {
        server = undefined;
        reject(err);
      }
      started.once('error', onError);
      server = started;
    });
  }

  async function close(): Promise<void> {
    if (server === undefined) return;
    const current = server;
    server = undefined;
    if ('closeAllConnections' in current) {
      (current as { closeAllConnections(): void }).closeAllConnections();
    }
    await new Promise<void>((resolve, reject) => {
      current.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  return { app, listen, close };
}

// ============================================================
// RILL CLI HARNESS CONTRACT (structural)
// ============================================================

// Structural mirror of the @rcrsr/rill-cli RillHarness interface (see
// rill-cli src/harness.ts). Declared locally — restricted to the fields the
// router-backed adapters actually read — so the harness packages implement
// the CLI contract without taking a runtime dependency on the CLI.

export interface RillHarnessLogger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export interface RillCompiledPackage {
  readonly mount: string;
  readonly buildOutput: { readonly outputPath: string };
}

export interface RillServeContext {
  readonly config: Record<string, unknown>;
  readonly logger: RillHarnessLogger;
  readonly packages: readonly RillCompiledPackage[];
  readonly requestedMount: string | undefined;
  readonly args: readonly string[];
  readonly onShutdown: (handler: () => void | Promise<void>) => void;
  readonly onSourceChange: (handler: () => void | Promise<void>) => void;
}

export interface RillPostBuildContext {
  readonly outputDir: string;
  readonly packages: readonly RillCompiledPackage[];
  readonly logger: RillHarnessLogger;
}

export interface RillHarness {
  readonly name: string;
  readonly postBuild?: (ctx: RillPostBuildContext) => Promise<void>;
  readonly serve?: (ctx: RillServeContext) => Promise<number>;
}

/** A started server the shared serve glue can close on shutdown. */
export interface ServerHandle {
  close(): Promise<void>;
}

/**
 * Map a serve/post-build context's compiled packages to (name, dir) manifest
 * entries, keyed by mount. The dir is each package's compiled output path,
 * which contains the built handler.js.
 */
export function compiledPackageEntries(ctx: {
  packages: readonly RillCompiledPackage[];
}): Array<{ name: string; dir: string }> {
  return ctx.packages.map((p) => ({
    name: p.mount,
    dir: p.buildOutput.outputPath,
  }));
}

/**
 * Read an integer port from the bundle `config` object, accepting a number or
 * an all-digit string. Falls back to `fallback` when absent or malformed.
 */
export function readHarnessPort(
  config: Record<string, unknown>,
  fallback: number
): number {
  const p = config['port'];
  if (typeof p === 'number' && Number.isInteger(p)) return p;
  if (typeof p === 'string' && /^\d+$/.test(p)) return Number(p);
  return fallback;
}

/**
 * Assert each compiled package emitted a handler.js. Router-backed harnesses
 * use this as their `postBuild` hook so `rill build` fails fast on a package
 * that produced no handler, signalling failure by throwing per the RillHarness
 * contract.
 */
export function assertCompiledHandlers(ctx: RillPostBuildContext): void {
  for (const pkg of ctx.packages) {
    const handlerPath = path.join(pkg.buildOutput.outputPath, 'handler.js');
    if (!existsSync(handlerPath)) {
      throw new Error(`missing handler file: ${handlerPath}`);
    }
  }
}

/**
 * Shared serve glue for router-backed harness adapters. Starts the server via
 * `start`, registers its close on shutdown, then returns a pending promise so
 * the CLI's serve/shutdown race (see rill-cli runBundleServe) owns the exit
 * code — the server keeps running until SIGINT/SIGTERM triggers close.
 */
export async function runRillServe(
  ctx: RillServeContext,
  start: (
    entries: ReadonlyArray<{ name: string; dir: string }>
  ) => Promise<ServerHandle>
): Promise<number> {
  const handle = await start(compiledPackageEntries(ctx));
  ctx.onShutdown(async () => {
    await handle.close();
  });
  return new Promise<number>(() => {
    // Intentionally never resolves: the CLI races serve() against its own
    // shutdown promise and supplies the exit code.
  });
}
