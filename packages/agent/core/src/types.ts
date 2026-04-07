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
}

export interface RunResponse {
  readonly state: 'completed' | 'error';
  readonly result: unknown;
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
