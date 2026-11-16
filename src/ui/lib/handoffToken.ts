/**
 * A handoff token from the old URL (#handoff=…, docs/DATA_CONTRACT.md「旧 URL からの引き継ぎ」). Taken out of the URL when this
 * module loads, before the router reads the URL (the router would put the fragment back), so the
 * token is not left in the history or shared by copying the address
 */
function takeHandoffToken(): string | null {
  if (typeof window === 'undefined') return null;
  const match = /^#handoff=([A-Za-z0-9_-]+)$/.exec(window.location.hash);
  if (!match) return null;
  history.replaceState(history.state, '', window.location.pathname + window.location.search);
  return match[1];
}

export const initialHandoffToken = takeHandoffToken();
