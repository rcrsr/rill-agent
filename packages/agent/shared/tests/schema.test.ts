import { describe, it, expect } from 'vitest';
import { validateSlimHarness } from '../src/schema.js';
import { ManifestValidationError } from '../src/errors.js';

// ============================================================
// VALIDATE SLIM HARNESS
// ============================================================

describe('validateSlimHarness', () => {
  // ============================================================
  // VALID CONFIGS [IR-3, AC-13, AC-44]
  // ============================================================

  describe('valid slim harness configs [IR-3, AC-13, AC-44]', () => {
    it('accepts a single-agent config with required fields only [AC-44]', () => {
      const result = validateSlimHarness({
        agents: [{ name: 'my-agent', path: './agents/my-agent' }],
      });
      expect(result.agents).toHaveLength(1);
      expect(result.agents[0]?.name).toBe('my-agent');
      expect(result.agents[0]?.path).toBe('./agents/my-agent');
    });

    it('returns undefined for optional fields when omitted [AC-13]', () => {
      const result = validateSlimHarness({
        agents: [{ name: 'my-agent', path: './agents/my-agent' }],
      });
      expect(result.concurrency).toBeUndefined();
      expect(result.deploy).toBeUndefined();
    });

    it('accepts two agents with all optional fields populated', () => {
      const result = validateSlimHarness({
        agents: [
          { name: 'agent-a', path: './agents/a', maxConcurrency: 3 },
          { name: 'agent-b', path: './agents/b', maxConcurrency: 5 },
        ],
        concurrency: 10,
        deploy: { port: 8080, healthPath: '/healthz' },
      });
      expect(result.agents).toHaveLength(2);
      expect(result.concurrency).toBe(10);
      expect(result.deploy?.port).toBe(8080);
      expect(result.deploy?.healthPath).toBe('/healthz');
    });

    it('accepts a config with only port in deploy', () => {
      const result = validateSlimHarness({
        agents: [{ name: 'agent-x', path: './x' }],
        deploy: { port: 3000 },
      });
      expect(result.deploy?.port).toBe(3000);
      expect(result.deploy?.healthPath).toBeUndefined();
    });

    it('accepts a config with only healthPath in deploy', () => {
      const result = validateSlimHarness({
        agents: [{ name: 'agent-x', path: './x' }],
        deploy: { healthPath: '/ping' },
      });
      expect(result.deploy?.healthPath).toBe('/ping');
      expect(result.deploy?.port).toBeUndefined();
    });
  });

  // ============================================================
  // EMPTY AGENTS ARRAY [EC-1]
  // ============================================================

  describe('empty agents array [EC-1]', () => {
    it('throws ManifestValidationError when agents is an empty array', () => {
      expect(() => validateSlimHarness({ agents: [] })).toThrow(
        ManifestValidationError
      );
    });

    it('includes at least one issue when agents is empty', () => {
      try {
        validateSlimHarness({ agents: [] });
        expect.fail('expected throw');
      } catch (e) {
        expect(e).toBeInstanceOf(ManifestValidationError);
        const err = e as ManifestValidationError;
        expect(err.issues.length).toBeGreaterThan(0);
      }
    });
  });

  // ============================================================
  // MISSING AGENTS FIELD [EC-1]
  // ============================================================

  describe('missing agents field [EC-1]', () => {
    it('throws ManifestValidationError when agents field is absent', () => {
      expect(() => validateSlimHarness({})).toThrow(ManifestValidationError);
    });

    it('includes a path referencing agents when agents field is missing', () => {
      try {
        validateSlimHarness({});
        expect.fail('expected throw');
      } catch (e) {
        expect(e).toBeInstanceOf(ManifestValidationError);
        const err = e as ManifestValidationError;
        const issue = err.issues.find((i) => i.path.includes('agents'));
        expect(issue).toBeDefined();
      }
    });

    it('throws ManifestValidationError when input is null', () => {
      expect(() => validateSlimHarness(null)).toThrow(ManifestValidationError);
    });

    it('throws ManifestValidationError when input is a plain string', () => {
      expect(() => validateSlimHarness('not-an-object')).toThrow(
        ManifestValidationError
      );
    });
  });

  // ============================================================
  // UNKNOWN FIELDS [EC-1]
  // ============================================================

  describe('unknown fields rejected [EC-1]', () => {
    it('throws ManifestValidationError for unknown top-level field', () => {
      expect(() =>
        validateSlimHarness({
          agents: [{ name: 'a', path: './a' }],
          unknownField: 'oops',
        })
      ).toThrow(ManifestValidationError);
    });

    it('includes "unknown field" in the issue message for top-level unknown field', () => {
      try {
        validateSlimHarness({
          agents: [{ name: 'a', path: './a' }],
          unknownField: 'oops',
        });
        expect.fail('expected throw');
      } catch (e) {
        expect(e).toBeInstanceOf(ManifestValidationError);
        const err = e as ManifestValidationError;
        expect(
          err.issues.some((i) => i.message.includes('unknown field'))
        ).toBe(true);
      }
    });

    it('throws ManifestValidationError for unknown field inside an agent entry', () => {
      expect(() =>
        validateSlimHarness({
          agents: [{ name: 'a', path: './a', badKey: true }],
        })
      ).toThrow(ManifestValidationError);
    });

    it('throws ManifestValidationError for unknown field inside deploy', () => {
      expect(() =>
        validateSlimHarness({
          agents: [{ name: 'a', path: './a' }],
          deploy: { port: 3000, extraField: 'bad' },
        })
      ).toThrow(ManifestValidationError);
    });
  });

  // ============================================================
  // INVALID CONCURRENCY [EC-1]
  // ============================================================

  describe('invalid concurrency values [EC-1]', () => {
    it('throws ManifestValidationError when concurrency is negative', () => {
      expect(() =>
        validateSlimHarness({
          agents: [{ name: 'a', path: './a' }],
          concurrency: -1,
        })
      ).toThrow(ManifestValidationError);
    });

    it('throws ManifestValidationError when concurrency is zero', () => {
      expect(() =>
        validateSlimHarness({
          agents: [{ name: 'a', path: './a' }],
          concurrency: 0,
        })
      ).toThrow(ManifestValidationError);
    });

    it('throws ManifestValidationError when concurrency is a float', () => {
      expect(() =>
        validateSlimHarness({
          agents: [{ name: 'a', path: './a' }],
          concurrency: 1.5,
        })
      ).toThrow(ManifestValidationError);
    });

    it('throws ManifestValidationError when maxConcurrency on agent is negative', () => {
      expect(() =>
        validateSlimHarness({
          agents: [{ name: 'a', path: './a', maxConcurrency: -2 }],
        })
      ).toThrow(ManifestValidationError);
    });

    it('throws ManifestValidationError when maxConcurrency on agent is zero', () => {
      expect(() =>
        validateSlimHarness({
          agents: [{ name: 'a', path: './a', maxConcurrency: 0 }],
        })
      ).toThrow(ManifestValidationError);
    });

    it('throws ManifestValidationError when deploy.port is negative', () => {
      expect(() =>
        validateSlimHarness({
          agents: [{ name: 'a', path: './a' }],
          deploy: { port: -80 },
        })
      ).toThrow(ManifestValidationError);
    });

    it('throws ManifestValidationError when deploy.port is zero', () => {
      expect(() =>
        validateSlimHarness({
          agents: [{ name: 'a', path: './a' }],
          deploy: { port: 0 },
        })
      ).toThrow(ManifestValidationError);
    });
  });

  // ============================================================
  // NON-EMPTY STRINGS [EC-1]
  // ============================================================

  describe('non-empty string constraints [EC-1]', () => {
    it('throws ManifestValidationError when agent name is empty string', () => {
      expect(() =>
        validateSlimHarness({
          agents: [{ name: '', path: './a' }],
        })
      ).toThrow(ManifestValidationError);
    });

    it('throws ManifestValidationError when agent path is empty string', () => {
      expect(() =>
        validateSlimHarness({
          agents: [{ name: 'a', path: '' }],
        })
      ).toThrow(ManifestValidationError);
    });
  });
});
