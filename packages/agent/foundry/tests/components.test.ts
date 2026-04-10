import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentRouter, RunContext, RunRequest } from '@rcrsr/rill-agent';
import { createSessionManager } from '../src/session.js';
import { CapacityError } from '../src/errors.js';
import {
  buildSyncResponse,
  buildErrorResponse,
  generateToolDefinitions,
} from '../src/response.js';
import type { RunResponse } from '@rcrsr/rill-agent';

// ============================================================
// MOCK ROUTER
// ============================================================

const mockRouter = {
  defaultAgent: () => 'test-agent',
  describe: (_name: string) => ({
    name: 'test-handler',
    description: 'A test handler',
    params: [
      {
        name: 'input',
        type: 'string',
        description: 'The input',
        required: true,
      },
      {
        name: 'count',
        type: 'number',
        description: 'Count',
        required: false,
        defaultValue: 5,
      },
    ],
  }),
  run: async (
    _name: string,
    _request: RunRequest,
    _context?: RunContext
  ): Promise<RunResponse> => ({ state: 'completed' as const, result: 'ok' }),
  agents: () => ['test-agent'],
  dispose: async () => undefined,
} satisfies AgentRouter;

// ============================================================
// SESSION MANAGER TESTS
// ============================================================

describe('createSessionManager', () => {
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedEnv = process.env['MAX_CONCURRENT_SESSIONS'];
    delete process.env['MAX_CONCURRENT_SESSIONS'];
  });

  afterEach(() => {
    if (savedEnv !== undefined) {
      process.env['MAX_CONCURRENT_SESSIONS'] = savedEnv;
    } else {
      delete process.env['MAX_CONCURRENT_SESSIONS'];
    }
  });

  // AC-27: acquire returns session ID, release frees slot, activeCount tracks
  it('acquire returns a session ID and activeCount increments', () => {
    const manager = createSessionManager();
    expect(manager.activeCount()).toBe(0);
    const id = manager.acquire(undefined);
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
    expect(manager.activeCount()).toBe(1);
  });

  it('acquire uses provided conversationId as sessionId', () => {
    const manager = createSessionManager();
    const id = manager.acquire('conv_abc');
    expect(id).toBe('conv_abc');
  });

  it('release frees the session slot', () => {
    const manager = createSessionManager();
    const id = manager.acquire(undefined);
    expect(manager.activeCount()).toBe(1);
    manager.release(id);
    expect(manager.activeCount()).toBe(0);
  });

  it('release is a no-op for unknown session IDs', () => {
    const manager = createSessionManager();
    expect(() => manager.release('nonexistent')).not.toThrow();
    expect(manager.activeCount()).toBe(0);
  });

  // AC-24, AC-41, EC-4: 11th concurrent acquire throws CapacityError
  it('throws CapacityError when max concurrent sessions (10) is exceeded', () => {
    const manager = createSessionManager();
    for (let i = 0; i < 10; i++) {
      manager.acquire(undefined);
    }
    expect(manager.activeCount()).toBe(10);
    expect(() => manager.acquire(undefined)).toThrow(CapacityError);
  });

  // AC-25: MAX_CONCURRENT_SESSIONS override
  it('respects MAX_CONCURRENT_SESSIONS env var override', () => {
    process.env['MAX_CONCURRENT_SESSIONS'] = '3';
    const manager = createSessionManager();
    manager.acquire(undefined);
    manager.acquire(undefined);
    manager.acquire(undefined);
    expect(() => manager.acquire(undefined)).toThrow(CapacityError);
  });
});

// ============================================================
// BUILD SYNC RESPONSE TESTS
// ============================================================

describe('buildSyncResponse', () => {
  // AC-12: completed state maps correctly
  it('maps completed state to completed status with result text', () => {
    const runResponse: RunResponse = { state: 'completed', result: 'hello' };
    const response = buildSyncResponse(runResponse, 'resp_001');
    expect(response.status).toBe('completed');
    expect(response.id).toBe('resp_001');
    expect(response.object).toBe('response');
    expect(response.error).toBeNull();
    const content = response.output[0]?.content[0];
    expect(content?.text).toBe('hello');
  });

  it('maps error state to failed status', () => {
    const runResponse: RunResponse = { state: 'error', result: 'oops' };
    const response = buildSyncResponse(runResponse, 'resp_002');
    expect(response.status).toBe('failed');
    expect(response.error).not.toBeNull();
    expect(response.error?.code).toBe('SERVER_ERROR');
  });

  // AC-17: result coercion — string, number, object, null
  it('passes string result through unchanged', () => {
    const response = buildSyncResponse(
      { state: 'completed', result: 'text result' },
      'r1'
    );
    expect(response.output[0]?.content[0]?.text).toBe('text result');
  });

  it('converts number result to string', () => {
    const response = buildSyncResponse(
      { state: 'completed', result: 42 },
      'r2'
    );
    expect(response.output[0]?.content[0]?.text).toBe('42');
  });

  it('JSON-stringifies object result', () => {
    const obj = { key: 'value' };
    const response = buildSyncResponse(
      { state: 'completed', result: obj },
      'r3'
    );
    expect(response.output[0]?.content[0]?.text).toBe(JSON.stringify(obj));
  });

  it('converts null result to empty string', () => {
    const response = buildSyncResponse(
      { state: 'completed', result: null },
      'r4'
    );
    expect(response.output[0]?.content[0]?.text).toBe('');
  });

  // AC-45: handler returns null → output text is empty string
  it('returns empty string when result is null (AC-45)', () => {
    const response = buildSyncResponse(
      { state: 'completed', result: null },
      'r5'
    );
    const text = response.output[0]?.content[0]?.text;
    expect(text).toBe('');
  });
});

// ============================================================
// GENERATE TOOL DEFINITIONS TESTS
// ============================================================

describe('generateToolDefinitions', () => {
  // AC-20: maps handler params to JSON Schema
  it('maps handler params to JSON Schema function definition', () => {
    const defs = generateToolDefinitions(mockRouter);
    expect(defs).toHaveLength(1);
    const def = defs[0]!;
    expect(def.type).toBe('function');
    expect(def.name).toBe('test-handler');
    expect(def.description).toBe('A test handler');
    expect(def.strict).toBe(true);

    const { properties, required } = def.parameters;
    expect(properties['input']).toMatchObject({
      type: 'string',
      description: 'The input',
    });
    expect(properties['count']).toMatchObject({
      type: 'number',
      description: 'Count',
      default: 5,
    });
    expect(required).toContain('input');
    expect(required).not.toContain('count');
  });

  // AC-21: only default agent handlers
  it('calls router.describe with router.defaultAgent() name', () => {
    let describedName: string | undefined;
    const trackingRouter: AgentRouter = {
      ...mockRouter,
      describe: (name: string) => {
        describedName = name;
        return mockRouter.describe(name);
      },
    };
    generateToolDefinitions(trackingRouter);
    expect(describedName).toBe('test-agent');
  });

  it('returns empty array when describe returns null', () => {
    const nullRouter: AgentRouter = {
      ...mockRouter,
      describe: () => null,
    };
    const defs = generateToolDefinitions(nullRouter);
    expect(defs).toHaveLength(0);
  });
});

// ============================================================
// BUILD ERROR RESPONSE TESTS
// ============================================================

describe('buildErrorResponse', () => {
  // AC-35: debug=true includes diagnostic detail
  it('returns original message when debug is true', () => {
    const response = buildErrorResponse(
      'SERVER_ERROR',
      'stack trace here',
      true
    );
    expect(response.error.message).toBe('stack trace here');
    expect(response.error.code).toBe('SERVER_ERROR');
  });

  // AC-36: debug=false returns generic message
  it('returns generic message when debug is false', () => {
    const response = buildErrorResponse(
      'SERVER_ERROR',
      'stack trace here',
      false
    );
    expect(response.error.message).toBe('Internal server error');
  });

  it('returns generic message when debug is omitted', () => {
    const response = buildErrorResponse('INVALID_REQUEST', 'raw detail');
    expect(response.error.message).toBe('Invalid request');
  });

  it('returns fallback message for unknown error code', () => {
    const response = buildErrorResponse('UNKNOWN_CODE', 'detail', false);
    expect(response.error.message).toBe('An error occurred');
  });
});
