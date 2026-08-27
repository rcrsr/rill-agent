import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createAhiExtension, type AhiExtensionConfig } from '../src/index.js';
import type { RillValue } from '@rcrsr/rill';

describe('createAhiExtension', () => {
  // ============================================================
  // EC-2: unresolved env variable in static URL
  // ============================================================

  describe('EC-2: unresolved env variable throws at init', () => {
    it('throws synchronously when a ${VAR} is unset', () => {
      const config: AhiExtensionConfig = {
        agents: {
          parser: { url: 'http://${MISSING_VAR}/api' },
        },
      };

      expect(() => createAhiExtension(config)).toThrow(
        'AHI: environment variable MISSING_VAR is not set'
      );
    });

    it('throws at init time, not at call time', () => {
      // Verify the throw happens inside the factory, not lazily
      let threw = false;
      try {
        createAhiExtension({
          agents: { svc: { url: '${ALSO_MISSING}' } },
        });
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });

    it('resolves set env variables without throwing', () => {
      const original = process.env['AHI_TEST_URL'];
      process.env['AHI_TEST_URL'] = 'http://localhost:4001';

      try {
        expect(() =>
          createAhiExtension({
            agents: { svc: { url: 'http://${AHI_TEST_URL}/api' } },
          })
        ).not.toThrow();
      } finally {
        if (original === undefined) {
          delete process.env['AHI_TEST_URL'];
        } else {
          process.env['AHI_TEST_URL'] = original;
        }
      }
    });
  });

  // ============================================================
  // AC-1: agents object registers ahi::<name>
  // ============================================================

  describe('AC-1: agents object registers ahi::<name> host function', () => {
    it('registers ahi::parser for a single agent', () => {
      const result = createAhiExtension({
        agents: { parser: { url: 'http://localhost:4001' } },
      });

      expect('parser' in result).toBe(true);
    });

    it('registered function is a callable with a fn property', () => {
      const result = createAhiExtension({
        agents: { parser: { url: 'http://localhost:4001' } },
      });

      const fn = result['parser'];
      expect(fn).toBeDefined();
      expect(typeof fn!.fn).toBe('function');
      expect(fn!.__type).toBe('callable');
    });

    it('registers multiple agents', () => {
      const result = createAhiExtension({
        agents: {
          parser: { url: 'http://localhost:4001' },
          writer: { url: 'http://localhost:4002' },
        },
      });

      expect('parser' in result).toBe(true);
      expect('writer' in result).toBe(true);
    });

    it('registered function is async', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ result: null })));
      vi.stubGlobal('fetch', mockFetch);

      try {
        const result = createAhiExtension({
          agents: { parser: { url: 'http://localhost:4001' } },
        });

        const fn = result['parser']!;
        // fn returns a Promise (async function)
        const returnValue = fn.fn(
          [] as unknown as Record<string, import('@rcrsr/rill').RillValue>,
          {} as never,
          undefined
        );
        expect(returnValue).toBeInstanceOf(Promise);
        await (returnValue as Promise<unknown>).catch(() => undefined);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('includes dispose method', () => {
      const result = createAhiExtension({
        agents: { parser: { url: 'http://localhost:4001' } },
      });

      expect(typeof result.dispose).toBe('function');
    });
  });

  // ============================================================
  // AC-20: empty agents object
  // ============================================================

  describe('AC-20: empty agents object registers nothing', () => {
    it('returns empty result with no ahi:: functions', () => {
      const result = createAhiExtension({ agents: {} });

      const functionKeys = Object.keys(result).filter(
        (k) => k !== 'dispose' && k !== 'suspend' && k !== 'restore'
      );
      expect(functionKeys).toHaveLength(0);
    });

    it('does not throw for empty agents', () => {
      expect(() => createAhiExtension({ agents: {} })).not.toThrow();
    });

    it('still includes dispose method', () => {
      const result = createAhiExtension({ agents: {} });
      expect(typeof result.dispose).toBe('function');
    });
  });

  // ============================================================
  // AC-17: ${MISSING_VAR} throws at init (explicit test)
  // ============================================================

  describe('AC-17: ${MISSING_VAR} throws at init', () => {
    it('throws before returning an ExtensionResult', () => {
      let result: ReturnType<typeof createAhiExtension> | undefined;
      let error: Error | undefined;

      try {
        result = createAhiExtension({
          agents: { svc: { url: 'http://${MISSING_VAR}' } },
        });
      } catch (e) {
        error = e as Error;
      }

      expect(result).toBeUndefined();
      expect(error).toBeDefined();
      expect(error!.message).toContain('MISSING_VAR');
    });
  });

  // ============================================================
  // General: env var substitution
  // ============================================================

  describe('env var substitution', () => {
    beforeEach(() => {
      process.env['AHI_HOST'] = 'agents.example.com';
      process.env['AHI_PORT'] = '8080';
    });

    afterEach(() => {
      delete process.env['AHI_HOST'];
      delete process.env['AHI_PORT'];
    });

    it('substitutes a single env var in a URL', () => {
      // No throw means substitution succeeded
      expect(() =>
        createAhiExtension({
          agents: { svc: { url: 'http://${AHI_HOST}/api' } },
        })
      ).not.toThrow();
    });

    it('substitutes multiple env vars in a single URL', () => {
      expect(() =>
        createAhiExtension({
          agents: { svc: { url: 'http://${AHI_HOST}:${AHI_PORT}/api' } },
        })
      ).not.toThrow();
    });

    it('throws when second of two vars is unset', () => {
      expect(() =>
        createAhiExtension({
          agents: { svc: { url: 'http://${AHI_HOST}:${UNSET_PORT}/api' } },
        })
      ).toThrow('AHI: environment variable UNSET_PORT is not set');
    });
  });

  // ============================================================
  // #51: URL primitive resolution — no double slash, protocol validation
  // ============================================================

  describe('#51: agent URL resolution uses the URL primitive', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    async function callParser(
      ext: ReturnType<typeof createAhiExtension>
    ): Promise<void> {
      const fn = (ext as Record<string, unknown>)['parser'] as {
        fn: (
          args: unknown,
          ctx: { metadata: Record<string, string> }
        ) => Promise<RillValue>;
      };
      await fn
        .fn([], { metadata: { agentName: 'a', sessionId: 's' } })
        .catch(() => undefined);
    }

    it('hits .../run without a double slash when the base URL has no trailing slash', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ result: null })));
      vi.stubGlobal('fetch', mockFetch);

      const ext = createAhiExtension({
        agents: { parser: { url: 'http://localhost:4001' } },
      });

      await callParser(ext);

      const calledUrl = String(mockFetch.mock.calls[0]?.[0]);
      expect(calledUrl).toBe('http://localhost:4001/run');
    });

    it('hits .../run without a double slash when the base URL has a trailing slash', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ result: null })));
      vi.stubGlobal('fetch', mockFetch);

      const ext = createAhiExtension({
        agents: { parser: { url: 'http://localhost:4001/' } },
      });

      await callParser(ext);

      const calledUrl = String(mockFetch.mock.calls[0]?.[0]);
      expect(calledUrl).toBe('http://localhost:4001/run');
    });

    it('throws for a file:// agent URL', () => {
      expect(() =>
        createAhiExtension({
          agents: { parser: { url: 'file:///etc/passwd' } },
        })
      ).toThrow(/protocol/);
    });

    it('throws for an ftp:// agent URL', () => {
      expect(() =>
        createAhiExtension({
          agents: { parser: { url: 'ftp://localhost/agent' } },
        })
      ).toThrow(/protocol/);
    });
  });

  // ============================================================
  // #52: config shape validation
  // ============================================================

  describe('#52: config shape validation', () => {
    it('throws a descriptive error when agents is missing', () => {
      expect(() =>
        createAhiExtension({} as unknown as AhiExtensionConfig)
      ).toThrow(/agents/);
    });

    it('throws a descriptive error when agents is not an object', () => {
      expect(() =>
        createAhiExtension({ agents: 5 } as unknown as AhiExtensionConfig)
      ).toThrow(/agents/);
    });

    it('throws a descriptive error when timeout is not a finite number', () => {
      expect(() =>
        createAhiExtension({
          agents: { parser: { url: 'http://localhost:4001' } },
          timeout: '30s' as unknown as number,
        })
      ).toThrow(/timeout/);
    });

    it('throws a descriptive error when timeout is NaN', () => {
      expect(() =>
        createAhiExtension({
          agents: { parser: { url: 'http://localhost:4001' } },
          timeout: Number.NaN,
        })
      ).toThrow(/timeout/);
    });

    it('does not throw for a valid config', () => {
      expect(() =>
        createAhiExtension({
          agents: { parser: { url: 'http://localhost:4001' } },
          timeout: 5000,
        })
      ).not.toThrow();
    });
  });
});
