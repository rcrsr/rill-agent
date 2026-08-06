export interface HandlerDescription {
  readonly name: string;
  readonly description?: string | undefined;
  readonly params: ReadonlyArray<{
    readonly name: string;
    readonly type: string;
    readonly required: boolean;
    readonly description?: string | undefined;
    readonly defaultValue?: unknown;
  }>;
  /**
   * Handler return type annotation, formatted with the same grammar as
   * parameter type strings (e.g. `stream(dict(content: string)):string`).
   * Undefined when the handler closure has no `:T` annotation, or when the
   * rill-build emitting the handler is too old to expose the field.
   */
  readonly returnType?: string | undefined;
}

export interface InitContext {
  readonly globalVars?: Record<string, string> | undefined;
  readonly ahiResolver?:
    | ((agentName: string, request: RunRequest) => Promise<RunResponse>)
    | undefined;
}

export interface RunRequest {
  readonly params?: Record<string, unknown> | undefined;
  readonly timeout?: number | undefined;
}

export interface RunContext {
  readonly sessionVars?: Record<string, string> | undefined;
  readonly onLog?: ((message: string) => void) | undefined;
  readonly onChunk?: ((chunk: unknown) => Promise<void>) | undefined;
}

export interface RunResponse {
  readonly state: 'completed' | 'error';
  readonly result: unknown;
  readonly streamed?: boolean | undefined;
}

export interface AgentHandler {
  describe(): HandlerDescription | null;
  init(context?: InitContext): Promise<void>;
  execute(request?: RunRequest, context?: RunContext): Promise<RunResponse>;
  dispose(): Promise<void>;
}

export interface AgentManifest {
  readonly defaultAgent: string;
  readonly agents: ReadonlyMap<string, AgentHandler>;
}

export interface AgentRouter {
  readonly manifest: AgentManifest;
  run(
    agentName: string,
    request: RunRequest,
    context?: RunContext
  ): Promise<RunResponse>;
  describe(agentName: string): HandlerDescription | null;
  agents(): string[];
  defaultAgent(): string;
  dispose(): Promise<void>;
}
