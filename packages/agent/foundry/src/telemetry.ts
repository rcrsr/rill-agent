import { trace, type Tracer } from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';

// ============================================================
// TYPES
// ============================================================

export interface TelemetryOptions {
  agentName?: string | undefined;
  agentVersion?: string | undefined;
}

// ============================================================
// STATE
// ============================================================

let sdk: NodeSDK | undefined;

// ============================================================
// FACTORY
// ============================================================

/**
 * Initialize the OpenTelemetry SDK when OTEL_EXPORTER_OTLP_ENDPOINT is set.
 * No-op when the env var is absent. Safe to call multiple times.
 */
export function initTelemetry(options?: TelemetryOptions): void {
  if (!process.env['OTEL_EXPORTER_OTLP_ENDPOINT']) return;
  if (sdk !== undefined) return;

  const resource = resourceFromAttributes({
    'service.name': options?.agentName ?? 'rill-foundry-harness',
    'service.version': options?.agentVersion ?? '0.0.0',
  });

  const traceExporter = new OTLPTraceExporter();

  sdk = new NodeSDK({ resource, traceExporter });
  sdk.start();
}

// ============================================================
// HELPERS
// ============================================================

/**
 * Return a tracer for the foundry harness instrumentation scope.
 * Returns a no-op tracer when the SDK is not initialized.
 */
export function getTracer(): Tracer {
  return trace.getTracer('rill-foundry-harness');
}

// ============================================================
// DISPOSE
// ============================================================

/**
 * Gracefully shut down the OpenTelemetry SDK and flush pending spans.
 * No-op when the SDK was never initialized.
 */
export async function shutdownTelemetry(): Promise<void> {
  if (sdk === undefined) return;
  const instance = sdk;
  sdk = undefined;
  await instance.shutdown();
}
