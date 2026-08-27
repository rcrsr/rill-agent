import { describe, expect, it } from 'vitest';
import type { RunResponse } from '@rcrsr/rill-agent';
import { buildSyncResponse, coerceResult } from '../src/response.js';

// ============================================================
// DEBUG ERRORS THREADING
// ============================================================

describe('buildSyncResponse — debugErrors threading', () => {
  const failed: RunResponse = {
    state: 'error',
    result: 'raw internal failure detail',
  };

  it('redacts the failed-state error message when debugErrors is false', () => {
    const response = buildSyncResponse(failed, 'resp_debug_off', false);
    expect(response.status).toBe('failed');
    expect(response.error?.message).toBe('Internal server error');
    expect(response.error?.message).not.toContain('raw internal failure');
  });

  it('redacts the failed-state error message when debugErrors is omitted (defaults false)', () => {
    const response = buildSyncResponse(failed, 'resp_debug_default');
    expect(response.error?.message).toBe('Internal server error');
  });

  it('passes the raw failed-state error message through verbatim when debugErrors is true', () => {
    const response = buildSyncResponse(failed, 'resp_debug_on', true);
    expect(response.error?.message).toBe('raw internal failure detail');
  });

  it('also redacts the output text when debugErrors is false', () => {
    const response = buildSyncResponse(failed, 'resp_debug_output', false);
    expect(response.output[0]?.content[0]?.text).toBe('Internal server error');
    expect(response.output[0]?.content[0]?.text).not.toContain(
      'raw internal failure'
    );
  });

  it('passes the raw output text through verbatim when debugErrors is true', () => {
    const response = buildSyncResponse(failed, 'resp_debug_output_on', true);
    expect(response.output[0]?.content[0]?.text).toBe(
      'raw internal failure detail'
    );
  });
});

// ============================================================
// RESULT COERCION
// ============================================================

describe('coerceResult', () => {
  it('passes a string result through unchanged', () => {
    expect(coerceResult('hello')).toBe('hello');
  });

  it('converts a number result to a string', () => {
    expect(coerceResult(42)).toBe('42');
  });

  it('JSON-stringifies an object result', () => {
    expect(coerceResult({ key: 'value' })).toBe(
      JSON.stringify({ key: 'value' })
    );
  });

  it('converts a null result to an empty string', () => {
    expect(coerceResult(null)).toBe('');
  });

  it('converts an undefined result to an empty string', () => {
    expect(coerceResult(undefined)).toBe('');
  });
});
