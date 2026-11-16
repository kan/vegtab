export function buildShareUrl(shareCode: string): string {
  return `${location.origin}/s/${shareCode}`;
}
