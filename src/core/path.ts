/**
 * Matching a URL path against a pattern, shared by the Worker's routes (src/worker/router.ts) and the
 * screen's (src/ui/lib/router.ts), so the API and the screen read paths by one rule:
 *
 * - The path and the pattern have the same number of `/` segments: `/api/scores/` is not `/api/scores`
 * - `:name` takes one non-empty segment, decoded (as it is when it is not valid percent-encoding)
 * - Any other segment matches itself
 */
export function matchPath(pattern: string, path: string): Record<string, string> | undefined {
  const parts = pattern.split('/');
  const segments = path.split('/');
  if (parts.length !== segments.length) return undefined;
  const params: Record<string, string> = {};
  for (let i = 0; i < parts.length; i++) {
    const segment = decodeSegment(segments[i]);
    if (parts[i].startsWith(':')) {
      if (segment === '') return undefined;
      params[parts[i].slice(1)] = segment;
    } else if (parts[i] !== segment) {
      return undefined;
    }
  }
  return params;
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
