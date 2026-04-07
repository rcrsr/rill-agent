import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AgentHandler, AgentManifest } from './types.js';

/**
 * Load an agent manifest from a directory.
 *
 * If manifest.json exists, reads it and imports handler.js for each agent.
 * If no manifest.json but handler.js exists in the directory, treats it as
 * a single-agent deployment (auto-detect).
 */
export async function loadManifest(dir: string): Promise<AgentManifest> {
  const absDir = path.resolve(dir);
  const manifestPath = path.join(absDir, 'manifest.json');

  if (existsSync(manifestPath)) {
    return loadMultiAgent(absDir, manifestPath);
  }

  // Auto-detect single agent: look for handler.js directly
  const handlerPath = path.join(absDir, 'handler.js');
  if (existsSync(handlerPath)) {
    return loadSingleAgent(absDir, handlerPath);
  }

  // Check one level deep (build/[name]/ pattern)
  const entries = readdirSync(absDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const nested = path.join(absDir, entry.name, 'handler.js');
      if (existsSync(nested)) {
        return loadSingleAgent(path.join(absDir, entry.name), nested);
      }
    }
  }

  throw new Error(`No manifest.json or handler.js found in ${absDir}`);
}

async function loadMultiAgent(
  dir: string,
  manifestPath: string
): Promise<AgentManifest> {
  const raw = JSON.parse(readFileSync(manifestPath, 'utf-8')) as Record<
    string,
    unknown
  >;

  const defaultAgent = typeof raw['default'] === 'string' ? raw['default'] : '';
  const agentsConfig = raw['agents'];

  if (
    agentsConfig === undefined ||
    agentsConfig === null ||
    typeof agentsConfig !== 'object' ||
    Array.isArray(agentsConfig)
  ) {
    throw new Error('manifest.json must have an "agents" object');
  }

  const agents = new Map<string, AgentHandler>();

  for (const [name, relPath] of Object.entries(
    agentsConfig as Record<string, unknown>
  )) {
    if (typeof relPath !== 'string' || relPath === '') {
      throw new Error(
        `Agent "${name}" in manifest.json must have a non-empty string path`
      );
    }
    const handlerPath = path.resolve(dir, relPath, 'handler.js');
    if (!existsSync(handlerPath)) {
      throw new Error(
        `handler.js not found for agent "${name}" at ${handlerPath}`
      );
    }
    const handler = await importHandler(handlerPath);
    agents.set(name, handler);
  }

  if (defaultAgent === '' && agents.size === 1) {
    const firstName = agents.keys().next().value as string;
    return { defaultAgent: firstName, agents };
  }

  if (defaultAgent !== '' && !agents.has(defaultAgent)) {
    throw new Error(`Default agent "${defaultAgent}" not found in manifest`);
  }

  return {
    defaultAgent: defaultAgent || (agents.keys().next().value as string),
    agents,
  };
}

async function loadSingleAgent(
  agentDir: string,
  handlerPath: string
): Promise<AgentManifest> {
  const handler = await importHandler(handlerPath);
  const description = handler.describe();
  const name = description?.name ?? path.basename(agentDir);

  const agents = new Map<string, AgentHandler>();
  agents.set(name, handler);

  return { defaultAgent: name, agents };
}

async function importHandler(handlerPath: string): Promise<AgentHandler> {
  const url = pathToFileURL(handlerPath).href;
  const mod = (await import(url)) as Record<string, unknown>;

  if (typeof mod['describe'] !== 'function') {
    throw new Error(`handler.js at ${handlerPath} does not export describe()`);
  }
  if (typeof mod['init'] !== 'function') {
    throw new Error(`handler.js at ${handlerPath} does not export init()`);
  }
  if (typeof mod['execute'] !== 'function') {
    throw new Error(`handler.js at ${handlerPath} does not export execute()`);
  }
  if (typeof mod['dispose'] !== 'function') {
    throw new Error(`handler.js at ${handlerPath} does not export dispose()`);
  }

  return mod as unknown as AgentHandler;
}
