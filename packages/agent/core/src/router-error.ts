export function routerErrorToStatus(err: unknown): 404 | 500 {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes('not found')) {
    return 404;
  }
  return 500;
}
