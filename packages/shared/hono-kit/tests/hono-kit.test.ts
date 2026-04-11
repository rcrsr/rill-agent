import { afterEach, describe, expect, it } from 'vitest';

import { assertJsonObject, createHarnessLifecycle } from '../src/index.js';
import type { HarnessLifecycle } from '../src/index.js';

// ============================================================
// ASSERT JSON OBJECT
// ============================================================

describe('assertJsonObject', () => {
  describe('throws on non-object input', () => {
    it('throws on null', () => {
      expect(() => assertJsonObject(null)).toThrow(
        'Request body must be a JSON object'
      );
    });

    it('throws on array', () => {
      expect(() => assertJsonObject([1, 2, 3])).toThrow(
        'Request body must be a JSON object'
      );
    });

    it('throws on string', () => {
      expect(() => assertJsonObject('hello')).toThrow(
        'Request body must be a JSON object'
      );
    });

    it('throws on number', () => {
      expect(() => assertJsonObject(42)).toThrow(
        'Request body must be a JSON object'
      );
    });
  });

  describe('returns valid object', () => {
    it('returns the object unchanged for a plain object', () => {
      const input = { key: 'value', count: 1 };
      const result = assertJsonObject(input);
      expect(result).toBe(input);
    });

    it('returns an empty object', () => {
      const input = {};
      const result = assertJsonObject(input);
      expect(result).toBe(input);
    });
  });
});

// ============================================================
// CREATE HARNESS LIFECYCLE
// ============================================================

describe('createHarnessLifecycle', () => {
  const lifecycles: HarnessLifecycle[] = [];

  afterEach(async () => {
    for (const lc of lifecycles.splice(0)) {
      await lc.close().catch(() => undefined);
    }
  });

  function make(
    opts?: Parameters<typeof createHarnessLifecycle>[0]
  ): HarnessLifecycle {
    const lc = createHarnessLifecycle(opts);
    lifecycles.push(lc);
    return lc;
  }

  it('exposes a Hono app on the returned object [AC-18]', () => {
    const lc = make();
    expect(lc.app).toBeDefined();
  });

  it('listen starts the server and resolves [AC-18]', async () => {
    const lc = make();
    await expect(lc.listen(0)).resolves.toBeUndefined();
  });

  it('serverTweaks is called with the raw server before listen resolves [AC-19]', async () => {
    let tweakArg: unknown;
    const lc = make({
      serverTweaks: (server) => {
        tweakArg = server;
      },
    });
    await lc.listen(0);
    expect(tweakArg).toBeDefined();
  });

  it('listen called twice throws [EC-6]', async () => {
    const lc = make();
    await lc.listen(0);
    await expect(lc.listen(0)).rejects.toThrow('Server is already listening');
  });

  it('close called twice does not throw [AC-20]', async () => {
    const lc = make();
    await lc.listen(0);
    await expect(lc.close()).resolves.toBeUndefined();
    await expect(lc.close()).resolves.toBeUndefined();
  });

  it('close when never listened does not throw [AC-20]', async () => {
    const lc = make();
    await expect(lc.close()).resolves.toBeUndefined();
  });
});
