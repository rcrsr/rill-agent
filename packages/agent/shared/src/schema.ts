import { z } from 'zod';
import {
  type TypeStructure,
  type RillParam,
  RuntimeError,
} from '@rcrsr/rill';
import { ManifestValidationError, type ManifestIssue } from './errors.js';

// ============================================================
// INPUT / OUTPUT DESCRIPTOR TYPES (declared before schemas for z.lazy annotation)
// ============================================================

type InputParamDescriptor = {
  type: 'string' | 'number' | 'bool' | 'list' | 'dict';
  required?: boolean | undefined;
  description?: string | undefined;
  enum?: unknown[] | undefined;
  default?: unknown;
};

export type OutputSchema = {
  type: 'string' | 'number' | 'bool' | 'list' | 'dict';
  description?: string | undefined;
  fields?: Record<string, OutputSchema> | undefined;
};

// ============================================================
// INPUT / OUTPUT DESCRIPTOR SCHEMAS
// ============================================================

export const inputParamDescriptorSchema = z
  .object({
    type: z.enum(['string', 'number', 'bool', 'list', 'dict']),
    required: z.boolean().optional(),
    description: z.string().optional(),
    enum: z.array(z.unknown()).optional(),
    default: z.unknown().optional(),
  })
  .strict();

export const outputSchemaSchema: z.ZodType<OutputSchema> = z.lazy(() =>
  z
    .object({
      type: z.enum(['string', 'number', 'bool', 'list', 'dict']),
      description: z.string().optional(),
      fields: z.record(z.string(), outputSchemaSchema).optional(),
    })
    .strict()
);

export const inputSchemaSchema = z.record(
  z.string(),
  inputParamDescriptorSchema
);

export type InputSchema = z.infer<typeof inputSchemaSchema>;

// ============================================================
// STRUCTURAL TYPE SERIALIZATION
// ============================================================

/**
 * Maps a TypeStructure kind to the OutputSchema type string.
 * Throws RuntimeError RILL-R004 for closure or tuple (not representable in manifest format).
 */
function structuralKindToOutputType(
  type: TypeStructure
): 'string' | 'number' | 'bool' | 'list' | 'dict' {
  switch (type.kind) {
    case 'string':
      return 'string';
    case 'number':
      return 'number';
    case 'bool':
      return 'bool';
    case 'list':
      return 'list';
    case 'closure':
      throw new RuntimeError(
        'RILL-R004',
        `structural type 'closure' not representable in manifest`
      );
    case 'tuple':
      throw new RuntimeError(
        'RILL-R004',
        `structural type 'tuple' not representable in manifest`
      );
    // dict, ordered, any and all other kinds map to dict
    default:
      return 'dict';
  }
}

/**
 * Convert a TypeStructure to an InputSchema.
 *
 * For the closure variant, iterates type.params and matches each to the
 * corresponding RillParam by position for metadata (defaultValue, annotations).
 * For non-closure variants, treats the type as a single unnamed param using
 * params[0] for metadata.
 *
 * required = true when RillParam.defaultValue is undefined.
 * Propagates description and enum from annotations when present as strings/arrays.
 * Throws RuntimeError RILL-R004 if any param uses closure or tuple kind.
 */
export function structuralTypeToInputSchema(
  type: TypeStructure,
  params: RillParam[]
): InputSchema {
  const result: InputSchema = {};

  if (type.kind === 'closure') {
    const closureType = type as Extract<TypeStructure, { kind: 'closure' }>;
    const closureParams = closureType.params ?? [];
    for (let i = 0; i < closureParams.length; i++) {
      const fieldDef = closureParams[i]!;
      const name = fieldDef.name ?? String(i);
      const paramType = fieldDef.type;
      const callableParam = params[i];

      // Validate the structural type of this param
      if (paramType.kind === 'closure' || paramType.kind === 'tuple') {
        throw new RuntimeError(
          'RILL-R004',
          `structural type '${paramType.kind}' not representable in manifest`
        );
      }

      const inputType = structuralKindToOutputType(paramType);
      const descriptor: InputParamDescriptor = { type: inputType };

      if (callableParam !== undefined) {
        if (callableParam.defaultValue === undefined) {
          descriptor.required = true;
        }

        const desc = callableParam.annotations['description'];
        if (typeof desc === 'string') {
          descriptor.description = desc;
        }

        const enumVal = callableParam.annotations['enum'];
        if (Array.isArray(enumVal)) {
          descriptor.enum = enumVal;
        }
      }

      result[name] = descriptor;
    }
  } else {
    // Non-closure variant: treat the whole type as a single unnamed param
    if (type.kind === 'tuple') {
      throw new RuntimeError(
        'RILL-R004',
        `structural type 'tuple' not representable in manifest`
      );
    }

    const inputType = structuralKindToOutputType(type);
    const callableParam = params[0];
    const descriptor: InputParamDescriptor = { type: inputType };

    if (callableParam !== undefined) {
      if (callableParam.defaultValue === undefined) {
        descriptor.required = true;
      }

      const desc = callableParam.annotations['description'];
      if (typeof desc === 'string') {
        descriptor.description = desc;
      }

      const enumVal = callableParam.annotations['enum'];
      if (Array.isArray(enumVal)) {
        descriptor.enum = enumVal;
      }
    }

    result['value'] = descriptor;
  }

  return result;
}

/**
 * Convert a TypeStructure to an OutputSchema.
 *
 * Recursively converts nested types to OutputSchema fields for dict/ordered variants.
 * Throws RuntimeError RILL-R004 if any field uses closure or tuple kind.
 */
export function structuralTypeToOutputSchema(
  type: TypeStructure
): OutputSchema {
  if (type.kind === 'dict') {
    const dictType = type as Extract<TypeStructure, { kind: 'dict' }>;
    const fields: Record<string, OutputSchema> = {};
    for (const [name, fieldDef] of Object.entries(dictType.fields ?? {})) {
      fields[name] = structuralTypeToOutputSchema(fieldDef.type);
    }
    return { type: 'dict', fields };
  }

  if (type.kind === 'ordered') {
    const orderedType = type as Extract<TypeStructure, { kind: 'ordered' }>;
    const fields: Record<string, OutputSchema> = {};
    for (const fieldDef of orderedType.fields ?? []) {
      const name = fieldDef.name ?? '';
      if (name !== '') {
        fields[name] = structuralTypeToOutputSchema(fieldDef.type);
      }
    }
    return { type: 'dict', fields };
  }

  const outputType = structuralKindToOutputType(type);
  return { type: outputType };
}

// ============================================================
// AGENT SKILL SCHEMA
// ============================================================

export const agentSkillSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    tags: z.array(z.string()).optional(),
    examples: z.array(z.string()).optional(),
    inputModes: z.array(z.string()).optional(),
    outputModes: z.array(z.string()).optional(),
  })
  .strict();

// ============================================================
// SLIM HARNESS SCHEMAS
// ============================================================

const slimHarnessAgentSchema = z
  .object({
    name: z.string().min(1),
    path: z.string().min(1),
    maxConcurrency: z.number().int().positive().optional(),
  })
  .strict();

const slimHarnessConfigSchema = z
  .object({
    agents: z.array(slimHarnessAgentSchema).min(1),
    concurrency: z.number().int().positive().optional(),
    deploy: z
      .object({
        port: z.number().int().positive().optional(),
        healthPath: z.string().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

// ============================================================
// EXPORTED TYPES
// ============================================================

export type AgentSkill = z.infer<typeof agentSkillSchema>;
export type SlimHarnessAgent = z.infer<typeof slimHarnessAgentSchema>;
export type SlimHarnessConfig = z.infer<typeof slimHarnessConfigSchema>;

/**
 * Deployment target environment for an agent build.
 * Determines which compatibility checks are applied during composition.
 */
export type BuildTarget = 'container' | 'lambda' | 'worker' | 'local';

// ============================================================
// ISSUE CONVERSION
// ============================================================

/**
 * Converts a zod issue path array to a dot-notation string prefixed with "manifest.".
 * Examples: ["name"] → "manifest.name", ["extensions", "llm", "package"] → "manifest.extensions.llm.package"
 */
function toManifestPath(path: ReadonlyArray<string | number | symbol>): string {
  if (path.length === 0) return 'manifest';
  return 'manifest.' + path.map(String).join('.');
}

/**
 * Derives the actual type name from a zod invalid_type issue message.
 * Parses "Invalid input: expected {type}, received {actual}" → "{actual}".
 */
function parseReceivedType(message: string): string {
  const match = /received (\w+)/.exec(message);
  return match?.[1] ?? 'unknown';
}

/**
 * Converts a single zod issue to a ManifestIssue with spec-compliant message formatting.
 */
function zodIssueToManifestIssue(issue: z.core.$ZodIssue): ManifestIssue {
  const path = toManifestPath(issue.path);

  if (issue.code === 'invalid_type') {
    const received = parseReceivedType(issue.message);
    if (received === 'undefined') {
      return { path, message: `${path} is required` };
    }
    return {
      path,
      message: `${path}: expected ${issue.expected}, got ${received}`,
    };
  }

  if (issue.code === 'unrecognized_keys') {
    // Report each unknown key as a separate issue path
    const keys = (issue as z.core.$ZodIssueUnrecognizedKeys).keys;
    const keyPath = keys.length === 1 ? `${path}.${keys[0]}` : path;
    return { path: keyPath, message: `${keyPath}: unknown field` };
  }

  // custom issues (semver, runtime format) carry their message directly
  return { path, message: `${path}: ${issue.message}` };
}

// ============================================================
// VALIDATE SLIM HARNESS
// ============================================================

/**
 * Parses and validates raw JSON against the SlimHarnessConfig zod schema.
 * Returns the validated config on success.
 * Throws ManifestValidationError with structured field paths on failure.
 */
export function validateSlimHarness(raw: unknown): SlimHarnessConfig {
  const result = slimHarnessConfigSchema.safeParse(raw);

  if (!result.success) {
    const issues: ManifestIssue[] = result.error.issues.map(
      zodIssueToManifestIssue
    );
    const firstPath = issues[0]?.path ?? 'manifest';
    const firstMessage = issues[0]?.message ?? 'manifest validation failed';
    throw new ManifestValidationError(firstMessage, issues, firstPath);
  }

  return result.data;
}
