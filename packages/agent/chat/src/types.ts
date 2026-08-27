import type { RunRequest, RunResponse } from '@rcrsr/rill-agent';
import type { Hono } from 'hono';

// ============================================================
// CHAT MESSAGE PRIMITIVES
// ============================================================

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  stream?: boolean | undefined;
}

// ============================================================
// STREAMING CHUNK TYPES
// ============================================================

export interface UsageMetadata {
  prompt_tokens?: number | undefined;
  completion_tokens?: number | undefined;
  total_tokens?: number | undefined;
}

export interface ChatDelta {
  role?: 'assistant' | undefined;
  content?: string | undefined;
}

export interface ChatChunk {
  id?: string | undefined;
  object?: 'chat.completion.chunk' | undefined;
  created?: number | undefined;
  model?: string | undefined;
  choices: [
    {
      index?: number | undefined;
      delta: ChatDelta;
      finish_reason?: 'stop' | 'length' | 'error' | null | undefined;
    },
  ];
  usage?: UsageMetadata | undefined;
  /** Present only on in-band error frames (finish_reason: 'error'). */
  error?: { message: string } | undefined;
}

/**
 * AHI resolver function — same shape as the resolver produced by createRouter
 * in @rcrsr/rill-agent. Defined here to avoid importing a runtime value for a
 * type-only position.
 */
export type AhiResolver = (
  agentName: string,
  request: RunRequest
) => Promise<RunResponse>;

// ============================================================
// HARNESS OPTIONS AND INTERFACE
// ============================================================

export interface ChatHarnessOptions {
  routes?:
    | {
        openai?: boolean | undefined;
        perAgent?: boolean | undefined;
        defaultAgent?: boolean | undefined;
        discovery?: boolean | undefined;
      }
    | undefined;
  cors?: boolean | undefined;
  port?: number | undefined;
}

export interface ChatHarness {
  listen(port?: number): Promise<void>;
  close(): Promise<void>;
  readonly app: Hono;
}
