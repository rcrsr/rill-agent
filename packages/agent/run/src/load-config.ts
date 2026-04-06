import { readFileSync } from 'node:fs';
import { parseConfig } from '@rcrsr/rill-config';

/**
 * Load and interpolate agent config from a file path or inline JSON string.
 *
 * File path detection: value contains '/' or '\', or ends with '.json'.
 * Inline JSON: any other value is parsed directly as JSON.
 *
 * EC-6: throws with readable path error if the file is not found.
 * EC-7: throws with parse error if JSON is invalid.
 * EC-8: throws if JSON is not an object.
 */
export function loadConfig(
  value: string,
  env: Record<string, string | undefined> = process.env
): Record<string, Record<string, unknown>> {
  const isPath =
    value.includes('/') || value.includes('\\') || value.endsWith('.json');

  // EC-6: file reads may throw Node.js ENOENT — let propagate as-is
  const raw = isPath ? readFileSync(value, 'utf-8') : value;

  // EC-7: JSON parse error → wrap with "Invalid JSON in config: {detail}"
  // EC-8: non-object JSON → wrap with "Config must be a JSON object, got: {value}"
  // Pre-parse to produce exact error messages before passing raw to parseConfig.
  let preParsed: unknown;
  try {
    preParsed = JSON.parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid JSON in config: ${msg}`, { cause: err });
  }

  if (
    preParsed === null ||
    typeof preParsed !== 'object' ||
    Array.isArray(preParsed)
  ) {
    throw new Error(
      `Config must be a JSON object, got: ${JSON.stringify(preParsed)}`
    );
  }

  // Filter undefined env values — parseConfig requires Record<string, string>
  const filteredEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v !== undefined) filteredEnv[k] = v;
  }

  return parseConfig(raw, filteredEnv) as Record<
    string,
    Record<string, unknown>
  >;
}
