import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSessionManager } from '../src/session.js';
import { CapacityError } from '../src/errors.js';

// ============================================================
// ENV SAVE/RESTORE
// ============================================================

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

// ============================================================
// TESTS
// ============================================================

describe('createSessionManager', () => {
  it('caps active sessions at options.maxConcurrentSessions, overriding a higher env value', () => {
    process.env['MAX_CONCURRENT_SESSIONS'] = '10';
    const manager = createSessionManager({ maxConcurrentSessions: 2 });

    manager.acquire(undefined);
    manager.acquire(undefined);
    expect(manager.activeCount()).toBe(2);
    expect(() => manager.acquire(undefined)).toThrow(CapacityError);
  });

  it('honors the MAX_CONCURRENT_SESSIONS env var when no option is passed', () => {
    process.env['MAX_CONCURRENT_SESSIONS'] = '2';
    const manager = createSessionManager();

    manager.acquire(undefined);
    manager.acquire(undefined);
    expect(manager.activeCount()).toBe(2);
    expect(() => manager.acquire(undefined)).toThrow(CapacityError);
  });

  it('acquiring twice with the same conversationId occupies two independent slots', () => {
    const manager = createSessionManager({ maxConcurrentSessions: 5 });

    const first = manager.acquire('conv_shared');
    const second = manager.acquire('conv_shared');

    expect(first).toBe('conv_shared');
    expect(second).toBe('conv_shared');
    expect(manager.activeCount()).toBe(2);
  });

  it('releasing once after two same-conversationId acquisitions frees only one slot', () => {
    const manager = createSessionManager({ maxConcurrentSessions: 5 });

    manager.acquire('conv_shared');
    manager.acquire('conv_shared');
    expect(manager.activeCount()).toBe(2);

    manager.release('conv_shared');
    expect(manager.activeCount()).toBe(1);
  });
});
