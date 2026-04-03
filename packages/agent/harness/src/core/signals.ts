/**
 * Signal handlers for graceful shutdown and immediate abort.
 *
 * Register once during listen(). Not idempotent.
 */

// ============================================================
// MINIMAL HOST INTERFACE
// ============================================================

/**
 * Minimal host shape required by signal handlers.
 * The full AgentHost satisfies this structurally.
 * Defined locally to avoid a circular import with host.ts.
 */
interface SignalHost {
  stop(): Promise<void>;
}

// ============================================================
// REGISTER SIGNAL HANDLERS
// ============================================================

/**
 * Register SIGTERM and SIGINT handlers on the current process.
 * Call once during listen(). Not idempotent.
 *
 * SIGTERM: stop accepting sessions, drain up to drainTimeout ms,
 *   exit 0 (clean) or exit 1 (timeout).
 * SIGINT: abort all sessions immediately, exit 1.
 *
 * Returns a cleanup function that removes the registered listeners.
 * Call the returned function in the host's stop() to prevent listener leaks.
 */
export function registerSignalHandlers(
  host: SignalHost,
  drainTimeout: number
): () => void {
  const onSigterm = (): void => {
    void handleSigterm(host, drainTimeout);
  };

  const onSigint = (): void => {
    handleSigint(host);
  };

  process.on('SIGTERM', onSigterm);
  process.on('SIGINT', onSigint);

  return (): void => {
    process.off('SIGTERM', onSigterm);
    process.off('SIGINT', onSigint);
  };
}

// ============================================================
// SIGTERM HANDLER
// ============================================================

async function handleSigterm(
  host: SignalHost,
  drainTimeout: number
): Promise<void> {
  const drain = host.stop();

  const timeout = new Promise<'timeout'>((resolve) => {
    setTimeout(() => {
      resolve('timeout');
    }, drainTimeout);
  });

  const result = await Promise.race([
    drain.then(() => 'clean' as const),
    timeout,
  ]);

  if (result === 'clean') {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

// ============================================================
// SIGINT HANDLER
// ============================================================

function handleSigint(host: SignalHost): void {
  // Fire-and-forget: signal stop but do not wait for drain.
  // AC-34 requires immediate abort and exit 1.
  host.stop().catch(() => {
    // Intentionally ignored — process is exiting immediately.
  });
  process.exit(1);
}
