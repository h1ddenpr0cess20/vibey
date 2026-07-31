/**
 * Who is allowed to ask.
 *
 * Vibey has no accounts and no auth, which is defensible for something you run
 * on your own machine — right up until a page you happen to have open in
 * another tab asks on your behalf. A browser attaches `Origin` to exactly the
 * requests that carry that risk: cross-site form posts, `fetch` with a
 * content type simple enough to skip the preflight, and WebSocket handshakes,
 * which the same-origin policy does not cover at all.
 *
 * So: a request that names an origin has to name ours. A request with no
 * origin is not a browser — curl, a test, a native client — and is left alone,
 * because an attacker who can already set arbitrary headers on this machine
 * has no need of the browser in the first place.
 */
export function sameOrigin(req) {
  const origin = req.headers?.origin;
  if (!origin) return true;

  const host = req.headers.host;
  if (!host) return false;

  try {
    return new URL(origin).host === host;
  } catch {
    /** `null`, and anything else that isn't a URL, is not this one. */
    return false;
  }
}

/** Turn down a socket that asked to be upgraded from somewhere else. */
export function refuseUpgrade(socket) {
  socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
  socket.destroy();
}
