import { describe, expect, it } from 'vitest';

import { AgentNotFoundError } from '../src/errors.js';
import { routerErrorToStatus } from '../src/router-error.js';

describe('routerErrorToStatus', () => {
  it('returns 404 for an AgentNotFoundError', () => {
    const err = new AgentNotFoundError('Agent "foo" not found. Available: bar');

    const status = routerErrorToStatus(err);

    expect(status).toBe(404);
  });

  it("returns 404 for a legacy plain error with the router's not-found shape", () => {
    const err = new Error('Agent "foo" not found. Available: bar');

    const status = routerErrorToStatus(err);

    expect(status).toBe(404);
  });

  it('does not misclassify an unrelated error whose message contains "not found"', () => {
    const err = new Error('Resource not found in cache');

    const status = routerErrorToStatus(err);

    expect(status).toBe(500);
  });

  it('returns 500 for other Error instances', () => {
    const err = new Error('Internal processing failure');

    const status = routerErrorToStatus(err);

    expect(status).toBe(500);
  });

  it('returns 500 for non-Error inputs', () => {
    const status = routerErrorToStatus('something went wrong');

    expect(status).toBe(500);
  });
});
