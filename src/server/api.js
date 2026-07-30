function sendJSON(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

export function createApiMiddleware(config) {
  return function api(req, res, next) {
    const path = req.url.split('?')[0];
    if (!path.startsWith('/api/')) return next();

    if (path === '/api/config' && req.method === 'GET') {
      return sendJSON(res, 200, {
        models: config.models,
        model: config.defaultModel,
        voices: config.voices,
        voice: config.defaultVoice,
        tools: {
          web_search: config.tools.webSearch,
          x_search: config.tools.xSearch,
          code_interpreter: config.tools.code,
          memory: config.tools.memory,
          connectors: [...config.tools.connectors],
          mcp: config.tools.mcpServers.map((s) => s.server_label),
        },
        ready: Boolean(config.apiKey),
      });
    }

    sendJSON(res, 404, { error: `no route for ${req.method} ${path}` });
  };
}
