import { CapacityError } from './errors.js';
import { generateId } from './id.js';

// ============================================================
// TYPES
// ============================================================

export interface SessionManager {
  /**
   * Acquire a session for the given conversation ID.
   * When conversationId is provided, it is used directly as the session ID.
   * When absent, a new random session ID is generated.
   * Throws CapacityError when the pool is at maximum capacity.
   */
  acquire(conversationId: string | undefined): string;

  /**
   * Release a session by ID. No-op if the session ID is not tracked.
   */
  release(sessionId: string): void;

  /**
   * Return the number of currently open sessions.
   */
  activeCount(): number;
}

// ============================================================
// FACTORY
// ============================================================

const DEFAULT_MAX_SESSIONS = 10;

/**
 * Create a bounded pool manager for concurrent rill sessions.
 *
 * Max capacity reads from MAX_CONCURRENT_SESSIONS env var, default 10.
 */
export function createSessionManager(): SessionManager {
  const raw = process.env['MAX_CONCURRENT_SESSIONS'];
  const parsed = raw !== undefined ? parseInt(raw, 10) : NaN;
  const max =
    Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_SESSIONS;
  const active = new Set<string>();

  return {
    acquire(conversationId: string | undefined): string {
      if (active.size >= max) {
        throw new CapacityError(max);
      }
      const sessionId = conversationId ?? generateId('sess_');
      active.add(sessionId);
      return sessionId;
    },

    release(sessionId: string): void {
      active.delete(sessionId);
    },

    activeCount(): number {
      return active.size;
    },
  };
}
