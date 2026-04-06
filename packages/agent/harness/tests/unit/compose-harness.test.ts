/**
 * Unit tests for composeHarness slim harness.json approach.
 *
 * Covered:
 *   AC-11  Multi-agent harness composes two agents independently
 *   AC-44  Single-agent harness entry composes and routes correctly
 *   EC-4   Malformed harness.json → ManifestValidationError
 *   EC-5   Agent directory missing rill-config.json → ComposeError('validation')
 *   EC-6   Per-agent composition error propagated as ComposeError
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { composeHarness } from '../../src/index.js';
import {
  ComposeError,
  ManifestValidationError,
} from '@rcrsr/rill-agent-shared';

// Absolute path to fixture directory — resolved once at module load.
const FIXTURE_DIR = path.resolve(
  fileURLToPath(import.meta.url),
  '../../fixtures'
);

// ============================================================
// describe: composeHarness — slim harness.json approach
// ============================================================

describe('composeHarness — slim harness.json approach', () => {
  // ----------------------------------------------------------
  // AC-44: Single-agent harness entry composes and routes correctly
  // ----------------------------------------------------------
  it('composes a single-agent harness from harness.json (AC-44)', async () => {
    const harness = await composeHarness(FIXTURE_DIR, {
      config: {},
      env: {},
    });

    try {
      expect(harness.agents.has('test-agent')).toBe(true);
      expect(harness.sharedExtensions).toEqual({});
    } finally {
      await harness.dispose();
    }
  });

  // ----------------------------------------------------------
  // AC-11: Multi-agent harness composes two agents independently
  // ----------------------------------------------------------
  it('composes a multi-agent harness with two independent agents (AC-11)', async () => {
    const harness = await composeHarness(
      path.join(FIXTURE_DIR, 'multi-harness'),
      { config: {}, env: {} }
    );

    try {
      expect(harness.agents.size).toBe(2);
      expect(harness.agents.has('test-agent')).toBe(true);
      expect(harness.agents.has('second-agent')).toBe(true);

      const first = harness.agents.get('test-agent');
      const second = harness.agents.get('second-agent');
      expect(first).toBeDefined();
      expect(second).toBeDefined();
      // Agents are independent ComposedAgent instances
      expect(first).not.toBe(second);
    } finally {
      await harness.dispose();
    }
  });
});

// ============================================================
// describe: composeHarness — error contracts
// ============================================================

describe('composeHarness — error contracts', () => {
  // ----------------------------------------------------------
  // EC-4: Malformed harness.json → ManifestValidationError
  // ----------------------------------------------------------
  it('throws ManifestValidationError when harness.json is missing (EC-4)', async () => {
    const dir = path.join(FIXTURE_DIR, 'nonexistent-harness-x9y8z7');

    await expect(
      composeHarness(dir, { config: {}, env: {} })
    ).rejects.toSatisfy((err: unknown) => {
      return (
        err instanceof ManifestValidationError &&
        err.phase === 'validation'
      );
    });
  });

  it('throws ManifestValidationError when harness.json is malformed JSON (EC-4)', async () => {
    // Create a temp dir with a malformed harness.json
    const tmpDir = path.join(tmpdir(), `harness-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(path.join(tmpDir, 'harness.json'), 'not-valid-json{{{');

    try {
      await expect(
        composeHarness(tmpDir, { config: {}, env: {} })
      ).rejects.toSatisfy((err: unknown) => {
        return (
          err instanceof ManifestValidationError &&
          err.phase === 'validation'
        );
      });
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('throws ManifestValidationError when harness.json has no agents array (EC-4)', async () => {
    // Create a temp dir with an invalid harness.json (missing required agents)
    const tmpDir = path.join(tmpdir(), `harness-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(path.join(tmpDir, 'harness.json'), JSON.stringify({ version: '1.0.0' }));

    try {
      await expect(
        composeHarness(tmpDir, { config: {}, env: {} })
      ).rejects.toBeInstanceOf(ManifestValidationError);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // ----------------------------------------------------------
  // EC-5: Agent directory missing rill-config.json → ComposeError('validation')
  // ----------------------------------------------------------
  it('throws ComposeError(validation) when agent directory has no rill-config.json (EC-5)', async () => {
    // Create a temp dir with a valid harness.json pointing to a missing agent dir
    const tmpDir = path.join(tmpdir(), `harness-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(
      path.join(tmpDir, 'harness.json'),
      JSON.stringify({
        agents: [{ name: 'missing-agent', path: 'missing-agent-dir' }],
      })
    );

    try {
      await expect(
        composeHarness(tmpDir, { config: {}, env: {} })
      ).rejects.toSatisfy((err: unknown) => {
        return (
          err instanceof ComposeError &&
          err.phase === 'validation' &&
          err.message.includes('rill-config.json')
        );
      });
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // ----------------------------------------------------------
  // EC-6: Per-agent composition error propagated as ComposeError
  // ----------------------------------------------------------
  it('propagates ComposeError from per-agent composition failure (EC-6)', async () => {
    // Create a temp dir with a harness.json pointing to an agent with a bad rill-config.json
    const tmpDir = path.join(tmpdir(), `harness-test-${Date.now()}`);
    const agentDir = path.join(tmpDir, 'bad-agent');
    mkdirSync(agentDir, { recursive: true });

    // harness.json pointing to bad-agent
    writeFileSync(
      path.join(tmpDir, 'harness.json'),
      JSON.stringify({
        agents: [{ name: 'bad-agent', path: 'bad-agent' }],
      })
    );

    // Agent has rill-config.json with main missing :handler
    writeFileSync(
      path.join(agentDir, 'rill-config.json'),
      JSON.stringify({
        name: 'bad-agent',
        version: '0.0.1',
        main: 'handler.rill',
      })
    );

    try {
      await expect(
        composeHarness(tmpDir, { config: {}, env: {} })
      ).rejects.toSatisfy((err: unknown) => {
        return err instanceof ComposeError && err.phase === 'validation';
      });
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
