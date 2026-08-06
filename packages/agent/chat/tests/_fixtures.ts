import { vi } from 'vitest';
import type {
  AgentHandler,
  AgentManifest,
  AgentRouter,
  HandlerDescription,
  RunContext,
  RunRequest,
  RunResponse,
} from '@rcrsr/rill-agent';
import { createRouter } from '@rcrsr/rill-agent';
import { createChatHarness } from '../src/harness.js';
import type { ChatChunk } from '../src/types.js';

// ============================================================
// CHUNK
// ============================================================

/**
 * Minimal OpenAI-shaped chat chunk. Tests usually only care about content;
 * the role/finish_reason values match what the harness round-trips back.
 */
function makeChunk(content: string): ChatChunk {
  return {
    choices: [{ delta: { role: 'assistant', content }, finish_reason: 'stop' }],
  };
}

/**
 * OpenAI-shaped chat chunk representing an in-band stream error:
 * finish_reason 'error' paired with an error.message. Exercises the
 * buffered JSON path's checkChunkForError branch as well as the SSE path's
 * post-first-chunk error frame.
 */
export function makeErrorChunk(message: string): ChatChunk {
  return {
    choices: [{ index: 0, delta: {}, finish_reason: 'error' }],
    error: { message },
  };
}

// ============================================================
// HANDLERS
// ============================================================

export interface ChatHandlerOpts {
  /** Agent name reported by describe(). Default: "test". */
  name?: string;
  /**
   * Chunks emitted in order via context.onChunk before execute() resolves.
   * Default: a single makeChunk("hi"). Ignored when throwBefore is set.
   */
  chunks?: ChatChunk[];
  /**
   * Called synchronously at the top of execute() with the request and
   * context the harness passed in. Use to capture forwarded `messages`,
   * inspect onChunk, etc.
   */
  onInvoke?: (request: RunRequest, context: RunContext) => void;
  /**
   * When set, execute() throws this value before yielding any chunk —
   * exercises the harness's pre-first-chunk error path.
   */
  throwBefore?: unknown;
  /**
   * When set, execute() emits these chunks (via onChunk) then throws —
   * exercises the harness's post-first-chunk SSE error path.
   */
  throwAfter?: { chunks: ChatChunk[]; error: unknown };
  /**
   * Override the params reported by describe(). Default is the canonical
   * chat-eligible shape (`messages: list(dict(role: string, content: string))`).
   * Use `params: []` to produce a chat-INELIGIBLE handler (the harness
   * rejects describe() with no `messages` param).
   */
  params?: HandlerDescription['params'];
  /**
   * Override the return-type string reported by describe(). Default
   * `stream(dict):string`. Use empty string `''` to omit the field.
   */
  returnType?: string;
}

const CHAT_MESSAGES_PARAM: HandlerDescription['params'] = [
  {
    name: 'messages',
    type: 'list(dict(role: string, content: string))',
    required: true,
  },
];

/**
 * Construct an AgentHandler that satisfies the chat contract: declared
 * signature accepts `messages: list(dict(role: string, content: string))` and
 * the implementation streams chunks via `context.onChunk` during execute().
 */
export function makeChatHandler(opts: ChatHandlerOpts = {}): AgentHandler {
  const name = opts.name ?? 'test';
  const params = opts.params ?? CHAT_MESSAGES_PARAM;
  const returnType =
    opts.returnType ??
    'stream(dict(choices: list(dict(delta: dict(role: string, content: string), finish_reason: string)))):string';
  return {
    describe(): HandlerDescription | null {
      return {
        name,
        params,
        ...(returnType !== '' ? { returnType } : {}),
      };
    },
    async init() {},
    async execute(
      request?: RunRequest,
      context?: RunContext
    ): Promise<RunResponse> {
      opts.onInvoke?.(request ?? {}, context ?? {});
      if (opts.throwBefore !== undefined) {
        throw opts.throwBefore;
      }
      const chunks = opts.throwAfter
        ? opts.throwAfter.chunks
        : (opts.chunks ?? [makeChunk('hi')]);
      const onChunk = context?.onChunk;
      if (onChunk !== undefined) {
        for (const c of chunks) {
          await onChunk(c);
        }
      }
      if (opts.throwAfter !== undefined) {
        throw opts.throwAfter.error;
      }
      return {
        state: 'completed',
        result: null,
        streamed: onChunk !== undefined,
      };
    },
    async dispose() {},
  };
}

/**
 * Construct an AgentHandler whose declared describe() does NOT satisfy the
 * chat signature. Used to verify the harness's eligibility filtering.
 */
export function makeRpcHandler(name = 'rpc-only'): AgentHandler {
  return {
    describe(): HandlerDescription | null {
      return { name, params: [] };
    },
    async init() {},
    async execute(): Promise<RunResponse> {
      return { state: 'completed', result: null };
    },
    async dispose() {},
  };
}

// ============================================================
// ROUTER
// ============================================================

export interface RouterSpec {
  agents: Map<string, AgentHandler>;
  defaultAgent: string;
}

/**
 * Build a real AgentRouter via createRouter() — exercises the same
 * lifecycle the harness sees in production (manifest, init(), agents(),
 * defaultAgent(), router.manifest). Empty-agent specs are supported and
 * still produce a valid router with `defaultAgent` set to the empty string.
 */
export async function makeRouter(spec: RouterSpec): Promise<AgentRouter> {
  const manifest: AgentManifest = {
    defaultAgent: spec.defaultAgent,
    agents: spec.agents,
  };
  return createRouter(manifest);
}

// ============================================================
// HTTP HELPERS
// ============================================================

export const VALID_MESSAGES = [{ role: 'user' as const, content: 'hello' }];

export function jsonPost(body: unknown): {
  method: string;
  headers: Record<string, string>;
  body: string;
} {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

/**
 * Default request body for chat routes: a single user message plus any
 * overrides (e.g. `{ stream: true }`, `{ stream: false }`, or omitted
 * entirely to exercise the harness's default dispatch branch).
 */
export function defaultBody(overrides: Record<string, unknown> = {}): {
  method: string;
  headers: Record<string, string>;
  body: string;
} {
  return jsonPost({
    model: 't',
    messages: [{ role: 'user', content: 'hello' }],
    ...overrides,
  });
}

/**
 * Build a router whose default agent emits the given chunks via onChunk
 * during execute(). Most tests only care about the chunk sequence.
 */
export async function harnessFor(opts: {
  chunks?: ChatChunk[];
  throwBefore?: unknown;
  throwAfter?: { chunks: ChatChunk[]; error: unknown };
  onInvoke?: (
    request: Parameters<NonNullable<AgentHandler['execute']>>[0],
    context: Parameters<NonNullable<AgentHandler['execute']>>[1]
  ) => void;
}): Promise<ReturnType<typeof createChatHarness>> {
  const handler = makeChatHandler({
    name: 't',
    ...(opts.chunks !== undefined ? { chunks: opts.chunks } : {}),
    ...(opts.throwBefore !== undefined
      ? { throwBefore: opts.throwBefore }
      : {}),
    ...(opts.throwAfter !== undefined ? { throwAfter: opts.throwAfter } : {}),
    ...(opts.onInvoke !== undefined ? { onInvoke: opts.onInvoke } : {}),
  });
  const router = await makeRouter({
    agents: new Map<string, AgentHandler>([['t', handler]]),
    defaultAgent: 't',
  });
  return createChatHarness(router);
}

/**
 * Drain a Response body, returning the decoded UTF-8 string. The harness
 * keeps responses small enough that buffering the entire body is safe in
 * tests; production clients should stream.
 */
export async function readBody(res: Response): Promise<string> {
  if (res.body === null) return '';
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let out = '';
  let r = await reader.read();
  while (!r.done) {
    out += decoder.decode(r.value, { stream: true });
    r = await reader.read();
  }
  out += decoder.decode();
  return out;
}

/** Convenience: drop the leading `data: ` from each frame and split on \n\n. */
export function parseSseFrames(body: string): string[] {
  return body
    .split('\n\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// re-export vi so callers don't need a separate vitest import for spies
export { vi };
