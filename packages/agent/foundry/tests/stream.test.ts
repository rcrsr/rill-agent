import { describe, expect, it } from 'vitest';
import { createFoundryStreamResponse } from '../src/stream.js';

// ============================================================
// CLOSE-BEFORE-COMPLETION TESTS
// ============================================================

describe('createFoundryStreamResponse — cancel before async completion', () => {
  it('does not enqueue after cancel when resultPromise later rejects, and does not leave an unhandled rejection', async () => {
    let rejectResult!: (err: unknown) => void;
    const resultPromise = new Promise<string>((_resolve, reject) => {
      rejectResult = reject;
    });

    const unhandled: unknown[] = [];
    const onUnhandledRejection = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandledRejection);

    const errors: unknown[] = [];
    let signalError!: () => void;
    const errorSeen = new Promise<void>((resolve) => {
      signalError = resolve;
    });

    const res = createFoundryStreamResponse('resp_cancel', {
      resultPromise,
      onError: (err) => {
        errors.push(err);
        signalError();
      },
    });

    const reader = res.body!.getReader();
    await reader.cancel();

    // Reject after the stream has already been cancelled/closed. The
    // pre-fix behavior called controller.enqueue()/close() on an already
    // closed controller here, throwing inside the `.catch` handler and
    // producing an unhandled rejection.
    rejectResult(new Error('late failure'));
    await errorSeen;

    // Drain microtasks so a same-tick unhandled rejection would surface.
    await Promise.resolve();
    await Promise.resolve();

    process.off('unhandledRejection', onUnhandledRejection);

    expect(errors).toHaveLength(1);
    expect(unhandled).toHaveLength(0);
  });

  it('does not enqueue after cancel when the chunk iterable later rejects', async () => {
    let failChunks!: (err: unknown) => void;
    const chunks: AsyncIterable<string> = {
      [Symbol.asyncIterator]() {
        return {
          next(): Promise<IteratorResult<string>> {
            return new Promise((_resolve, reject) => {
              failChunks = reject;
            });
          },
        };
      },
    };

    const unhandled: unknown[] = [];
    const onUnhandledRejection = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandledRejection);

    const errors: unknown[] = [];
    let signalError!: () => void;
    const errorSeen = new Promise<void>((resolve) => {
      signalError = resolve;
    });

    const res = createFoundryStreamResponse('resp_cancel_chunks', {
      chunks,
      onError: (err) => {
        errors.push(err);
        signalError();
      },
    });

    const reader = res.body!.getReader();
    await reader.cancel();

    failChunks(new Error('late chunk failure'));
    await errorSeen;

    await Promise.resolve();
    await Promise.resolve();

    process.off('unhandledRejection', onUnhandledRejection);

    expect(errors).toHaveLength(1);
    expect(unhandled).toHaveLength(0);
  });
});
