export interface InterpolationResult {
  /** The interpolated string value. */
  readonly value: string;
  /** Variable names that could not be resolved. */
  readonly unresolved: readonly string[];
  /** @{VAR} names found in the input (preserved literally in output). */
  readonly deferred: readonly string[];
}

// ============================================================
// TYPES
// ============================================================

/**
 * Return type of `interpolateConfigDeep`. Separates fully resolved config
 * from entries that contain `@{VAR}` deferred placeholders.
 */
export interface ConfigInterpolationResult {
  /** Fully resolved config object (existing return shape). */
  readonly resolved: Record<string, Record<string, unknown>>;
  /**
   * Map of `section.key` dot-paths to the `@{VAR}` variable names they
   * contain. Empty when no deferred placeholders are present.
   */
  readonly deferredKeys: ReadonlyMap<string, readonly string[]>;
}

// ============================================================
// HELPERS
// ============================================================

const IDENTIFIER = '[A-Z_][A-Z0-9_]*';
const ENV_PATTERN = new RegExp(`(?<!\\$\\{)\\$\\{(${IDENTIFIER})\\}`, 'g');
const DEFERRED_PATTERN = new RegExp(`@\\{(${IDENTIFIER})\\}`, 'g');

// ============================================================
// FACTORY
// ============================================================

/**
 * Interpolates `${IDENTIFIER}` placeholders in a string using the provided env map.
 * Recognizes `@{IDENTIFIER}` patterns and preserves them literally in output,
 * collecting their names in the returned `deferred` array.
 *
 * IDENTIFIER must match `[A-Z_][A-Z0-9_]*`. Lowercase or mixed-case names are
 * treated as literals and left unchanged.
 *
 * Unresolved variables remain as `${VAR}` in the output and appear in the
 * returned `unresolved` array. Empty string is a valid resolved value.
 *
 * DEVIATION: The spec declares the return type as `string`, but this
 * implementation returns `InterpolationResult` (matching the compose package
 * pattern in compose/src/interpolate.ts) to surface unresolved variable names
 * to callers without a second pass.
 */
export function interpolateEnv(
  value: string,
  env: Record<string, string | undefined>
): InterpolationResult {
  const unresolved: string[] = [];
  const deferred: string[] = [];

  // Collect deferred @{VAR} names before replacing ${VAR} so the patterns
  // do not interfere with each other.
  let m: RegExpExecArray | null;
  DEFERRED_PATTERN.lastIndex = 0;
  while ((m = DEFERRED_PATTERN.exec(value)) !== null) {
    // m[1] is guaranteed by the regex group
    deferred.push(m[1] as string);
  }

  ENV_PATTERN.lastIndex = 0;
  const result = value.replace(ENV_PATTERN, (_match, name: string) => {
    if (
      Object.prototype.hasOwnProperty.call(env, name) &&
      env[name] !== undefined
    ) {
      return env[name];
    }
    unresolved.push(name);
    return `\${${name}}`;
  });

  return { value: result, unresolved, deferred };
}

/**
 * Walks a nested config object and interpolates `${VAR}` patterns in every
 * string value using `interpolateEnv`.
 *
 * `@{VAR}` patterns are preserved literally in `resolved` and their dot-path
 * locations are recorded in `deferredKeys`.
 *
 * Non-string values are passed through unchanged. Unset variables retain their
 * literal `${VAR}` pattern in the output (matching `interpolateEnv` behavior).
 *
 * Returns a new object; the original config is not mutated.
 */
export function interpolateConfigDeep(
  config: Record<string, Record<string, unknown>>,
  env: Record<string, string | undefined>
): ConfigInterpolationResult {
  const resolved: Record<string, Record<string, unknown>> = {};
  const deferredKeys = new Map<string, readonly string[]>();

  for (const section of Object.keys(config)) {
    const inner = config[section] ?? {};
    const interpolated: Record<string, unknown> = {};
    for (const key of Object.keys(inner)) {
      const val = inner[key];
      if (typeof val === 'string') {
        const interp = interpolateEnv(val, env);
        interpolated[key] = interp.value;
        if (interp.deferred.length > 0) {
          deferredKeys.set(`${section}.${key}`, interp.deferred);
        }
      } else {
        interpolated[key] = val;
      }
    }
    resolved[section] = interpolated;
  }

  return { resolved, deferredKeys };
}

// ============================================================
// VALIDATE
// ============================================================

const ALLOWED_DEFERRED_SECTIONS = new Set(['extensions.config', 'context.values']);

/**
 * Validates that `@{VAR}` placeholders appear only in the two allowed
 * rill-config.json sections: `extensions.config` and `context.values`.
 *
 * Walks the config object recursively and returns field paths where `@{VAR}`
 * appears outside those sections. Returns an empty array when all usages are
 * in allowed sections.
 */
export function validateDeferredScope(
  config: Record<string, unknown>
): readonly string[] {
  const violations: string[] = [];

  function walk(obj: unknown, path: string): void {
    if (typeof obj === 'string') {
      DEFERRED_PATTERN.lastIndex = 0;
      if (DEFERRED_PATTERN.test(obj) && !ALLOWED_DEFERRED_SECTIONS.has(path)) {
        violations.push(path);
      }
      return;
    }
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
      return;
    }
    for (const key of Object.keys(obj as Record<string, unknown>)) {
      const child = (obj as Record<string, unknown>)[key];
      const childPath = path.length === 0 ? key : `${path}.${key}`;
      // If the current path matches an allowed section, check child values
      // without descending further into sub-sections for violation detection.
      if (ALLOWED_DEFERRED_SECTIONS.has(childPath)) {
        // Values under this path are allowed; no need to walk them.
        continue;
      }
      walk(child, childPath);
    }
  }

  walk(config, '');
  return violations;
}
