// ============================================================
// PUBLIC INTERFACES
// ============================================================

export interface ResolveOptions {
  readonly manifestDir: string;
}

export interface ResolvedExtension {
  readonly alias: string;
  readonly namespace: string;
  readonly strategy: 'npm' | 'local' | 'builtin';
  readonly factory: import('@rcrsr/rill').ExtensionFactory<unknown>;
  readonly packageName: string;
  readonly mod: unknown;
  readonly resolvedVersion?: string | undefined;
  /** Absolute file path for local-strategy extensions. Used by builders to bundle the source. */
  readonly resolvedPath?: string | undefined;
}
