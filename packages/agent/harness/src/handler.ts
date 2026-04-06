/**
 * createAgentHandler — serverless handler for Lambda deployment.
 * Translates API Gateway events to RunRequest and returns HandlerResponse.
 * No TCP server is started.
 */

import { randomUUID } from 'node:crypto';
import { execute, createRuntimeContext } from '@rcrsr/rill';
import type { ObservabilityCallbacks } from '@rcrsr/rill';
import { SessionManager } from './core/session.js';
import { createMetrics } from './core/metrics.js';
import { AgentHostError } from './core/errors.js';
import type { ComposedAgent } from './host.js';
import type { RunRequest } from './core/types.js';
import {
  resolveDeferredExtensions,
  resolveDeferredContext,
} from './compose.js';

// ============================================================
// SERVERLESS INTERFACES
// ============================================================

export interface APIGatewayEvent {
  readonly httpMethod: string;
  readonly path: string;
  readonly headers: Record<string, string | undefined>;
  readonly body: string | null;
}

export interface LambdaContext {
  readonly functionName: string;
  readonly awsRequestId: string;
  getRemainingTimeInMillis(): number;
}

export interface HandlerResponse {
  readonly statusCode: number;
  readonly headers: Record<string, string>;
  readonly body: string;
}

export interface AgentHandler {
  (event: APIGatewayEvent, context: LambdaContext): Promise<HandlerResponse>;
}

// ============================================================
// DEFAULTS
// ============================================================

const DEFAULTS = {
  maxConcurrentSessions: 10,
  sessionTtl: 3600000,
} as const;

// ============================================================
// FACTORY
// ============================================================

/**
 * Returns a serverless handler function for Lambda deployment.
 * EC-4: agent null/undefined → TypeError('agent is required') thrown synchronously.
 * EC-5: Unhandled runtime error → 500 HandlerResponse (not thrown).
 * AC-8: No TCP server created.
 */
export function createAgentHandler(agent: ComposedAgent): AgentHandler {
  if (agent == null) {
    throw new TypeError('agent is required');
  }

  const sessionManager = new SessionManager({
    maxConcurrentSessions: DEFAULTS.maxConcurrentSessions,
    sessionTtl: DEFAULTS.sessionTtl,
  });

  const metrics = createMetrics();

  return async function handler(
    event: APIGatewayEvent,
    _context: LambdaContext
  ): Promise<HandlerResponse> {
    // Translate API Gateway event to RunRequest
    const input: RunRequest = buildRunRequest(event);

    // Prune expired sessions before creating a new one
    sessionManager.prune();

    const correlationId = randomUUID();

    // EC-7: Validate runtimeConfig has all required @{VAR} keys
    const runtimeConfig = input.runtimeConfig ?? {};
    const runtimeVariables = agent.runtimeVariables ?? [];
    if (runtimeVariables.length > 0) {
      const missing = runtimeVariables.filter((v) => !(v in runtimeConfig));
      if (missing.length > 0) {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            error: 'missing runtime variables',
            required: missing,
          }),
        };
      }
    }

    try {
      const record = sessionManager.create(
        input,
        correlationId,
        agent.card.name
      );
      const sessionId = record.id;

      // AC-6, AC-7: Resolve deferred extensions and context per request
      let deferredDispose: (() => Promise<void>) | undefined;
      let deferredFunctions: Record<string, import('@rcrsr/rill').ApplicationCallable> = {};
      let deferredContextValues: Record<string, unknown> = {};

      const deferredExtensions = agent.deferredExtensions ?? [];
      const deferredContext = agent.deferredContext ?? [];

      if (deferredExtensions.length > 0 || deferredContext.length > 0) {
        if (deferredContext.length > 0) {
          deferredContextValues = resolveDeferredContext(
            deferredContext,
            runtimeConfig
          );
        }

        if (deferredExtensions.length > 0) {
          let resolvedDeferred;
          try {
            resolvedDeferred = await resolveDeferredExtensions(
              deferredExtensions,
              runtimeConfig
            );
          } catch (err) {
            // EC-8: Deferred extension factory threw — return 500 with extension name
            if (err instanceof AgentHostError) {
              const alias = err.extensionAlias ?? 'unknown';
              const causeMsg =
                err.cause instanceof Error
                  ? err.cause.message
                  : String(err.cause ?? err.message);
              return {
                statusCode: 500,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  error: 'deferred extension failed',
                  extension: alias,
                  cause: causeMsg,
                }),
              };
            }
            throw err;
          }
          deferredDispose = resolvedDeferred.dispose;

          for (const [mountAlias, instance] of Object.entries(
            resolvedDeferred.extensions
          )) {
            for (const [fnName, fn] of Object.entries(instance)) {
              if (
                fnName === 'dispose' ||
                fnName === 'suspend' ||
                fnName === 'restore'
              ) {
                continue;
              }
              deferredFunctions[`${mountAlias}::${fnName}`] =
                fn as import('@rcrsr/rill').ApplicationCallable;
            }
          }
        }
      }

      metrics.sessionsActive.labels({ agent: agent.card.name }).inc();

      const sessionController = sessionManager.getController(sessionId);
      const controller = sessionController!;

      const observability: ObservabilityCallbacks = {
        onStepEnd() {
          metrics.stepsTotal.inc();
          record.stepCount++;
        },
        onHostCall(event) {
          metrics.hostCallsTotal.labels({ function: event.name }).inc();
        },
      };

      const baseContext = agent.context;
      const sessionContext = createRuntimeContext({
        ...(input.params !== undefined && {
          variables: input.params as Record<
            string,
            import('@rcrsr/rill').RillValue
          >,
        }),
        ...(baseContext.timeout !== undefined && {
          timeout: baseContext.timeout,
        }),
        observability,
        signal: controller.signal,
        maxCallStackDepth: baseContext.maxCallStackDepth,
        metadata: {
          correlationId,
          sessionId: record.id,
          agentName: agent.card.name,
          ...(input.timeout !== undefined && {
            timeoutDeadline: String(Date.now() + input.timeout),
          }),
          // AC-7: Merge resolved deferred context values into metadata
          ...deferredContextValues,
        },
      });

      for (const [name, fn] of baseContext.functions) {
        sessionContext.functions.set(name, fn);
      }

      // AC-6: Merge resolved deferred extension functions into session context
      for (const [name, fn] of Object.entries(deferredFunctions)) {
        sessionContext.functions.set(name, fn);
      }

      const executionStart = Date.now();

      // AC-6: Dispose deferred extensions after execution completes (try/finally)
      try {
        const result = await execute(agent.ast, sessionContext);
        const durationMs = Date.now() - executionStart;

        metrics.executionDurationSeconds
          .labels({ agent: agent.card.name })
          .observe(durationMs / 1000);
        record.state = 'completed';
        record.durationMs = durationMs;
        record.result = result.result;
        record.variables = Object.fromEntries(sessionContext.variables);

        metrics.sessionsActive.labels({ agent: agent.card.name }).dec();
        metrics.sessionsTotal
          .labels({
            state: 'completed',
            trigger:
              typeof input.trigger === 'object'
                ? input.trigger.type
                : (input.trigger ?? 'api'),
            agent: agent.card.name,
          })
          .inc();

        const responseBody = JSON.stringify({
          sessionId,
          correlationId,
          state: 'completed',
          result: result.result,
          durationMs,
        });

        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: responseBody,
        };
      } catch (err: unknown) {
        const durationMs = Date.now() - executionStart;

        metrics.executionDurationSeconds
          .labels({ agent: agent.card.name })
          .observe(durationMs / 1000);
        record.state = 'failed';
        record.durationMs = durationMs;
        record.error = err instanceof Error ? err.message : String(err);

        console.error(
          `[rill-host] session ${sessionId} failed: ${record.error}`
        );

        metrics.sessionsActive.labels({ agent: agent.card.name }).dec();
        metrics.sessionsTotal
          .labels({
            state: 'failed',
            trigger:
              typeof input.trigger === 'object'
                ? input.trigger.type
                : (input.trigger ?? 'api'),
            agent: agent.card.name,
          })
          .inc();

        const errorMessage = err instanceof Error ? err.message : String(err);
        const errorCode =
          err != null &&
          typeof err === 'object' &&
          'code' in err &&
          typeof (err as { code: unknown }).code === 'string'
            ? (err as { code: string }).code
            : 'RUNTIME_ERROR';

        return {
          statusCode: 500,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: errorMessage, code: errorCode }),
        };
      } finally {
        // AC-6: Dispose deferred extensions after execution completes
        if (deferredDispose !== undefined) {
          await deferredDispose();
        }
      }
    } catch (err: unknown) {
      // Errors from sessionManager.create() (capacity) or other setup errors
      const errorMessage = err instanceof Error ? err.message : String(err);
      const errorCode =
        err != null &&
        typeof err === 'object' &&
        'code' in err &&
        typeof (err as { code: unknown }).code === 'string'
          ? (err as { code: string }).code
          : 'SETUP_ERROR';

      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: errorMessage, code: errorCode }),
      };
    }
  };
}

// ============================================================
// HELPERS
// ============================================================

/**
 * Translates an API Gateway event body into a RunRequest.
 * Body is expected to be JSON. Invalid or absent body yields empty params.
 */
function buildRunRequest(event: APIGatewayEvent): RunRequest {
  if (event.body === null || event.body === '') {
    return { trigger: 'http' };
  }

  try {
    const parsed: unknown = JSON.parse(event.body);
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed)
    ) {
      const body = parsed as Record<string, unknown>;
      const request: RunRequest = { trigger: 'http' };
      if (
        body['params'] !== undefined &&
        body['params'] !== null &&
        typeof body['params'] === 'object' &&
        !Array.isArray(body['params'])
      ) {
        (request as { params?: Record<string, unknown> }).params = body[
          'params'
        ] as Record<string, unknown>;
      }
      if (typeof body['timeout'] === 'number') {
        (request as { timeout?: number }).timeout = body['timeout'];
      }
      if (typeof body['callback'] === 'string') {
        (request as { callback?: string }).callback = body['callback'];
      }
      if (
        body['runtimeConfig'] !== undefined &&
        body['runtimeConfig'] !== null &&
        typeof body['runtimeConfig'] === 'object' &&
        !Array.isArray(body['runtimeConfig'])
      ) {
        const rc = body['runtimeConfig'] as Record<string, unknown>;
        const stringRecord: Record<string, string> = {};
        for (const [k, v] of Object.entries(rc)) {
          if (typeof v === 'string') {
            stringRecord[k] = v;
          }
        }
        (request as { runtimeConfig?: Record<string, string> }).runtimeConfig =
          stringRecord;
      }
      return request;
    }
  } catch {
    // Malformed JSON — return trigger only
  }

  return { trigger: 'http' };
}
