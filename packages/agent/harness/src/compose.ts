import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  type RillValue,
  type ApplicationCallable,
  type ScriptCallable,
  createRuntimeContext,
  parse,
  execute,
  RuntimeError,
  callable,
  isDict,
  isScriptCallable,
} from '@rcrsr/rill';
import {
  parseConfig,
  parseMainField,
  loadExtensions,
  resolveMounts,
  buildResolvers,
  introspectHandler,
  type RillConfigFile,
} from '@rcrsr/rill-config';
import {
  type AgentRunner,
  type InProcessRunRequest,
  type InProcessRunResponse,
  type ComposedAgent,
  type ExtensionResult,
  type DeferredExtensionEntry,
  type DeferredContextEntry,
  type InputSchema,
  type AgentCardInput,
  type SlimHarnessConfig,
  ComposeError,
  ManifestValidationError,
  generateAgentCard,
  validateDeferredScope,
  validateSlimHarness,
} from '@rcrsr/rill-agent-shared';
import { AgentHostError } from './core/errors.js';

// ============================================================
// PUBLIC INTERFACES
// ============================================================

export interface ComposeOptions {
  readonly config: Record<string, Record<string, unknown>>;
  readonly env: Record<string, string | undefined>;
}

export interface ComposedHarness {
  readonly agents: Map<string, ComposedAgent>;
  readonly sharedExtensions: Record<string, ExtensionResult>;
  bindHost(host: AgentRunner): void;
  dispose(): Promise<void>;
}

/**
 * Result of resolving deferred extensions for a single request.
 * Caller must invoke dispose() after the request completes.
 */
export interface ResolvedDeferredResult {
  /** Resolved extension instances keyed by mount alias. */
  readonly extensions: Record<string, ExtensionResult>;
  /** Disposes all resolved instances. Call after request completes. */
  dispose(): Promise<void>;
}

// ============================================================
// INTERNAL HELPERS
// ============================================================

/**
 * Separate dispose from functions and prefix function names with namespace.
 * Replaces the removed hoistExtension from @rcrsr/rill v0.18.0.
 *
 * @param namespace - Extension namespace (e.g. "fs", "ahi")
 * @param extension - Extension result from factory
 * @returns Separated prefixed ApplicationCallable map and dispose handler
 */
function hoistExtension(
  namespace: string,
  extension: ExtensionResult
): { functions: Record<string, ApplicationCallable>; dispose?: () => void | Promise<void> } {
  const { dispose, ...rest } = extension;
  const functions: Record<string, ApplicationCallable> = {};
  for (const [name, fn] of Object.entries(rest)) {
    if (name === 'suspend' || name === 'restore') continue;
    functions[`${namespace}::${name}`] = fn as ApplicationCallable;
  }
  if (dispose !== undefined) {
    return { functions, dispose };
  }
  return { functions };
}


// ============================================================
// INTERNAL: BIND HOST
// ============================================================

/**
 * Wire in-process AHI routing for a ComposedHarness.
 * For each agent in the harness, replaces ahi:: function entries that
 * target other agents in the harness with in-process callables.
 */
export function bindHost(
  agents: Map<string, ComposedAgent>,
  host: AgentRunner
): void {
  const harnessAgentNames = new Set(agents.keys());

  for (const [callerAgentName, agent] of agents) {
    for (const [fnKey] of agent.context.functions) {
      if (!fnKey.startsWith('ahi::')) continue;

      const targetName = fnKey.slice('ahi::'.length);

      // Resolution order 1: target is in the harness → in-process shortcut
      if (!harnessAgentNames.has(targetName)) continue;

      const inProcessFn = callable(async (args, ctx): Promise<RillValue> => {
        // Extract params from args[0] if it is a dict
        const firstArg = args[0];
        const params: Record<string, unknown> =
          firstArg !== undefined && isDict(firstArg)
            ? (firstArg as Record<string, unknown>)
            : {};

        // Extract caller context from metadata
        const meta = ctx.metadata;
        const callerSessionId = meta?.['sessionId'];
        const callerCorrelationId = meta?.['correlationId'];
        const timeoutDeadlineStr = meta?.['timeoutDeadline'];

        // Compute effectiveTimeout: if deadline set, use max(1, deadline - now), else 0 (no timeout)
        let effectiveTimeout = 0;
        if (timeoutDeadlineStr !== undefined) {
          const deadline = Number(timeoutDeadlineStr);
          effectiveTimeout = Math.max(1, deadline - Date.now());
        }

        const request: InProcessRunRequest = {
          params,
          correlationId: callerCorrelationId,
          trigger: {
            type: 'agent',
            agentName: callerAgentName,
            sessionId: callerSessionId ?? '',
          },
          timeout: effectiveTimeout === 0 ? undefined : effectiveTimeout,
        };

        let response: InProcessRunResponse;
        try {
          response = await host.runForAgent(targetName, request);
        } catch (err) {
          // Duck-type AgentHostError capacity check (avoids value import / circular dep)
          if (
            err instanceof Error &&
            'phase' in err &&
            (err as { phase: unknown }).phase === 'capacity'
          ) {
            throw new RuntimeError('RILL-R032', 'AHI: rate limited');
          }
          throw err;
        }

        if (response.state === 'failed') {
          throw new RuntimeError(
            'RILL-R029',
            'AHI: downstream execution failed'
          );
        }

        return response.result ?? null;
      });

      agent.context.functions.set(fnKey, inProcessFn);
    }
  }
}

// ============================================================
// DEFERRED RESOLUTION
// ============================================================

/** Regex matching @{VAR} placeholders in config template values. */
const DEFERRED_VAR_RE = /@\{([A-Z_][A-Z0-9_]*)\}/g;

/**
 * Substitute all @{VAR} placeholders in a string value.
 * Returns the resolved string. Assumes all required vars are present.
 */
function substituteVars(
  template: string,
  runtimeConfig: Record<string, string>
): string {
  return template.replace(DEFERRED_VAR_RE, (_match, varName: string) => {
    return runtimeConfig[varName] ?? '';
  });
}

/**
 * Resolve @{VAR} placeholders in a config template.
 * Returns a new config object with all string values substituted.
 */
function resolveConfigTemplate(
  template: Record<string, unknown>,
  runtimeConfig: Record<string, string>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(template)) {
    result[key] =
      typeof value === 'string' ? substituteVars(value, runtimeConfig) : value;
  }
  return result;
}

/**
 * Extract an ExtensionFactory callable from a loaded module object.
 * Throws AgentHostError('init') if the module has no callable factory.
 */
function extractDeferredFactory(
  module: object,
  mountAlias: string
): (config: unknown) => ExtensionResult {
  const record = module as Record<string, unknown>;
  if ('default' in record && typeof record['default'] === 'function') {
    return record['default'] as (config: unknown) => ExtensionResult;
  }
  const named = Object.values(record).find((v) => typeof v === 'function');
  if (named !== undefined) {
    return named as (config: unknown) => ExtensionResult;
  }
  throw new AgentHostError(
    `Deferred extension ${mountAlias} module does not export a factory`,
    'init'
  );
}

/**
 * Resolves @{VAR} placeholders in deferred extension configs and instantiates
 * each extension factory per request. Returns resolved extensions and a
 * dispose function that cleans up all instances after request completion.
 *
 * @throws AgentHostError('init') when a required variable is missing [EC-8]
 * @throws AgentHostError('init') when an extension factory throws [EC-8]
 */
export async function resolveDeferredExtensions(
  deferred: readonly DeferredExtensionEntry[],
  runtimeConfig: Record<string, string>
): Promise<ResolvedDeferredResult> {
  // Collect all missing required variables across all entries
  const missingVars: string[] = [];
  for (const entry of deferred) {
    for (const varName of entry.requiredVars) {
      if (!(varName in runtimeConfig) && !missingVars.includes(varName)) {
        missingVars.push(varName);
      }
    }
  }
  if (missingVars.length > 0) {
    throw new AgentHostError(
      `Missing required runtime variables: ${missingVars.join(', ')}`,
      'init'
    );
  }

  const extensions: Record<string, ExtensionResult> = {};
  const disposeHandlers: Array<() => void | Promise<void>> = [];

  for (const entry of deferred) {
    const resolvedConfig = resolveConfigTemplate(
      entry.configTemplate,
      runtimeConfig
    );
    const factory = extractDeferredFactory(entry.module, entry.mountAlias);

    let instance: ExtensionResult;
    try {
      instance = factory(resolvedConfig);
    } catch (err) {
      // EC-8: factory throw — dispose already-instantiated instances, then wrap
      const toDispose = [...disposeHandlers].reverse();
      for (const handler of toDispose) {
        try {
          await handler();
        } catch {
          // Ignore individual dispose errors
        }
      }
      const msg = err instanceof Error ? err.message : String(err);
      throw new AgentHostError(
        `Deferred extension ${entry.mountAlias} failed to initialize: ${msg}`,
        'init',
        err,
        { extensionAlias: entry.mountAlias }
      );
    }

    extensions[entry.mountAlias] = instance;

    const hoisted = hoistExtension(entry.mountAlias, instance);
    if (hoisted.dispose !== undefined) {
      disposeHandlers.push(hoisted.dispose);
    }
  }

  const reverseDispose = [...disposeHandlers].reverse();

  return {
    extensions,
    async dispose(): Promise<void> {
      for (const handler of reverseDispose) {
        try {
          await handler();
        } catch {
          // Ignore individual dispose errors
        }
      }
    },
  };
}

/**
 * Resolves @{VAR} placeholders in deferred context values per request.
 * Returns resolved context values to merge into the runtime context.
 *
 * @throws AgentHostError('init') when a required variable is missing [EC-9]
 */
export function resolveDeferredContext(
  deferred: readonly DeferredContextEntry[],
  runtimeConfig: Record<string, string>
): Record<string, unknown> {
  // Collect all missing required variables across all entries
  const missingVars: string[] = [];
  for (const entry of deferred) {
    for (const varName of entry.requiredVars) {
      if (!(varName in runtimeConfig) && !missingVars.includes(varName)) {
        missingVars.push(varName);
      }
    }
  }
  if (missingVars.length > 0) {
    throw new AgentHostError(
      `Missing required runtime variables: ${missingVars.join(', ')}`,
      'init'
    );
  }

  const result: Record<string, unknown> = {};
  for (const entry of deferred) {
    result[entry.key] = substituteVars(entry.template, runtimeConfig);
  }
  return result;
}

// ============================================================
// COMPOSE AGENT
// ============================================================

/**
 * Returns true if any string value in the flat config object contains an
 * @{VAR} placeholder.
 */
function hasDeferredVars(config: Record<string, unknown>): boolean {
  const re = /@\{[A-Z_][A-Z0-9_]*\}/;
  for (const value of Object.values(config)) {
    if (typeof value === 'string' && re.test(value)) return true;
  }
  return false;
}

/**
 * Extracts all unique @{VAR} variable names from string values in a flat
 * config object. Returns an empty array when no deferred vars are present.
 */
function extractDeferredVarNames(config: Record<string, unknown>): string[] {
  const names: string[] = [];
  for (const value of Object.values(config)) {
    if (typeof value === 'string') {
      DEFERRED_VAR_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = DEFERRED_VAR_RE.exec(value)) !== null) {
        const name = m[1] as string;
        if (!names.includes(name)) names.push(name);
      }
    }
  }
  return names;
}

/**
 * Maps a rill-config HandlerParam type string to an InputSchema type.
 * Returns null for 'any' (not representable in InputSchema).
 */
function mapHandlerParamType(
  type: string
): 'string' | 'number' | 'bool' | 'list' | 'dict' | null {
  switch (type) {
    case 'string':
      return 'string';
    case 'number':
      return 'number';
    case 'bool':
      return 'bool';
    case 'list':
      return 'list';
    case 'dict':
      return 'dict';
    default:
      return null;
  }
}

/**
 * Builds an InputSchema from handler introspection params.
 * Returns undefined when all params are untyped (any) or there are no params.
 */
function buildInputSchema(
  params: ReturnType<typeof introspectHandler>['params']
): InputSchema | undefined {
  if (params.length === 0) return undefined;
  const schema: InputSchema = {};
  for (const param of params) {
    const mappedType = mapHandlerParamType(param.type);
    if (mappedType === null) continue;
    const descriptor: InputSchema[string] = { type: mappedType };
    if (param.required) descriptor.required = true;
    if (param.description !== undefined) descriptor.description = param.description;
    schema[param.name] = descriptor;
  }
  return Object.keys(schema).length > 0 ? schema : undefined;
}

/**
 * Compose an agent from a project directory containing rill-config.json.
 *
 * Loads and validates rill-config.json, resolves extensions, introspects the
 * handler, and returns a ComposedAgent ready for execution.
 *
 * @param projectDir - Directory containing rill-config.json and entry .rill file
 * @param options - env for ${VAR} resolution; config for per-extension overrides
 * @returns ComposedAgent with context, AST, card, deferred fields, and dispose()
 * @throws ComposeError on any composition failure
 */
export async function composeAgent(
  projectDir: string,
  options: ComposeOptions
): Promise<ComposedAgent> {
  // Step 1: Read rill-config.json
  const configPath = path.join(projectDir, 'rill-config.json');
  let raw: string;
  try {
    raw = readFileSync(configPath, 'utf-8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ComposeError(
      `rill-config.json not found or unreadable: ${msg}`,
      'validation'
    );
  }

  // Step 2: Parse config — resolves ${VAR} with env, leaves @{VAR} as literals.
  // Filter undefined values from env (parseConfig requires Record<string, string>).
  const filteredEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(options.env)) {
    if (v !== undefined) filteredEnv[k] = v;
  }

  let config: RillConfigFile;
  try {
    config = parseConfig(raw, filteredEnv);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ComposeError(msg, 'validation');
  }

  // Step 3: Validate @{VAR} scope — must only appear in extensions.config and
  // context.values (EC-2).
  const violations = validateDeferredScope(config as Record<string, unknown>);
  if (violations.length > 0) {
    throw new ComposeError(
      `@{VAR} placeholders in disallowed sections: ${violations.join(', ')}`,
      'validation'
    );
  }

  // Step 4: Parse and validate main field — handler suffix is required (EC-2).
  if (config.main === undefined || config.main.length === 0) {
    throw new ComposeError('handler mode required', 'validation');
  }
  let parsedMain: { filePath: string; handlerName?: string | undefined };
  try {
    parsedMain = parseMainField(config.main);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ComposeError(msg, 'validation');
  }
  if (parsedMain.handlerName === undefined) {
    throw new ComposeError('handler mode required', 'validation');
  }
  const handlerName = parsedMain.handlerName;

  // Step 5: Merge per-extension config from file and caller options.
  // Caller options override file config for the same alias.
  const extensionMounts = config.extensions?.mounts ?? {};
  const fileExtConfig = (config.extensions?.config ?? {}) as Record<
    string,
    Record<string, unknown>
  >;
  const mergedExtConfig: Record<string, Record<string, unknown>> = {};
  for (const alias of Object.keys(extensionMounts)) {
    mergedExtConfig[alias] = {
      ...(fileExtConfig[alias] ?? {}),
      ...(options.config[alias] ?? {}),
    };
  }

  // Step 6: Partition mounts into static (no @{VAR}) and deferred (@{VAR}).
  const staticMountsRecord: Record<string, string> = {};
  const deferredMountAliases: string[] = [];
  for (const [alias, specifier] of Object.entries(extensionMounts)) {
    const extCfg = mergedExtConfig[alias] ?? {};
    if (hasDeferredVars(extCfg)) {
      deferredMountAliases.push(alias);
    } else {
      staticMountsRecord[alias] = specifier;
    }
  }

  // Step 7: Load static extensions via rill-config loadExtensions (EC-3).
  let extTree: Record<string, RillValue> = {};
  let disposes: ReadonlyArray<() => void | Promise<void>> = [];
  if (Object.keys(staticMountsRecord).length > 0) {
    const staticMounts = resolveMounts(staticMountsRecord);
    const staticConfig: Record<string, Record<string, unknown>> = {};
    for (const alias of Object.keys(staticMountsRecord)) {
      staticConfig[alias] = mergedExtConfig[alias] ?? {};
    }
    try {
      const loaded = await loadExtensions(staticMounts, staticConfig);
      extTree = loaded.extTree as Record<string, RillValue>;
      disposes = loaded.disposes;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new ComposeError(msg, 'resolution');
    }
  }

  // Step 8: Build deferred extension entries — import module and validate manifest
  // at load time but defer factory invocation until runtime (AC-5).
  const deferredExtensions: DeferredExtensionEntry[] = [];
  for (const alias of deferredMountAliases) {
    const specifier = extensionMounts[alias] as string;
    let mod: object;
    try {
      mod = (await import(specifier)) as object;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new ComposeError(`Extension not found: ${specifier} — ${msg}`, 'resolution');
    }
    const record = mod as Record<string, unknown>;
    if (
      !('extensionManifest' in record) ||
      record['extensionManifest'] === null ||
      typeof record['extensionManifest'] !== 'object'
    ) {
      throw new ComposeError(
        `Extension ${specifier} does not export extensionManifest`,
        'resolution'
      );
    }
    const extCfg = mergedExtConfig[alias] ?? {};
    deferredExtensions.push({
      mountAlias: alias,
      module: mod,
      manifest: record['extensionManifest'] as object,
      configTemplate: extCfg,
      requiredVars: extractDeferredVarNames(extCfg),
    });
  }

  // Step 9: Build deferred context entries from context.values with @{VAR}.
  const deferredContext: DeferredContextEntry[] = [];
  const contextValues = config.context?.values ?? {};
  for (const [key, value] of Object.entries(contextValues)) {
    if (typeof value === 'string' && /@\{[A-Z_][A-Z0-9_]*\}/.test(value)) {
      deferredContext.push({
        key,
        template: value,
        requiredVars: extractDeferredVarNames({ [key]: value }),
      });
    }
  }

  // Collect all unique runtime variable names from deferred entries.
  const runtimeVarSet = new Set<string>();
  for (const entry of deferredExtensions) {
    for (const v of entry.requiredVars) runtimeVarSet.add(v);
  }
  for (const entry of deferredContext) {
    for (const v of entry.requiredVars) runtimeVarSet.add(v);
  }
  const runtimeVariables = [...runtimeVarSet];

  // Step 10: Build resolvers from loaded extension tree, static context values,
  // and module directory mappings.
  const staticContextValues: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(contextValues)) {
    // Exclude deferred context values from the static resolver config.
    if (typeof value !== 'string' || !/@\{[A-Z_][A-Z0-9_]*\}/.test(value)) {
      staticContextValues[key] = value;
    }
  }
  const resolverConfig = buildResolvers({
    extTree,
    contextValues: staticContextValues,
    modulesConfig: (config.modules ?? {}) as Record<string, string>,
    configDir: projectDir,
  });

  // Step 11: Create RuntimeContext with resolvers and host options.
  const hostOpts = config.host ?? {};
  const context = createRuntimeContext({
    ...(hostOpts.timeout !== undefined ? { timeout: hostOpts.timeout } : {}),
    ...(hostOpts.maxCallStackDepth !== undefined
      ? { maxCallStackDepth: hostOpts.maxCallStackDepth }
      : {}),
    resolvers: resolverConfig.resolvers,
    configurations: resolverConfig.configurations,
    parseSource: parse,
  });

  // Step 12: Read and parse entry file.
  const entryFilePath = path.resolve(projectDir, parsedMain.filePath);
  if (!existsSync(entryFilePath)) {
    throw new ComposeError(`Entry file not found: ${entryFilePath}`, 'resolution');
  }
  let entrySource: string;
  try {
    entrySource = readFileSync(entryFilePath, 'utf-8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ComposeError(`Failed to read entry file ${entryFilePath}: ${msg}`, 'resolution');
  }
  let ast: ReturnType<typeof parse>;
  try {
    ast = parse(entrySource);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ComposeError(`Parse error in ${entryFilePath}: ${msg}`, 'resolution');
  }

  // Step 13: Execute the entry script to populate handler variables.
  try {
    await execute(ast, context);
  } catch (err) {
    // Preserve rill error codes (e.g. RILL-R002) when wrapping RuntimeError.
    const prefix =
      err instanceof RuntimeError ? `${err.errorId}: ` : '';
    const msg = err instanceof Error ? err.message : String(err);
    throw new ComposeError(
      `Execution error in ${entryFilePath}: ${prefix}${msg}`,
      'resolution'
    );
  }

  // Step 14: Extract the named handler callable for introspection.
  const handlerValue = context.variables.get(handlerName);
  if (handlerValue === undefined || !isScriptCallable(handlerValue)) {
    throw new ComposeError(
      `Handler '${handlerName}' not found or not a callable in ${entryFilePath}`,
      'resolution'
    );
  }
  const handlerCallable: ScriptCallable = handlerValue;

  // Step 15: Introspect the handler for description and parameter metadata.
  const introspection = introspectHandler(handlerCallable);

  // Step 16: Build agent card from introspection results.
  const inputSchema = buildInputSchema(introspection.params);
  const cardInput: AgentCardInput = {
    name: config.name ?? path.basename(projectDir),
    version: config.version ?? '0.0.0',
    runtimeVariables,
    ...(introspection.description !== undefined
      ? { description: introspection.description }
      : {}),
    ...(inputSchema !== undefined ? { input: inputSchema } : {}),
  };
  const card = generateAgentCard(cardInput);

  // Step 17: Build dispose handler — call disposes in reverse order.
  const capturedDisposes = [...disposes].reverse();

  return {
    context,
    ast,
    modules: {},
    card,
    extensions: {},
    deferredExtensions,
    deferredContext,
    runtimeVariables,
    async dispose(): Promise<void> {
      for (const handler of capturedDisposes) {
        try {
          await handler();
        } catch {
          // Ignore individual dispose errors
        }
      }
    },
  };
}

// ============================================================
// COMPOSE HARNESS
// ============================================================

/**
 * Compose a harness from a directory containing harness.json.
 * Reads and validates harness.json, then composes each agent independently
 * by calling composeAgent() per agent directory.
 *
 * @param harnessDir - Directory containing harness.json
 * @param options - env for ${VAR} resolution; config for per-extension overrides
 * @returns ComposedHarness with agents map, sharedExtensions, bindHost(), and dispose()
 * @throws ManifestValidationError when harness.json is missing or malformed (EC-4)
 * @throws ComposeError when an agent directory is missing rill-config.json (EC-5)
 * @throws ComposeError propagated from composeAgent() for per-agent failures (EC-6)
 */
export async function composeHarness(
  harnessDir: string,
  options: ComposeOptions
): Promise<ComposedHarness> {
  // Step 1: Read harness.json
  const harnessPath = path.join(harnessDir, 'harness.json');
  let raw: unknown;
  try {
    const src = readFileSync(harnessPath, 'utf-8');
    raw = JSON.parse(src) as unknown;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ManifestValidationError(
      `harness.json not found or unreadable: ${msg}`,
      [{ path: 'manifest', message: msg }],
      'manifest'
    );
  }

  // Step 2: Validate harness.json against slim harness schema (EC-4)
  const harnessConfig: SlimHarnessConfig = validateSlimHarness(raw);

  // Step 3: Compose each agent independently
  const agents = new Map<string, ComposedAgent>();
  const agentDisposeHandlers: Array<() => Promise<void>> = [];

  for (const agentEntry of harnessConfig.agents) {
    const agentDir = path.resolve(harnessDir, agentEntry.path);

    // EC-5: check rill-config.json exists before calling composeAgent
    const configPath = path.join(agentDir, 'rill-config.json');
    if (!existsSync(configPath)) {
      // Dispose already-composed agents before throwing
      for (const handler of [...agentDisposeHandlers].reverse()) {
        try {
          await handler();
        } catch {
          // Ignore individual dispose errors
        }
      }
      throw new ComposeError(
        `Agent '${agentEntry.name}' directory missing rill-config.json: ${agentDir}`,
        'validation'
      );
    }

    // EC-6: propagate ComposeError from composeAgent
    let composed: ComposedAgent;
    try {
      composed = await composeAgent(agentDir, options);
    } catch (err) {
      // Dispose already-composed agents before re-throwing
      for (const handler of [...agentDisposeHandlers].reverse()) {
        try {
          await handler();
        } catch {
          // Ignore individual dispose errors
        }
      }
      throw err;
    }

    agents.set(agentEntry.name, composed);
    agentDisposeHandlers.push(composed.dispose);
  }

  // Build ComposedHarness
  let disposed = false;

  return {
    agents,
    sharedExtensions: {},

    bindHost(host: AgentRunner): void {
      if (disposed) return;
      bindHost(agents, host);
    },

    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;

      for (const handler of [...agentDisposeHandlers].reverse()) {
        try {
          await handler();
        } catch {
          // Ignore individual dispose errors
        }
      }
    },
  };
}
