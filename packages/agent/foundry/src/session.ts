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

/**
 * Options accepted by createSessionManager.
 */
export interface SessionManagerOptions {
  /**
   * Maximum number of concurrently open sessions. Overrides the
   * MAX_CONCURRENT_SESSIONS env var when provided.
   */
  readonly maxConcurrentSessions?: number | undefined;
}

// ============================================================
// FACTORY
// ============================================================

const DEFAULT_MAX_SESSIONS = 10;

/**
 * Create a bounded pool manager for concurrent rill sessions.
 *
 * Max capacity resolution order: options.maxConcurrentSessions, then the
 * MAX_CONCURRENT_SESSIONS env var, then DEFAULT_MAX_SESSIONS.
 */
export function createSessionManager(
  options?: SessionManagerOptions
): SessionManager {
  const raw = process.env['MAX_CONCURRENT_SESSIONS'];
  const parsedEnv = raw !== undefined ? parseInt(raw, 10) : NaN;
  const envMax =
    Number.isFinite(parsedEnv) && parsedEnv > 0
      ? parsedEnv
      : DEFAULT_MAX_SESSIONS;
  const max = options?.maxConcurrentSessions ?? envMax;

  // Active slots are keyed by a per-request unique token, not by
  // sessionId/conversationId, so two concurrent acquisitions for the same
  // conversationId occupy two independent slots instead of collapsing into
  // one (a client can legitimately have overlapping in-flight requests on
  // the same conversation).
  const activeTokens = new Map<string, string>();

  return {
    acquire(conversationId: string | undefined): string {
      if (activeTokens.size >= max) {
        throw new CapacityError(max);
      }
      const sessionId = conversationId ?? generateId('sess_');
      const token = generateId('tok_');
      activeTokens.set(token, sessionId);
      return sessionId;
    },

    release(sessionId: string): void {
      for (const [token, id] of activeTokens) {
        if (id === sessionId) {
          activeTokens.delete(token);
          return;
        }
      }
    },

    activeCount(): number {
      return activeTokens.size;
    },
  };
}
