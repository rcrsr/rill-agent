import type { AgentRouter } from './types.js';

export function validateParams(
  params: Record<string, unknown>,
  agentName: string,
  router: AgentRouter
): string | null {
  const desc = router.describe(agentName);
  if (desc === null) return null;

  for (const param of desc.params) {
    const value = params[param.name];
    if (param.required && (value === undefined || value === null)) {
      return `Missing required parameter: ${param.name}`;
    }
    if (value !== undefined && value !== null && param.type !== 'any') {
      const actual = typeof value;
      const expected = param.type === 'dict' ? 'object' : param.type;
      if (expected === 'list') {
        if (!Array.isArray(value)) {
          return `Parameter "${param.name}" must be a list, got ${actual}`;
        }
      } else if (expected === 'object') {
        if (actual !== 'object' || value === null || Array.isArray(value)) {
          return `Parameter "${param.name}" must be a dict, got ${Array.isArray(value) ? 'list' : actual}`;
        }
      } else if (actual !== expected) {
        return `Parameter "${param.name}" must be ${param.type}, got ${actual}`;
      }
    }
  }

  return null;
}
