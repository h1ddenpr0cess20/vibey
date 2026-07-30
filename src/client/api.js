async function json(path, options) {
  const res = await fetch(path, options);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `${path} returned ${res.status}`);
  return body;
}

export function fetchConfig() {
  return json('/api/config');
}

/** Every task this server has handed out, whether or not a call is up. */
export function fetchTasks() {
  return json('/api/tasks');
}

/** The connector setup: which agents exist, which are on, and how they run. */
export function fetchConnectors() {
  return json('/api/connectors');
}

export function saveConnectors(patch) {
  return json('/api/connectors', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

export function stopTask(id) {
  return json(`/api/tasks/${encodeURIComponent(id)}/stop`, { method: 'POST' });
}
