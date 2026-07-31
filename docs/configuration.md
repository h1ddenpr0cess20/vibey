# Configuration

Both `npm run dev` and `npm start` read `.env`.

| Variable | Default | Role |
|---|---|---|
| `XAI_API_KEY` | — | Required. Stays in the Node process. |
| `XAI_VOICE` | `sirius` | Any of the 26 voices xAI publishes — the full list is in `.env.example`. Any other voice id is honoured and added to the picker. |
| `XAI_MODEL` | `grok-voice-latest` | Also `grok-voice-think-fast-1.0` |
| `XAI_REALTIME_URL` | xAI | Points the proxy at a gateway or a stub |
| `XAI_WEB_SEARCH` | `true` | |
| `XAI_X_SEARCH` | `true` | |
| `XAI_CODE_INTERPRETER` | `true` | Python in xAI's sandbox |
| `MEMORY` | `true` | The `remember` and `forget` tools, and the memory block in the prompt |
| `CONNECTORS` | — | `claude`, `codex`, or both, on at first boot. After that the panel owns it — see [connectors](connectors.md) |
| `CONNECTOR_CWD` | where the server started | Starting value for the workspace |
| `CONNECTOR_TIMEOUT` | `900` | Seconds one task may run before it is stopped |
| `CONNECTOR_LIMIT` | `3` | Tasks running at once |
| `CONNECTOR_ANNOUNCE` | `true` | Star says so when a task settles, rather than waiting to be asked |
| `XAI_MCP_SERVERS` | — | JSON array of remote MCP servers, or put it in `mcp.json` |
| `PORT` | `5173` | |
| `SSL_KEY`, `SSL_CERT` | — | Paths to a real certificate; `npm start` then serves HTTPS |

The per-agent variables — command lines, models, permission modes, workspaces —
are in [connectors](connectors.md#from-the-environment).

## On a phone

```sh
npm run dev:lan           # → https://192.168.x.x:5173, printed on start
```

Microphone access needs a secure context. `localhost` is one; a LAN address over
plain HTTP is not — `navigator.mediaDevices` doesn't exist there, so the page
can't even raise the mic prompt. The `:lan` scripts serve HTTPS with a
self-signed certificate, cached in `node_modules/.vite/`, and the realtime
socket follows the page onto `wss:`.

No browser trusts that certificate, so the phone shows a warning the first time
("Advanced" → proceed on Chrome, "Show details" → "visit this website" on
Safari). Tap through it once per device. To skip it, point `SSL_KEY` and
`SSL_CERT` at a certificate the device already trusts —
[mkcert](https://github.com/FiloSottile/mkcert) issues one for a LAN IP.

Note that a LAN address is also a page other people on the network can reach,
and Vibey has no auth — see the warning in [connectors](connectors.md).

## Docker

```sh
docker run --rm -p 5173:5173 -e XAI_API_KEY=xai-... h1ddenpr0cess20/vibey
```

Images go to Docker Hub on every push to `main` (`latest`) and on `v*` tags
(`1.2.3`, `1.2`), for `linux/amd64` and `linux/arm64`. Configuration is the same
set of variables as `.env` — pass them with `-e` or `--env-file .env`.

The container serves HTTP on `PORT` and expects TLS to be terminated in front of
it; to serve TLS from the container, mount a certificate and set `SSL_KEY` and
`SSL_CERT`. Build it yourself with `docker build -t vibey .`. Publishing from a
fork needs a `DOCKERHUB_TOKEN` secret, plus a `DOCKERHUB_USERNAME` variable if
your Docker Hub account isn't `h1ddenpr0cess20`.

Connectors need [an image of your own](connectors.md#in-docker) — the published
one carries neither the agent CLIs nor your workspace.

## Tools

`web_search`, `x_search` and `code_interpreter` are on by default. All three
execute inside xAI, so there's nothing to implement here, no second credential
to hold, and no sandbox to run. The code interpreter is real Python on xAI's
side, which is how Star checks an answer instead of reasoning about it out loud
— useful when the thing in question is arithmetic, a regex, or a version
comparison that is quicker to run than to argue about. Star is told not to
narrate a tool call; the only sign one is running is the label under the status
chip.

Remote MCP servers go in `XAI_MCP_SERVERS` as a JSON array, or in `mcp.json`
(gitignored), and are also executed by xAI:

```json
[
  {
    "server_label": "orders",
    "server_url": "https://mcp.example.com/mcp",
    "server_description": "Order lookup",
    "allowed_tools": ["lookup_order"],
    "authorization": "Bearer ..."
  }
]
```

Credentials there never leave the Node process — `/api/config` reports tool
labels only. An MCP server that can open a branch or file a ticket is a config
entry rather than a code change; a coding agent that has to be spawned, watched
and killed is not, which is what the [connectors](connectors.md) are.

`remember` and `forget` run in the page. `dispatch_task`, `check_task` and
`cancel_task` run in the proxy. Everything else runs at xAI.

## The log and the memory

`log` opens past conversations, newest first. A settled task is a turn too — a
third kind, alongside you and Star — so what a coding agent actually said is in
the log rather than only in the panel. `new` closes the record and, if a call is
up, dials again — the model's memory of what was said is the call itself, so a
new call is the only thing that clears it. `clear` asks once, then removes the
log.

`memory` opens the short list of details Star carries between calls. For a build
session that is mostly the stack, the conventions you hold to, and how you want
to be talked to. Ask it to remember something and it calls `remember`; ask it to
forget it and it calls `forget`, which drops every stored line matching the
keyword. You can also add a line by hand, drop one, switch the whole thing off,
or clear it. `MEMORY=false` removes the tools and the prompt block for everyone
the server serves.

Both live in `localStorage`, in the browser that made the call. Nothing is
uploaded, and the proxy keeps no copy of either — see the
[design notes](design.md#storage) for the caps and the wire format.
