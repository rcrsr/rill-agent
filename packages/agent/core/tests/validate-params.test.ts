import { describe, expect, it } from 'vitest';

import type { AgentRouter, HandlerDescription } from '../src/types.js';
import { validateParams } from '../src/validate-params.js';

// ============================================================
// HELPERS
// ============================================================

function makeRouter(desc: HandlerDescription | null): AgentRouter {
  return {
    describe: (_agentName: string) => desc,
    run: () => Promise.reject(new Error('not implemented')),
    agents: () => [],
    defaultAgent: () => '',
    dispose: () => Promise.resolve(),
  };
}

// ============================================================
// VALIDATE PARAMS
// ============================================================

describe('validateParams', () => {
  it('returns null when describe() returns null (AC-17)', () => {
    const router = makeRouter(null);

    const result = validateParams({}, 'agent', router);

    expect(result).toBeNull();
  });

  it('returns error for missing required param (EC-1)', () => {
    const router = makeRouter({
      name: 'agent',
      params: [{ name: 'query', type: 'string', required: true }],
    });

    const result = validateParams({}, 'agent', router);

    expect(result).toBe('Missing required parameter: query');
  });

  it('returns null for present required param', () => {
    const router = makeRouter({
      name: 'agent',
      params: [{ name: 'query', type: 'string', required: true }],
    });

    const result = validateParams({ query: 'hello' }, 'agent', router);

    expect(result).toBeNull();
  });

  it('returns error for list type mismatch (EC-2)', () => {
    const router = makeRouter({
      name: 'agent',
      params: [{ name: 'items', type: 'list', required: false }],
    });

    const result = validateParams({ items: 'not-a-list' }, 'agent', router);

    expect(result).toBe('Parameter "items" must be a list, got string');
  });

  it('returns error for dict type mismatch (EC-2)', () => {
    const router = makeRouter({
      name: 'agent',
      params: [{ name: 'config', type: 'dict', required: false }],
    });

    const result = validateParams({ config: 'not-a-dict' }, 'agent', router);

    expect(result).toBe('Parameter "config" must be a dict, got string');
  });

  it('returns error for other type mismatch (EC-2)', () => {
    const router = makeRouter({
      name: 'agent',
      params: [{ name: 'count', type: 'number', required: false }],
    });

    const result = validateParams({ count: 'five' }, 'agent', router);

    expect(result).toBe('Parameter "count" must be number, got string');
  });

  it('returns null when all params are valid (EC-1, EC-2)', () => {
    const router = makeRouter({
      name: 'agent',
      params: [
        { name: 'query', type: 'string', required: true },
        { name: 'count', type: 'number', required: false },
        { name: 'items', type: 'list', required: false },
        { name: 'config', type: 'dict', required: false },
      ],
    });

    const result = validateParams(
      { query: 'hello', count: 5, items: [1, 2], config: { key: 'val' } },
      'agent',
      router
    );

    expect(result).toBeNull();
  });
});
