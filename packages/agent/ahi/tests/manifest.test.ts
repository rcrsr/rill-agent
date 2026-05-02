import { describe, it, expect, vi } from 'vitest';
import { extensionManifest, type AhiExtensionConfig } from '../src/index.js';
import { RuntimeError } from '@rcrsr/rill';
import type { RillValue } from '@rcrsr/rill';

// ============================================================
// HELPERS
// ============================================================

/** Minimal valid config so createAhiExtension does not throw */
const VALID_CONFIG: AhiExtensionConfig = {
  agents: { svc: { url: 'http://localhost:4001' } },
};

/** Build a mock ExtensionFactoryCtx with a controllable AbortSignal */
function makeCtx(): {
  ctx: {
    registerErrorCode: ReturnType<typeof vi.fn>;
    readonly signal: AbortSignal;
  };
  controller: AbortController;
} {
  const controller = new AbortController();
  const ctx = {
    registerErrorCode: vi.fn<[string, string], void>(),
    signal: controller.signal,
  };
  return { ctx, controller };
}

/**
 * Extract the named ApplicationCallable from a factory value object and
 * invoke its fn. Uses the same cast pattern as static-success.test.ts.
 */
async function callFn(value: unknown, agentName: string): Promise<unknown> {
  const fn = (
    value as Record<
      string,
      {
        fn: (
          args: Record<string, RillValue>,
          ctx: object
        ) => Promise<RillValue>;
      }
    >
  )[agentName]!;
  return fn.fn([] as unknown as Record<string, RillValue>, {});
}

// ============================================================
// extensionManifest
// ============================================================

describe('extensionManifest', () => {
  // ============================================================
  // AC-49: configSchema is defined
  // ============================================================

  it('configSchema is defined and non-null', () => {
    expect(extensionManifest.configSchema).toBeDefined();
    expect(extensionManifest.configSchema).not.toBeNull();
  });

  // ============================================================
  // Factory: resolves without error with a valid config + ctx
  // ============================================================

  it('factory resolves without error given a valid config and mock ctx', async () => {
    const { ctx } = makeCtx();
    await expect(
      extensionManifest.factory(VALID_CONFIG, ctx)
    ).resolves.toBeDefined();
  });

  // ============================================================
  // registerErrorCode: exactly 8 calls
  // ============================================================

  it('calls ctx.registerErrorCode exactly 8 times', async () => {
    const { ctx } = makeCtx();
    await extensionManifest.factory(VALID_CONFIG, ctx);
    expect(ctx.registerErrorCode).toHaveBeenCalledTimes(8);
  });

  // ============================================================
  // registerErrorCode: correct code + kind pairs
  // ============================================================

  describe('error code registrations', () => {
    it('registers RILL-R027 as validation', async () => {
      const { ctx } = makeCtx();
      await extensionManifest.factory(VALID_CONFIG, ctx);
      expect(ctx.registerErrorCode).toHaveBeenCalledWith(
        'RILL-R027',
        'validation'
      );
    });

    it('registers RILL-R028 as transport', async () => {
      const { ctx } = makeCtx();
      await extensionManifest.factory(VALID_CONFIG, ctx);
      expect(ctx.registerErrorCode).toHaveBeenCalledWith(
        'RILL-R028',
        'transport'
      );
    });

    it('registers RILL-R029 as downstream', async () => {
      const { ctx } = makeCtx();
      await extensionManifest.factory(VALID_CONFIG, ctx);
      expect(ctx.registerErrorCode).toHaveBeenCalledWith(
        'RILL-R029',
        'downstream'
      );
    });

    it('registers RILL-R030 as timeout', async () => {
      const { ctx } = makeCtx();
      await extensionManifest.factory(VALID_CONFIG, ctx);
      expect(ctx.registerErrorCode).toHaveBeenCalledWith(
        'RILL-R030',
        'timeout'
      );
    });

    it('registers RILL-R031 as transport', async () => {
      const { ctx } = makeCtx();
      await extensionManifest.factory(VALID_CONFIG, ctx);
      expect(ctx.registerErrorCode).toHaveBeenCalledWith(
        'RILL-R031',
        'transport'
      );
    });

    it('registers RILL-R032 as capacity', async () => {
      const { ctx } = makeCtx();
      await extensionManifest.factory(VALID_CONFIG, ctx);
      expect(ctx.registerErrorCode).toHaveBeenCalledWith(
        'RILL-R032',
        'capacity'
      );
    });

    it('registers RILL-R033 as lifecycle', async () => {
      const { ctx } = makeCtx();
      await extensionManifest.factory(VALID_CONFIG, ctx);
      expect(ctx.registerErrorCode).toHaveBeenCalledWith(
        'RILL-R033',
        'lifecycle'
      );
    });

    it('registers RILL-R034 as downstream', async () => {
      const { ctx } = makeCtx();
      await extensionManifest.factory(VALID_CONFIG, ctx);
      expect(ctx.registerErrorCode).toHaveBeenCalledWith(
        'RILL-R034',
        'downstream'
      );
    });
  });

  // ============================================================
  // Signal wiring: aborting ctx.signal triggers dispose
  // ============================================================

  it('aborting ctx.signal causes subsequent calls to throw RILL-R033', async () => {
    const { ctx, controller } = makeCtx();
    const factoryResult = await extensionManifest.factory(VALID_CONFIG, ctx);

    // Abort the signal — fires the dispose listener wired in the factory
    controller.abort();

    // Subsequent calls must throw RILL-R033
    const thrown = await callFn(factoryResult.value, 'svc').catch(
      (e: unknown) => e
    );
    expect(thrown).toBeInstanceOf(RuntimeError);
    expect((thrown as RuntimeError).errorId).toBe('RILL-R033');
  });

  // ============================================================
  // Explicit dispose: aborts in-flight calls independently
  // ============================================================

  it('explicit dispose() causes subsequent calls to throw RILL-R033', async () => {
    const { ctx } = makeCtx();
    const factoryResult = await extensionManifest.factory(VALID_CONFIG, ctx);

    await factoryResult.dispose?.();

    const thrown = await callFn(factoryResult.value, 'svc').catch(
      (e: unknown) => e
    );
    expect(thrown).toBeInstanceOf(RuntimeError);
    expect((thrown as RuntimeError).errorId).toBe('RILL-R033');
  });

  // ============================================================
  // Double-teardown safety
  // ============================================================

  it('abort then dispose does not throw', async () => {
    const { ctx, controller } = makeCtx();
    const factoryResult = await extensionManifest.factory(VALID_CONFIG, ctx);

    controller.abort();
    await expect(async () => factoryResult.dispose?.()).not.toThrow();
  });

  it('dispose then abort does not throw', async () => {
    const { ctx, controller } = makeCtx();
    const factoryResult = await extensionManifest.factory(VALID_CONFIG, ctx);

    await factoryResult.dispose?.();
    expect(() => controller.abort()).not.toThrow();
  });
});
