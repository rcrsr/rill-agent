/**
 * Unit tests for composeAgent error contracts.
 *
 * Covered:
 *   EC-2   rill-config.json missing → ComposeError('validation')
 *   EC-2   main without :handler → ComposeError('validation')
 *   EC-2   @{VAR} in host block → ComposeError('validation')
 *   EC-2   .rill parse error → ComposeError('resolution')
 *   EC-3   Extension not found → ComposeError('resolution')
 *   AC-1   Agent with rill-config.json composes without error
 *   AC-2   Directory with no rill-config.json → error
 *   AC-3   Main without :handler → 'handler mode required' error
 *   AC-8   @{VAR} in host block → startup error listing invalid paths
 *   AC-14  No functions field → composes OK
 *   AC-30  Missing rill-config.json → ComposeError('validation')
 *   AC-31  Extension not found → ComposeError('resolution')
 *   AC-33  Unresolved ${VAR} in static config → ComposeError('validation')
 *   AC-34  @{VAR} in modules block → ComposeError('validation')
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { composeAgent } from '../../src/index.js';
import { ComposeError } from '@rcrsr/rill-agent-shared';

// Absolute path to the fixtures directory.
const FIXTURE_DIR = path.resolve(
  fileURLToPath(import.meta.url),
  '../../fixtures'
);

// ============================================================
// describe: composeAgent — error contracts
// ============================================================

describe('composeAgent — error contracts', () => {
  // ----------------------------------------------------------
  // EC-2 / AC-2 / AC-30: missing rill-config.json
  // ----------------------------------------------------------
  it('throws ComposeError(validation) when rill-config.json is missing (EC-2, AC-2, AC-30)', async () => {
    const dir = path.join(FIXTURE_DIR, 'nonexistent-dir-x1y2z3');

    await expect(
      composeAgent(dir, { config: {}, env: {} })
    ).rejects.toSatisfy((err: unknown) => {
      return (
        err instanceof ComposeError &&
        err.phase === 'validation' &&
        (err.message.includes('rill-config.json') ||
          err.message.includes('not found'))
      );
    });
  });

  // ----------------------------------------------------------
  // EC-2 / AC-3: main without :handler suffix
  // ----------------------------------------------------------
  it('throws ComposeError(validation) with "handler mode required" for main missing :handler (EC-2, AC-3)', async () => {
    const dir = path.join(FIXTURE_DIR, 'no-handler');

    await expect(
      composeAgent(dir, { config: {}, env: {} })
    ).rejects.toSatisfy((err: unknown) => {
      return (
        err instanceof ComposeError &&
        err.phase === 'validation' &&
        err.message.includes('handler mode required')
      );
    });
  });

  // ----------------------------------------------------------
  // EC-2 / AC-8: @{VAR} in host block → startup error listing paths
  // ----------------------------------------------------------
  it('throws ComposeError(validation) listing invalid paths for @{VAR} in host block (EC-2, AC-8)', async () => {
    const dir = path.join(FIXTURE_DIR, 'at-var-host');

    await expect(
      composeAgent(dir, { config: {}, env: {} })
    ).rejects.toSatisfy((err: unknown) => {
      return (
        err instanceof ComposeError &&
        err.phase === 'validation' &&
        err.message.includes('@{VAR}')
      );
    });
  });

  // ----------------------------------------------------------
  // AC-33: unresolved ${VAR} in static config → ComposeError('validation')
  // ----------------------------------------------------------
  it('throws ComposeError(validation) when rill-config.json contains unresolved ${VAR} (AC-33)', async () => {
    const dir = path.join(FIXTURE_DIR, 'unresolved-env-var');

    await expect(
      composeAgent(dir, { config: {}, env: {} })
    ).rejects.toSatisfy((err: unknown) => {
      return (
        err instanceof ComposeError &&
        err.phase === 'validation' &&
        err.message.includes('UNDEFINED_VAR')
      );
    });
  });

  // ----------------------------------------------------------
  // EC-2 / AC-34: @{VAR} in modules block
  // ----------------------------------------------------------
  it('throws ComposeError(validation) for @{VAR} in modules block (EC-2, AC-34)', async () => {
    const dir = path.join(FIXTURE_DIR, 'at-var-modules');

    await expect(
      composeAgent(dir, { config: {}, env: {} })
    ).rejects.toSatisfy((err: unknown) => {
      return (
        err instanceof ComposeError &&
        err.phase === 'validation' &&
        err.message.includes('@{VAR}')
      );
    });
  });

  // ----------------------------------------------------------
  // EC-2: .rill parse error → ComposeError('resolution')
  // ----------------------------------------------------------
  it('throws ComposeError(resolution) when .rill file has a parse error (EC-2)', async () => {
    const dir = path.join(FIXTURE_DIR, 'bad-handler');

    await expect(
      composeAgent(dir, { config: {}, env: {} })
    ).rejects.toSatisfy((err: unknown) => {
      return err instanceof ComposeError && err.phase === 'resolution';
    });
  });

  // ----------------------------------------------------------
  // EC-3 / AC-31: extension not found → ComposeError('resolution')
  // ----------------------------------------------------------
  it('throws ComposeError(resolution) when extension package is not found (EC-3, AC-31)', async () => {
    const dir = path.join(FIXTURE_DIR, 'missing-extension');

    await expect(
      composeAgent(dir, { config: {}, env: {} })
    ).rejects.toSatisfy((err: unknown) => {
      return err instanceof ComposeError && err.phase === 'resolution';
    });
  });
});

// ============================================================
// describe: composeAgent — success paths
// ============================================================

describe('composeAgent — success paths', () => {
  // ----------------------------------------------------------
  // AC-1: Agent with rill-config.json composes without error
  // ----------------------------------------------------------
  it('composes successfully from rill-config.json (AC-1)', async () => {
    const dir = path.join(FIXTURE_DIR, 'simple-agent');
    const agent = await composeAgent(dir, { config: {}, env: {} });

    try {
      expect(agent.card.name).toBe('test-agent');
      expect(agent.card.version).toBe('0.0.1');
      expect(agent.context).toBeDefined();
      expect(agent.ast).toBeDefined();
    } finally {
      await agent.dispose();
    }
  });

  // ----------------------------------------------------------
  // AC-14: Agent with no functions field composes without error
  // ----------------------------------------------------------
  it('composes successfully when rill-config.json has no functions field (AC-14)', async () => {
    const dir = path.join(FIXTURE_DIR, 'no-functions');
    const agent = await composeAgent(dir, { config: {}, env: {} });

    try {
      expect(agent.card.name).toBe('no-functions-agent');
      expect(agent.context).toBeDefined();
    } finally {
      await agent.dispose();
    }
  });
});
