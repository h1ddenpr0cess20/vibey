# Vibey

A voice orchestrator for vibe coding, rendered as a five-pointed star of glowing
goo. You describe what you're building out loud; Star reads the task back, holds
the thread, and tells you where things stand. It runs on an xAI Grok
speech-to-speech session, and the wobble, hop and squash are driven by the live
audio, so it moves with whichever of you is talking.

The surface is real geometry, not a shader trick on a billboard. A five-point
star profile is swept onto a sphere, flattened front to back, and then displaced
every frame by a sum of directional sine lobes — so the goo swells, the tips
soften, and the core slides around inside the shell it is lit through.

It can search the web and X, run code in xAI's sandbox, and call remote MCP
servers. It also remembers what you tell it to, between calls.

And it can hand the work over. With a connector switched on, Star writes the
task up, dispatches it to **Claude Code** or **Codex** running on this machine,
and tells you when it lands — while the call carries on.

## Run

```sh
npm install
cp .env.example .env      # add your XAI_API_KEY
npm run dev               # → http://localhost:5173
```

Click the mic, allow the browser's microphone prompt, and say what you're
building. Talk over it and it stops — and hops.

The mic button is a microphone switch, not a hang-up: turning it off stops what
you send and leaves the answer playing, and the conversation is still there when
you turn it back on. The mic also turns itself off after a minute of nothing
said, so it isn't hot on a call nobody is having — the call and everything said
on it survive that too.

| Script | |
|---|---|
| `npm run dev` | Vite, with the proxy mounted as middleware — one process |
| `npm run dev:lan` | The same, over HTTPS on the network — for a phone |
| `npm run build` | Bundles the client to `dist/` |
| `npm start` | Serves `dist/` with the same proxy in front |
| `npm run preview` | `build` then `start` |
| `npm run preview:lan` | `build` then `start`, over HTTPS on the network |
| `npm test` | `node:test`, against a stub xAI socket |
| `npm run lint` | ESLint |

CI runs the lint, the tests on Node 22.12 and 24, and a build that then has to
boot and serve itself over both HTTP and HTTPS.

## Configuration

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
| `CONNECTORS` | — | `claude`, `codex`, or both, on at first boot. After that the panel owns it — see [Connectors](#connectors) |
| `CONNECTOR_CWD` | where the server started | Starting value for the workspace |
| `CONNECTOR_TIMEOUT` | `900` | Seconds one task may run before it is stopped |
| `CONNECTOR_LIMIT` | `3` | Tasks running at once |
| `CONNECTOR_ANNOUNCE` | `true` | Star says so when a task settles, rather than waiting to be asked |
| `XAI_MCP_SERVERS` | — | JSON array of remote MCP servers, or put it in `mcp.json` |
| `PORT` | `5173` | |
| `SSL_KEY`, `SSL_CERT` | — | Paths to a real certificate; `npm start` then serves HTTPS |

### On a phone

```sh
npm run dev:lan           # → https://192.168.x.x:5173, printed on start
```

Microphone access needs a secure context. `localhost` is one; a LAN address over
plain HTTP is not — `navigator.mediaDevices` doesn't exist there, so the page
can't even raise the mic prompt. The `:lan` scripts serve HTTPS with a
self-signed certificate, and the realtime socket follows the page onto `wss:`.

No browser trusts that certificate, so the phone shows a warning the first time
("Advanced" → proceed on Chrome, "Show details" → "visit this website" on
Safari). Tap through it once per device. The certificate is cached in
`node_modules/.vite/` and shared by both `:lan` scripts.

To skip the warning, bring a certificate the device already trusts —
[mkcert](https://github.com/FiloSottile/mkcert) issues one for a LAN IP — and
point `SSL_KEY` and `SSL_CERT` at it. `npm start` then serves HTTPS without the
`--https` flag.

## Docker

```sh
docker run --rm -p 5173:5173 -e XAI_API_KEY=xai-... h1ddenpr0cess20/vibey
```

Images go to Docker Hub on every push to `main` (`latest`) and on `v*` tags
(`1.2.3`, `1.2`), built for `linux/amd64` and `linux/arm64`. Configuration is the
same set of variables as `.env` — pass them with `-e` or `--env-file .env`.

Connectors are not usable in the published image: the agent CLIs aren't in it,
and neither is your workspace. Running them from a container means an image of
your own with the CLI installed, the repo mounted at `CONNECTOR_CWD`, and
whatever each CLI reads its credentials from mounted too.

The container serves HTTP on `PORT` (5173 by default) and expects TLS to be
terminated in front of it. To serve TLS from the container instead, mount a
certificate and point `SSL_KEY` and `SSL_CERT` at it; the self-signed `--https`
path needs a devDependency that the production image doesn't carry.

To build it yourself:

```sh
docker build -t vibey .
```

Publishing from a fork needs a `DOCKERHUB_TOKEN` repository secret, plus a
`DOCKERHUB_USERNAME` repository variable if your Docker Hub account isn't
`h1ddenpr0cess20`.

## How the call is wired

Every frame of audio goes through the Node process:

```
browser  ──ws──▶  /realtime  ──ws──▶  wss://api.x.ai/v1/realtime
```

Unlike OpenAI's Realtime API, the browser can't dial xAI directly:

- **`/v1/realtime/client_secrets` takes no `session` field.** The token carries
  no configuration, so a page dialling xAI directly would have to send its own
  `session.update` — putting the persona, the tool list and any MCP
  `authorization` header in client code.
- **The token lasts five minutes**, and conversations routinely outlive that.

So the socket lives here and the page holds no credential. On connect the proxy
sends `session.update` — persona, voice, turn detection, audio format, tools —
before forwarding anything the page queued.

What the page may send upstream is an allowlist: audio frames, a typed message,
a request to respond, a cancel, and the output of a function call it ran itself.
Two things are dropped as persona overrides — a `session.update` from the
browser, and the `instructions` field on a `response.create`.
`test/server/realtime.test.js` covers that.

One frame type never reaches xAI at all: `session.memory`, which the page sends
with what it has stored. The proxy folds those lines into the instructions and
re-sends its own `session.update`, so the persona stays here and the memories
stay in the browser.

Two frames go the other way, authored by the proxy rather than forwarded:
`proxy.ready` when the handshake is done, and `task.update` whenever a
dispatched task changes state. With a connector on, the proxy also reads the
events it is passing through, so it can answer a `dispatch_task` itself and say
when one lands — a regex decides what is worth parsing, and the audio deltas,
which are most of the traffic, never are.

## Audio

A WebSocket carrying base64 PCM leaves both directions to the client.

**Up:** an `AudioWorklet` (`public/pcm-worklet.js`) takes the mic at whatever
rate the hardware gives, resamples to 24 kHz with linear interpolation, and
posts 20 ms PCM16 frames. The `sampleRate` option on `AudioContext` is only a
hint, so the conversion is done rather than requested.

**Down:** chunks arrive faster than real time, so each is booked against a
cursor running ahead of the clock rather than played as it lands. That cursor is
also what makes barge-in work — interrupting drops everything booked but not yet
heard.

Turn-taking is server-side VAD. `input_audio_buffer.speech_started` tells the
page to drop its queue; a `response.created` arriving while audio is still
playing flushes it too, as a backstop. `Escape` cancels for the typed path.

The worklet lives in `public/` rather than being imported, because Vite inlines
small assets as `data:text/javascript` URLs and `addModule()` rejects those on
Safari and under any CSP that disallows `data:`.

## History

Every completed turn is written to `localStorage` under `vibey.history.v1`, one
record per call, and the `log` button in the composer opens them newest first.
A settled task is a turn too — a third kind, alongside you and Star — so what a
coding agent actually said is in the log rather than only in the panel.
It is the only thing here that outlives the call: the session forgets a
conversation at teardown, and a redial starts one the new voice has no memory
of.

`new` starts a fresh conversation: it closes the record and, if a call is up,
dials again — the model's memory of what was said is the call itself, so a new
one is the only thing that clears it.

Nothing is uploaded. The log is in the browser that made the call, the proxy
never sees it, and `clear` — which asks once — removes it.

Storage is not assumed to work: private-mode Safari hands back a store that
throws on write, and the log falls back to memory for the life of the page
rather than failing the call. The last 40 conversations are kept, and the
oldest are shed to stay inside a 300 KB budget, since that space belongs to the
whole origin.

Old turns are not replayed into a new call. Reading them back to the model
would make the log a memory rather than a record, and `session.tools` has no
path for it that doesn't also let the page rewrite the persona.

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
and killed is not, which is what the connectors below are.

`remember` and `forget` run in the page. `dispatch_task`, `check_task` and
`cancel_task` run in the proxy. Everything else runs at xAI.

## Connectors

A connector is a coding agent this server may hand a task to. Two are wired:

| | Run as |
|---|---|
| **Claude Code** | `claude -p <task> --output-format json --permission-mode acceptEdits` |
| **Codex** | `codex exec --json --sandbox workspace-write <task>` |

Both are off until you switch one on, because both edit files on the machine the
server is running on. That happens in the **connectors** panel, not in a file:

```
connectors                                    save   close
  workspace  /home/you/the-repo    at once 3    time limit 900

  [on ] Claude Code                                   claude
        mode acceptEdits   model —   workspace —

  [off] Codex                                          codex
        mode workspace-write   model —   workspace —
```

Switch an agent on, point the workspace at the repo you want worked on, pick how
much it is allowed to do, and save. It takes effect on the running server — mid
call, without a redial — and is written to `connectors.json` (gitignored), so
the next boot opens the same way. An agent that is on appears in the picker next
to the voice, which is what a dispatch defaults to when the model doesn't name
one itself.

Each CLI has to be installed and already logged in — Vibey holds no credential
for either, and hands them none. The `XAI_API_KEY` is stripped out of the
environment the agents inherit; it is ours, and they have no use for it.

The same panel is where the work shows up: every task, newest first, with the
directory it is running in, what it was asked to do, how long it has been going,
what the agent said at the end, and a `stop` button while it is still running.
The tab counts what is in flight.

What an agent sends back also lands in the **log**, beside the conversation that
dispatched it — labelled with the agent and the task number, the task above it,
the whole reply below. That is the copy you can read at leisure: what Star says
out loud is a sentence about it.

Say what you want built. Star writes the task up, reads it back, and dispatches
it on a yes. `dispatch_task` returns a number as soon as the process is spawned
— the agent keeps working and the call carries on. When it settles, Star says
so, in a sentence, without being asked. `check_task` is the model asking where
one stands; `cancel_task` stops one, and Star will tell you that what it already
wrote is still written.

The tasks belong to the server, not to the call. Changing voice mid-session
redials, and the new call opens knowing what was dispatched before it — running
or finished — because that recap goes into the session prompt.

None of it touches the page. The proxy answers those three tools itself: the
browser never learns what command was run, and only ever sees a status. The
model doesn't see the command line either, or the agent's raw output beyond the
summary it printed at the end.

### From the environment

`.env` sets the defaults for a fresh machine — `CONNECTORS=claude,codex` starts
with those on — and owns the one thing the panel deliberately cannot touch:

### Per agent

| | |
|---|---|
| `CLAUDE_COMMAND`, `CODEX_COMMAND` | **Panel-proof.** A whole command line, so the CLI can be wrapped — `npx claude`, `docker exec -w /work dev codex`. The flags above are appended to it. Which binary this server executes is not something a browser gets to choose. |
| `CLAUDE_ARGS`, `CODEX_ARGS` | Anything else, split like a shell would. Also panel-proof. |
| `CONNECTOR_FILE` | Where the panel saves. `connectors.json` by default. |
| `CLAUDE_MODEL`, `CODEX_MODEL` | Starting value for the model field. |
| `CLAUDE_PERMISSION_MODE` | `plan`, `acceptEdits` (default), `bypassPermissions` — and the rest the CLI publishes. |
| `CODEX_SANDBOX` | `read-only`, `workspace-write` (default), `danger-full-access`. |
| `CLAUDE_CWD`, `CODEX_CWD` | A different workspace for that one agent. |

An agent switched on from the panel starts in the mode that lets it finish a
task inside the workspace and nothing wider. Both CLIs have a mode that turns
the rest of the guardrails off; the panel says so in red next to the choice, and
a voice interface is a poor place to be casual about which one is on.

Each CLI's machine-readable output has already changed shape at least once, so
the parsers take what they know — Claude's `result`, Codex's last
`agent_message` — and fall back to the tail of what was actually printed rather
than failing a task over a renamed field. A non-zero exit is a failure, and the
last of stderr rides back with it.

The workspace is resolved once, when the task is dispatched, and recorded on the
task itself — the panel and the log show where it ran rather than leaving you to
ask the agent, which answers from inside whatever sandbox it runs in. Codex is
handed it as `--cd` rather than by inheritance, and `PWD` is rewritten in the
child's environment, which `spawn` does not do on its own.

Star is told, in the prompt, that this edits real files: read the task back
before dispatching, get a plain yes for anything that doesn't come back, and
never claim work happened that it hasn't checked on.

**Anyone who can reach the page can spend your agent's tokens on your files.**
Vibey has no accounts and no auth — that's fine for `localhost`, and it is the
whole story before you put it on a LAN with connectors on.

## Memory

The log is a record. Memory is the part Star actually carries into the next
call: a short list of details, kept in `localStorage` under `vibey.memory.v1`
and appended to the persona as a labelled block when the call opens. For a build
session that is mostly the stack, the conventions you hold to, and how you want
to be talked to.

Ask it to remember something and it calls `remember`; ask it to forget it
and it calls `forget`, which drops every stored line matching the keyword. Both
run in the page against browser storage, and the result goes back up as a
`function_call_output`. The `memory` button opens the list, where you can add a
line by hand, drop one, switch the whole thing off, or clear it.

The list is capped at 50 lines, each flattened to one line and cut at 600
characters. Past the cap the oldest goes. Editing the list during a call
re-sends `session.memory`, so a memory added mid-conversation is live in it;
switching memory off empties the block on the next `session.update` without
deleting anything.

Nothing is uploaded and nothing is shared between browsers — the proxy holds no
memory of its own, and `MEMORY=false` removes both the tools and the prompt
block entirely.

Memories are text the person typed or dictated, so they land inside the prompt.
They are flattened onto one line each and capped in `persona.js` before they get
there, which keeps a memory from opening a new instruction paragraph, and the
persona is always first in the string.

## States

`idle` · `listening` · `thinking` · `speaking` — each a set of targets for
tremor, lean, rock, surface wobble, breath, palette drift, spin and glow. It
eases between them, so transitions read as a change of temperament rather than a
cut.

The call maps onto them directly: `listening` from `speech_started` and between
turns, `thinking` from `speech_stopped` until the first audio frame, `speaking`
while there is audio booked, `idle` when there is no call.

**Entering `thinking` throws it.** That's the beat: you stop talking, the star
goes up spinning, the colour races through the palette, and it comes down about
when the answer starts. `tossed` owns the mood for as long as it is in the air,
whatever the conversation is doing.

`stalled` is what a broken API looks like — a failed dial, a proxy that isn't
running, a missing key, an error mid-call. The light goes out, the colour drains
to grey, the goo stops moving, and it stays that way until something works
again. The caption says what broke.

The hop is ballistic — real gravity, real bounces, each one bleeding off spin —
and everything else is a damped spring reacting to a landing.

## Picking it up

Drag the star and you're holding it. It follows the cursor anywhere in frame and
pinwheels against its own direction of travel, so one drag across the stage turns
it a full revolution and a bit. There's no limit on that. Where it stops is where
it stays; the only thing it can't do is leave the frame.

Let go while it's still moving and you've thrown it. It flies, bounces, rolls out
and settles. A throw arriving from the conversation while you're holding it waits
in your hand and resolves when you release. While it's stalled you can move it
about, but it stays dark.

Dragging anywhere *other* than the star orbits the camera, unchanged. That
distinction is the point of `star/grab.js`: OrbitControls swings the camera
around a fixed point, which isn't the same as touching the star.

## Layout

```
Dockerfile              Build the client, then serve it from src/server
index.html              Markup only — Vite's entry
prototype/              Where the character came from, as a single-file page
public/
  pcm-worklet.js        Mic → 24 kHz PCM16, on the audio thread
src/
  client/
    main.js             The wiring, and nothing else
    styles.css          The HUD around the star
    api.js              The HTTP API, /api/connectors, /api/tasks
    tasks.js            What the agents are working on, mirrored in the page
    history.js          Past conversations, in localStorage
    memory.js           What it remembers between calls, in localStorage
    star/               Geometry and animation. Knows nothing about transports
      index.js            The controller, the throw, and the per-frame loop
      geometry.js         The star profile, the shell, the core and the glow
      grab.js             The pointer: pick it up, spin it, throw it
      moods.js            Targets per conversational state
      environment.js      Warm studio env map for the transmissive shell
    session/            The call. Emits transport-agnostic events
      index.js            Lifecycle: mic, socket, meter, tear down
      socket.js           The WebSocket to our own proxy
      audio.js            Capture and playback over Web Audio
      codec.js            PCM16 ↔ base64
      events.js           xAI server events → this vocabulary
      tools.js            remember/forget, run in the page
      metering.js         An analyser → one 0..1 number per frame
      emitter.js
      constants.js        The wire format, shared with the server
    ui/
      hud.js              Status chip, transcript, caption, tool label
      history.js          The log panel behind the `log` button
      memory.js           The memory panel behind the `memory` button
      connectors.js       Agent setup and the work, behind the `connectors` button
      controls.js         Mic, text field, send, pickers
      viewport.js         Keeps the composer above the on-screen keyboard
      stage.js            Strips the starter component's own chrome
    vendor/
      three-d-stage.js    Starter component (renderer, lighting, camera, controls)
  server/
    index.js            Entry point
    app.js              Middleware chain + the upgrade handler
    api.js              /api/config
    realtime.js         The socket proxy, and the allowlist
    persona.js          Who Star is, and the session config
    config.js           The environment, resolved once
    static.js           Hosting for dist/ — production only
    connectors/         The coding agents, and the work handed to them
      index.js            The three tools, and the tasks behind them
      agents.js           Claude Code and Codex, as command lines and parsers
      tasks.js            Spawn, watch, time out, kill
      tools.js            What the model is told it can dispatch
      settings.js         The setup the panel edits, validated and saved
docs/                   Policies: the output disclaimer, and what this is not
test/                   node:test, against a stub xAI socket
.github/workflows/      CI (lint, tests, build smoke test) and the Docker publish
```

`src/client/star/` is a single-file prototype split into modules; the original is
kept at `prototype/slime-star.html`. The split kept the prototype's numbers
verbatim — the star profile, the blur that rounds the tips, the lobes and the
palette are unchanged. What the app adds is who chooses the mood, the body
physics the prototype had no use for (squash, hop, throw, pick-up), and the
`stalled` mood.

Two things the shell needs that a static prototype didn't. Its bounding volumes
are set once, by hand, wide enough for the fattest wobble — the positions are
rewritten every frame and the bounds are never recomputed, so left alone three.js
would cache the undeformed hull and start missing the tips on a raycast. And the
halo sprites hang off the outer group rather than the body, so a squash lands on
the goo without stretching light that is meant to be in the air.

`src/client/vendor/three-d-stage.js` is a copied starter component with two local
changes, listed at the top of the file — re-copying it drops them.

The camera is the other thing the split changed. The framing is measured against
everything the star can do, hop included, rather than where it happens to be
sitting, and it refits on resize — which the starter component's one-shot
vertical framing doesn't do. It has to be measured rather than auto-fitted
anyway, because the wide halo sprite is nine units across and would otherwise
push the star into the middle distance.

## The transport seam

`session/index.js` exposes `on`, `start`, `stop`, `send`, `cancel`, `syncMemory`,
`messages`, `connected`, `busy`, `stale`, `state`, `muted`, `model`, `voice` —
and emits:

```
'state'        listening | thinking | speaking | idle
'caption'      the assistant transcript for this turn, in full
'user'         what the person said, in full
'level'        0..1 sustained amplitude, per frame
'pulse'        0..1 transient, one per discrete event
'interrupted'  the person talked over Star
'tool'         a label while a tool works, or null
'message'      a completed turn, { role, content } — what the log stores
'busy'         whether a response is in flight
'ready'        { model, voice } the proxy actually used
'memory'       the result of a remember/forget the model just called
'task'         a dispatched task changed state — { id, agent, status, … }
'agents'       the connector setup changed — which agents are on now
'done'         { usage }
'error'        { message }
```

Both transcript events carry the whole turn rather than an increment. xAI
renames OpenAI's `input_audio_transcription.delta` to `.updated` and makes it
cumulative, so appending it gives you "hello hello there hello there star".
`events.js` handles the two shapes apart — `.delta` appends, `.updated`
replaces.

Star takes audio-shaped input:

```js
star.setState('speaking')  // idle | listening | thinking | speaking
star.setLevel(0.62)        // sustained amplitude 0..1, sampled per frame
star.pulse(0.4)            // transient impulse 0..1, one per discrete event
star.spin()                // throw it up and set it spinning
star.jolt(0.9)             // talked over: it hops
star.stall(true)           // the API is unreachable — or, with false, it's back
```

Swapping providers means writing a different `createVoiceSession()` with that
surface. `main.js` and Star don't change.

## Policies

Two documents, both worth the two minutes:

- [**AI Output Disclaimer**](docs/ai-output-disclaimer.md) — what the model says
  is the model's, not the author's, plus the risks that are specific to a live
  microphone and speech you hear before anyone can check it.
- [**Not a Companion**](docs/not-a-companion.md) — Vibey is a tool and a demo.
  It is not a friend, a therapist, or a partner, and the project will not grow in
  that direction.
