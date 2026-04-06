/**
 * Unit tests for resolveDeferredExtensions and resolveDeferredContext.
 *
 * Covered:
 *   IR-9   resolveDeferredExtensions resolves @{VAR} and returns extensions + dispose
 *   IR-10  resolveDeferredContext resolves @{VAR} per invocation
 *   EC-8   Missing variable throws AgentHostError('init') with variable name list
 *   EC-8   Factory throw wraps as AgentHostError('init') with mount alias and cause
 *   EC-9   Missing variable in context throws AgentHostError('init')
 *   AC-6   Extensions resolved and disposed after use
 *   AC-7   context.values @{VAR} resolves from runtimeConfig
 */

import { describe, it, expect, vi } from 'vitest';
import {
  resolveDeferredExtensions,
  resolveDeferredContext,
} from '../../src/index.js';
import { AgentHostError } from '../../src/index.js';
import type {
  DeferredExtensionEntry,
  DeferredContextEntry,
} from '@rcrsr/rill-agent-shared';

// ============================================================
// HELPERS
// ============================================================

/**
 * Build a minimal DeferredExtensionEntry whose factory returns a plain
 * ExtensionResult with an optional dispose hook.
 */
function makeDeferredEntry(
  mountAlias: string,
  configTemplate: Record<string, unknown>,
  requiredVars: readonly string[],
  options?: {
    factoryImpl?: (config: unknown) => object;
    disposeImpl?: () => void | Promise<void>;
  }
): DeferredExtensionEntry {
  const disposeImpl = options?.disposeImpl;
  const factoryImpl =
    options?.factoryImpl ??
    ((_config: unknown) => ({
      dispose: disposeImpl,
    }));

  const module = {
    default: factoryImpl,
  };

  return {
    mountAlias,
    module,
    manifest: {},
    configTemplate,
    requiredVars,
  };
}

// ============================================================
// describe: resolveDeferredExtensions
// ============================================================

describe('resolveDeferredExtensions', () => {
  // ----------------------------------------------------------
  // IR-9 / AC-6: Happy path — resolves and returns extensions + dispose
  // ----------------------------------------------------------
  it('resolves @{VAR} in configTemplate and returns extension instance (IR-9, AC-6)', async () => {
    let receivedConfig: unknown;
    const entry = makeDeferredEntry(
      'myExt',
      { apiKey: '@{API_KEY}', region: 'us-east-1' },
      ['API_KEY'],
      {
        factoryImpl: (config: unknown) => {
          receivedConfig = config;
          return {};
        },
      }
    );

    const result = await resolveDeferredExtensions([entry], {
      API_KEY: 'secret-key-123',
    });

    expect(result.extensions).toHaveProperty('myExt');
    expect(receivedConfig).toEqual({ apiKey: 'secret-key-123', region: 'us-east-1' });
    await result.dispose();
  });

  // ----------------------------------------------------------
  // AC-6: dispose() calls cleanup on each extension
  // ----------------------------------------------------------
  it('dispose() invokes the extension dispose handler (AC-6)', async () => {
    const disposeSpy = vi.fn();
    const entry = makeDeferredEntry(
      'disposableExt',
      {},
      [],
      { disposeImpl: disposeSpy }
    );

    const result = await resolveDeferredExtensions([entry], {});

    expect(disposeSpy).not.toHaveBeenCalled();
    await result.dispose();
    expect(disposeSpy).toHaveBeenCalledOnce();
  });

  // ----------------------------------------------------------
  // IR-9: Multiple entries — all resolved; dispose called in reverse
  // ----------------------------------------------------------
  it('resolves multiple entries and disposes in reverse order', async () => {
    const callOrder: string[] = [];

    const entry1 = makeDeferredEntry('ext1', {}, [], {
      disposeImpl: () => { callOrder.push('ext1'); },
    });
    const entry2 = makeDeferredEntry('ext2', {}, [], {
      disposeImpl: () => { callOrder.push('ext2'); },
    });

    const result = await resolveDeferredExtensions([entry1, entry2], {});

    expect(Object.keys(result.extensions)).toEqual(['ext1', 'ext2']);
    await result.dispose();
    expect(callOrder).toEqual(['ext2', 'ext1']);
  });

  // ----------------------------------------------------------
  // EC-8: Missing required variable throws AgentHostError('init')
  // ----------------------------------------------------------
  it('throws AgentHostError(init) when required variable is absent (EC-8, AC-9)', async () => {
    const entry = makeDeferredEntry(
      'ext1',
      { key: '@{MISSING_VAR}' },
      ['MISSING_VAR']
    );

    await expect(
      resolveDeferredExtensions([entry], {})
    ).rejects.toSatisfy((err: unknown) => {
      return (
        err instanceof AgentHostError &&
        err.phase === 'init' &&
        err.message.includes('MISSING_VAR')
      );
    });
  });

  // ----------------------------------------------------------
  // EC-8: Multiple missing variables — all names listed in error
  // ----------------------------------------------------------
  it('lists all missing variable names in the error (EC-8)', async () => {
    const entry = makeDeferredEntry(
      'ext1',
      { a: '@{VAR_A}', b: '@{VAR_B}' },
      ['VAR_A', 'VAR_B']
    );

    await expect(
      resolveDeferredExtensions([entry], { VAR_A: 'present' })
    ).rejects.toSatisfy((err: unknown) => {
      return (
        err instanceof AgentHostError &&
        err.phase === 'init' &&
        err.message.includes('VAR_B')
      );
    });
  });

  // ----------------------------------------------------------
  // EC-8: Factory throw wraps as AgentHostError('init') with alias (AC-32)
  // ----------------------------------------------------------
  it('wraps factory throw as AgentHostError(init) with mount alias (EC-8, AC-32)', async () => {
    const cause = new Error('connection refused');
    const entry = makeDeferredEntry('failExt', {}, [], {
      factoryImpl: () => { throw cause; },
    });

    await expect(
      resolveDeferredExtensions([entry], {})
    ).rejects.toSatisfy((err: unknown) => {
      return (
        err instanceof AgentHostError &&
        err.phase === 'init' &&
        err.message.includes('failExt') &&
        err.message.includes('connection refused')
      );
    });
  });

  // ----------------------------------------------------------
  // EC-8: Factory throw disposes already-instantiated extensions
  // ----------------------------------------------------------
  it('disposes already-instantiated extensions when a later factory throws (EC-8)', async () => {
    const disposeSpy = vi.fn();
    const good = makeDeferredEntry('goodExt', {}, [], {
      disposeImpl: disposeSpy,
    });
    const bad = makeDeferredEntry('badExt', {}, [], {
      factoryImpl: () => { throw new Error('boom'); },
    });

    await expect(
      resolveDeferredExtensions([good, bad], {})
    ).rejects.toBeInstanceOf(AgentHostError);

    expect(disposeSpy).toHaveBeenCalledOnce();
  });
});

// ============================================================
// describe: resolveDeferredContext
// ============================================================

describe('resolveDeferredContext', () => {
  // ----------------------------------------------------------
  // IR-10 / AC-7: Happy path — resolves @{VAR} from runtimeConfig
  // ----------------------------------------------------------
  it('resolves @{VAR} placeholders from runtimeConfig (IR-10, AC-7)', () => {
    const entries: DeferredContextEntry[] = [
      { key: 'userId', template: '@{USER_ID}', requiredVars: ['USER_ID'] },
      { key: 'region', template: 'us-@{REGION}', requiredVars: ['REGION'] },
    ];

    const result = resolveDeferredContext(entries, {
      USER_ID: 'usr-42',
      REGION: 'west-2',
    });

    expect(result).toEqual({ userId: 'usr-42', region: 'us-west-2' });
  });

  // ----------------------------------------------------------
  // IR-10: Multiple @{VAR} in a single template string
  // ----------------------------------------------------------
  it('resolves multiple placeholders in a single template', () => {
    const entries: DeferredContextEntry[] = [
      {
        key: 'dsn',
        template: 'postgres://@{DB_USER}:@{DB_PASS}@localhost/db',
        requiredVars: ['DB_USER', 'DB_PASS'],
      },
    ];

    const result = resolveDeferredContext(entries, {
      DB_USER: 'admin',
      DB_PASS: 's3cr3t',
    });

    expect(result['dsn']).toBe('postgres://admin:s3cr3t@localhost/db');
  });

  // ----------------------------------------------------------
  // IR-10: Empty deferred list returns empty object
  // ----------------------------------------------------------
  it('returns empty object when deferred list is empty', () => {
    const result = resolveDeferredContext([], {});
    expect(result).toEqual({});
  });

  // ----------------------------------------------------------
  // EC-9: Missing required variable throws AgentHostError('init')
  // ----------------------------------------------------------
  it('throws AgentHostError(init) when required variable is absent (EC-9, AC-9)', () => {
    const entries: DeferredContextEntry[] = [
      { key: 'token', template: '@{AUTH_TOKEN}', requiredVars: ['AUTH_TOKEN'] },
    ];

    expect(() =>
      resolveDeferredContext(entries, {})
    ).toThrow(AgentHostError);

    expect(() =>
      resolveDeferredContext(entries, {})
    ).toSatisfy((fn: () => void) => {
      try {
        fn();
        return false;
      } catch (err) {
        return (
          err instanceof AgentHostError &&
          err.phase === 'init' &&
          err.message.includes('AUTH_TOKEN')
        );
      }
    });
  });

  // ----------------------------------------------------------
  // EC-9: Multiple missing variables — all names in error
  // ----------------------------------------------------------
  it('lists all missing variable names in the error (EC-9)', () => {
    const entries: DeferredContextEntry[] = [
      { key: 'a', template: '@{VAR_A}', requiredVars: ['VAR_A'] },
      { key: 'b', template: '@{VAR_B}', requiredVars: ['VAR_B'] },
    ];

    let caught: unknown;
    try {
      resolveDeferredContext(entries, {});
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(AgentHostError);
    const error = caught as AgentHostError;
    expect(error.phase).toBe('init');
    expect(error.message).toContain('VAR_A');
    expect(error.message).toContain('VAR_B');
  });
});
