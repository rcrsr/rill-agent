import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type {
  BundleAgentEntry,
  BundleManifest,
} from '@rcrsr/rill-agent-bundle';
import type {
  ComposedHandler,
  ComposedHandlerMap,
} from '@rcrsr/rill-agent-shared';

// ============================================================
// VERSION CONSTANTS
// ============================================================

/**
 * The bundle format version this harness supports.
 * Must match the configVersion written by the bundle tool.
 */
const SUPPORTED_CONFIG_VERSION = '2';

export type { BundleAgentEntry };

// ============================================================
// LOAD RESULT
// ============================================================

export interface LoadResult {
  readonly handler: ComposedHandler;
  readonly agentName: string;
  readonly bundleEntry: BundleAgentEntry;
}

// ============================================================
// BUNDLE MANIFEST VALIDATION
// ============================================================

function isBundleManifest(value: unknown): value is BundleManifest {
  if (value === null || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['name'] === 'string' &&
    typeof v['version'] === 'string' &&
    typeof v['built'] === 'string' &&
    typeof v['checksum'] === 'string' &&
    typeof v['rillVersion'] === 'string' &&
    typeof v['configVersion'] === 'string' &&
    v['agents'] !== null &&
    typeof v['agents'] === 'object'
  );
}

// ============================================================
// LOADER
// ============================================================

/**
 * Loads a bundle from disk and resolves a single agent handler.
 *
 * EC-19: bundleDir missing → Error with path
 * EC-20: bundle.json invalid JSON or schema mismatch → Error with parse error
 * EC-21: agent not found in bundle → Error with available names
 * EC-22: entry .rill missing → Error with file path
 * AC-59: bundle has 1 agent and no agentName → auto-select
 */
export async function loadBundle(
  bundleDir: string,
  agentName?: string | undefined
): Promise<LoadResult> {
  // EC-19: Validate bundle directory exists
  if (!existsSync(bundleDir)) {
    throw new Error(`Bundle directory not found: ${bundleDir}`);
  }

  // EC-20: Read and parse bundle.json
  const bundleJsonPath = path.join(bundleDir, 'bundle.json');

  // Step 1: Parse raw JSON — JSON syntax errors wrapped as "Invalid bundle.json"
  let rawParsed: unknown;
  try {
    rawParsed = JSON.parse(readFileSync(bundleJsonPath, 'utf-8'));
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid bundle.json at ${bundleJsonPath}: ${detail}`, {
      cause: err,
    });
  }

  // Step 2: Check configVersion before full schema validation so specific
  // error messages are not wrapped in "Invalid bundle.json at ...".
  // EC-14: missing configVersion → outdated bundle error
  // AC-29: incompatible configVersion → version mismatch error
  if (
    rawParsed !== null &&
    typeof rawParsed === 'object' &&
    !Array.isArray(rawParsed)
  ) {
    const rawObj = rawParsed as Record<string, unknown>;
    if (!('configVersion' in rawObj)) {
      throw new Error(
        'Bundle format outdated; rebuild with current bundle tool'
      );
    }
    if (rawObj['configVersion'] !== SUPPORTED_CONFIG_VERSION) {
      throw new Error(
        `Bundle version ${String(rawObj['configVersion'])} not supported by harness version ${SUPPORTED_CONFIG_VERSION}`
      );
    }
  }

  // Step 3: Validate full schema — schema mismatches wrapped as "Invalid bundle.json"
  let manifest: BundleManifest;
  try {
    if (!isBundleManifest(rawParsed)) {
      throw new Error('Schema mismatch: missing required fields');
    }
    manifest = rawParsed;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid bundle.json at ${bundleJsonPath}: ${detail}`, {
      cause: err,
    });
  }

  // Resolve agent name (AC-59 / EC-21)
  const agentNames = Object.keys(manifest.agents);
  let resolvedName: string;

  if (agentName !== undefined) {
    if (!(agentName in manifest.agents)) {
      throw new Error(
        `Agent "${agentName}" not found in bundle. Available agents: ${agentNames.join(', ')}`
      );
    }
    resolvedName = agentName;
  } else if (agentNames.length === 1) {
    // AC-59: auto-select the single agent
    resolvedName = agentNames[0]!;
  } else {
    throw new Error(
      `No agent name provided and bundle contains multiple agents: ${agentNames.join(', ')}`
    );
  }

  const bundleEntry = manifest.agents[resolvedName]!;

  // EC-22: Verify entry .rill file exists
  const entryRillPath = path.join(
    bundleDir,
    'agents',
    resolvedName,
    'entry.rill'
  );
  if (!existsSync(entryRillPath)) {
    throw new Error(`Entry file not found: ${entryRillPath}`);
  }

  // Dynamically import handlers.js and extract the ComposedHandlerMap
  const handlersPath = path.join(bundleDir, 'handlers.js');
  const handlersUrl = pathToFileURL(handlersPath).href;
  const handlersModule = (await import(handlersUrl)) as {
    handlers: ComposedHandlerMap;
  };
  const handlers = handlersModule.handlers;

  const handler = handlers.get(resolvedName);
  if (handler === undefined) {
    throw new Error(
      `Handler for agent "${resolvedName}" not found in handlers.js`
    );
  }

  return { handler, agentName: resolvedName, bundleEntry };
}
