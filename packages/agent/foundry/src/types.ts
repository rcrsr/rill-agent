// ============================================================
// INBOUND REQUEST TYPES
// ============================================================

/**
 * A single text part within a user message content array.
 */
export interface ContentPart {
  readonly type: 'input_text';
  readonly text: string;
}

/**
 * A user message input item.
 */
export interface UserMessageItem {
  readonly type: 'message';
  readonly role: 'user';
  readonly content: string | ContentPart[];
}

/**
 * A function call output input item (tool result).
 */
export interface FunctionCallOutputItem {
  readonly type: 'function_call_output';
  readonly call_id: string;
  readonly output: string;
}

/**
 * A function call item (paired with function_call_output).
 */
export interface FunctionCallItem {
  readonly type: 'function_call';
  readonly call_id: string;
  readonly name: string;
  readonly arguments: string;
}

/**
 * Discriminated union of all input item variants.
 */
export type InputItem =
  | UserMessageItem
  | FunctionCallOutputItem
  | FunctionCallItem;

/**
 * Tool definition included in a CreateResponse request.
 */
export interface ToolDefinition {
  readonly type: 'function';
  readonly name: string;
  readonly description?: string | undefined;
}

/**
 * Inbound request body for the Foundry Responses endpoint.
 * Maps to the Azure AI Foundry CreateResponse API.
 */
export interface CreateResponse {
  readonly input: string | InputItem[];
  readonly stream?: boolean | undefined;
  readonly conversation?: string | { id: string } | undefined;
  readonly store?: boolean | undefined;
  readonly model?: string | undefined;
  readonly instructions?: string | undefined;
  readonly temperature?: number | undefined;
  readonly user?: string | undefined;
  readonly metadata?: Record<string, string> | undefined;
  readonly tools?: ToolDefinition[] | undefined;
}

// ============================================================
// OUTBOUND RESPONSE TYPES
// ============================================================

/**
 * A single text part in an output message content array.
 */
export interface OutputContentPart {
  readonly type: 'text';
  readonly text: string;
  readonly annotations: [];
}

/**
 * A single output message item in a FoundryResponse.
 */
export interface OutputItem {
  readonly id: string;
  readonly type: 'message';
  readonly role: 'assistant';
  readonly status: 'completed';
  readonly content: OutputContentPart[];
}

/**
 * Synchronous response body returned by the Foundry Responses endpoint.
 */
export interface FoundryResponse {
  readonly id: string;
  readonly object: 'response';
  readonly created_at: number;
  readonly status: 'completed' | 'failed';
  readonly output: OutputItem[];
  readonly error: { readonly code: string; readonly message: string } | null;
  readonly metadata: Record<string, string>;
  readonly temperature: number;
  readonly top_p: number;
  readonly user: string;
}

/**
 * Non-streaming error response body.
 */
export interface ErrorResponse {
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
}

/**
 * Streaming error event payload.
 */
export interface StreamErrorEvent {
  readonly type: 'error';
  readonly message: string;
}

// ============================================================
// TOOL DEFINITION TYPES
// ============================================================

/**
 * JSON Schema object used in tool parameter definitions.
 */
export interface JSONSchemaObject {
  readonly type: 'object';
  readonly properties: Record<string, JSONSchemaProperty>;
  readonly required?: string[] | undefined;
}

/**
 * A single property in a JSON Schema object.
 */
export interface JSONSchemaProperty {
  readonly type: string;
  readonly description?: string | undefined;
  readonly default?: unknown;
}

/**
 * A tool definition generated from an agent handler for the Foundry API.
 */
export interface FoundryToolDefinition {
  readonly type: 'function';
  readonly name: string;
  readonly description: string;
  readonly parameters: JSONSchemaObject;
  readonly strict: boolean;
}

// ============================================================
// METRICS TYPES
// ============================================================

/**
 * Runtime metrics for the Foundry harness.
 */
export interface FoundryMetrics {
  readonly activeSessions: number;
  readonly totalRequests: number;
  readonly errorCount: number;
}

// ============================================================
// HARNESS OPTIONS
// ============================================================

/**
 * Options accepted by createFoundryHarness.
 * All values default from environment variables.
 */
export interface FoundryHarnessOptions {
  readonly port?: number | undefined;
  readonly maxConcurrentSessions?: number | undefined;
  readonly agentName?: string | undefined;
  readonly agentVersion?: string | undefined;
  readonly debugErrors?: boolean | undefined;
  readonly forceSync?: boolean | undefined;
}
