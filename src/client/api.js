export async function fetchConfig() {
  const res = await fetch('/api/config');
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `/api/config returned ${res.status}`);
  return body;
}
