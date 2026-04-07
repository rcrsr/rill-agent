import type { TokenCredential } from '@azure/identity';
import { CredentialError } from './errors.js';

// ============================================================
// TYPES
// ============================================================

export interface ConversationsClient {
  saveItems(
    conversationId: string,
    items: ReadonlyArray<unknown>
  ): Promise<void>;
}

// ============================================================
// ERRORS
// ============================================================

/**
 * Error thrown when the Conversations API returns a non-success status
 * or when a network timeout occurs.
 * Maps to HTTP 502. Error code: SERVER_ERROR.
 */
export class PersistenceError extends Error {
  readonly statusCode: 502;

  constructor(message: string) {
    super(message);
    this.name = 'PersistenceError';
    this.statusCode = 502;
  }
}

// ============================================================
// CONSTANTS
// ============================================================

const API_VERSION = '2025-11-15-preview';
const TOKEN_SCOPE = 'https://ai.azure.com/.default';
const REQUEST_TIMEOUT_MS = 30_000;

// ============================================================
// FACTORY
// ============================================================

/**
 * Create a client for the Azure AI Foundry Conversations API.
 *
 * Auth: DefaultAzureCredential with scope https://ai.azure.com/.default
 * API version: 2025-11-15-preview
 *
 * saveItems() throws PersistenceError on 4xx/5xx or network timeout.
 */
export function createConversationsClient(
  projectEndpoint: string,
  credential: TokenCredential
): ConversationsClient {
  return {
    async saveItems(
      conversationId: string,
      items: ReadonlyArray<unknown>
    ): Promise<void> {
      // Acquire token
      let token: string;
      try {
        const accessToken = await credential.getToken(TOKEN_SCOPE);
        if (accessToken === null) {
          throw new Error(`Failed to acquire token for scope ${TOKEN_SCOPE}`);
        }
        token = accessToken.token;
      } catch (err) {
        if (err instanceof CredentialError) {
          throw err;
        }
        const message = err instanceof Error ? err.message : String(err);
        throw new CredentialError(message);
      }

      const url = new URL(
        `${projectEndpoint}/openai/conversations/${conversationId}/items`
      );
      url.searchParams.set('api-version', API_VERSION);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      try {
        let response: Response;
        try {
          response = await fetch(url.toString(), {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ items }),
            signal: controller.signal,
          });
        } catch (err) {
          const isTimeout = err instanceof Error && err.name === 'AbortError';
          throw new PersistenceError(
            isTimeout
              ? 'Conversations API timeout'
              : `Conversations API error: ${err instanceof Error ? err.message : String(err)}`
          );
        }

        if (!response.ok) {
          throw new PersistenceError(
            `Conversations API error: ${response.status}`
          );
        }
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
