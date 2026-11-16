/**
 * Checks for the JSON bodies of the API. Each route's parser (parseXxx) returns the value rebuilt
 * from the fields it knows, or undefined to answer invalid_request (lib/http.ts). Unknown fields are
 * dropped: the stored replay log, for one, holds only the fields of each action.
 */

/** A JSON object: not null, not an array */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A string of `min` to `max` UTF-16 code units (String.length) */
export function isStringOfLength(value: unknown, min: number, max: number): value is string {
  return typeof value === 'string' && value.length >= min && value.length <= max;
}

/** A safe integer from `min` to `max` (a larger number, such as 1e20, is refused rather than rounded) */
export function isIntegerIn(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}

/** Each item parsed by `parse`; undefined if `value` is not an array of `min` to `max` items or any item fails */
export function parseArray<T>(
  value: unknown, min: number, max: number, parse: (item: unknown) => T | undefined,
): T[] | undefined {
  if (!Array.isArray(value) || value.length < min || value.length > max) return undefined;
  const items: T[] = [];
  for (const item of value) {
    const parsed = parse(item);
    if (parsed === undefined) return undefined;
    items.push(parsed);
  }
  return items;
}
