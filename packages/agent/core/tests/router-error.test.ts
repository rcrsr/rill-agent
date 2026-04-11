import { describe, expect, it } from 'vitest';

import { routerErrorToStatus } from '../src/router-error.js';

describe('routerErrorToStatus', () => {
  it("returns 404 for error with 'not found' message (EC-3)", () => {
    const err = new Error('Agent "foo" not found. Available: bar');

    const status = routerErrorToStatus(err);

    expect(status).toBe(404);
  });

  it('returns 500 for other Error instances (EC-4)', () => {
    const err = new Error('Internal processing failure');

    const status = routerErrorToStatus(err);

    expect(status).toBe(500);
  });

  it('returns 500 for non-Error inputs (EC-4)', () => {
    const status = routerErrorToStatus('something went wrong');

    expect(status).toBe(500);
  });
});
