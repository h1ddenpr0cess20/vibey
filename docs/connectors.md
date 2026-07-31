# Connectors

A connector is a coding agent this server may hand a task to. Four are wired:

| | Run as |
|---|---|
| **Claude Code** | `claude -p <task> --output-format json --permission-mode acceptEdits` |
| **Codex** | `codex exec --json --cd <workspace> --sandbox workspace-write <task>` |
| **OpenCode** | `opencode run --format json --dir <workspace> <task>` |
| **Grok Build** | `grok -p <task> --output-format json --cwd <workspace> --permission-mode acceptEdits` |

All are off until you switch one on, because all of them edit files on the
machine the server is running on. That happens in the **connectors** panel, not
in a file:

```
connectors                                    save   close
  workspace  /home/you/the-repo    at once 3    time limit 900

  [on ] Claude Code                                   claude
        mode acceptEdits   model —   workspace —

  [off] Codex                                          codex
        mode workspace-write   model —   workspace —

  [off] OpenCode                                    opencode
        mode default   model —   workspace —

  [off] Grok Build                                      grok
        mode acceptEdits   model —   workspace —
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

## The work

Say what you want built. Star writes the task up, reads it back, and dispatches
it on a yes. `dispatch_task` returns a number as soon as the process is spawned
— the agent keeps working and the call carries on. When it settles, Star says
so, in a sentence, without being asked. `check_task` is the model asking where
one stands; `cancel_task` stops one, and Star will tell you that what it already
wrote is still written.

The same panel is where the work shows up: every task, newest first, with the
directory it is running in, what it was asked to do, how long it has been going,
what the agent said at the end, and a `stop` button while it is still running.
The tab counts what is in flight.

What an agent sends back also lands in the **log**, beside the conversation that
dispatched it — labelled with the agent and the task number, the task above it,
the whole reply below. That is the copy you can read at leisure: what Star says
out loud is a sentence about it.

The tasks belong to the server, not to the call. Changing voice mid-session
redials, and the new call opens knowing what was dispatched before it — running
or finished — because that recap goes into the session prompt.

None of it touches the page. The proxy answers those three tools itself: the
browser never learns what command was run, and only ever sees a status. The
model doesn't see the command line either, or the agent's raw output beyond the
summary it printed at the end.

## From the environment

`.env` sets the defaults for a fresh machine — `CONNECTORS=claude,codex` starts
with those on — and owns the two things the panel deliberately cannot touch.
`<AGENT>` below is `CLAUDE`, `CODEX`, `OPENCODE` or `GROK`:

| | |
|---|---|
| `<AGENT>_COMMAND` | **Panel-proof.** A whole command line, so the CLI can be wrapped — `npx claude`, `docker exec -w /work dev codex`. The flags above are appended to it. Which binary this server executes is not something a browser gets to choose. |
| `<AGENT>_ARGS` | Anything else, split like a shell would. Also panel-proof. |
| `CONNECTOR_FILE` | Where the panel saves. `connectors.json` by default. |
| `<AGENT>_MODEL` | Starting value for the model field. OpenCode wants `provider/model`. |
| `CLAUDE_PERMISSION_MODE` | `plan`, `acceptEdits` (default), `bypassPermissions` — and the rest the CLI publishes. |
| `CODEX_SANDBOX` | `read-only`, `workspace-write` (default), `danger-full-access`. |
| `OPENCODE_PERMISSION_MODE` | `default`, or `auto` to approve what would otherwise be asked. |
| `GROK_PERMISSION_MODE` | `plan`, `default`, `acceptEdits` (default), `auto`, `dontAsk`, `bypassPermissions`. |
| `<AGENT>_CWD` | A different workspace for that one agent. |

An agent switched on from the panel starts in the mode that lets it finish a
task inside the workspace and nothing wider. Each CLI has a mode that turns the
rest of the guardrails off; the panel says so in red next to the choice, and a
voice interface is a poor place to be casual about which one is on. OpenCode is
the odd one out: its rules live in its own config rather than in a mode, and a
run that isn't interactive rejects whatever they leave open to ask — `auto` is
the flag that waves those through.

Each CLI's machine-readable output has already changed shape at least once, so
the parsers take what they know — Claude's `result`, Codex's last
`agent_message`, OpenCode's last text part, Grok's `text` — and fall back to the
tail of what was actually printed rather than failing a task over a renamed
field. A non-zero exit is a failure, and the last of stderr rides back with it.

The workspace is resolved once, when the task is dispatched, and recorded on the
task itself — the panel and the log show where it ran rather than leaving you to
ask the agent, which answers from inside whatever sandbox it runs in. The three
that take a directory flag are handed it that way — `--cd`, `--dir`, `--cwd` —
rather than by inheritance, and `PWD` is rewritten in the child's environment,
which `spawn` does not do on its own.

Star is told, in the prompt, that this edits real files: read the task back
before dispatching, get a plain yes for anything that doesn't come back, and
never claim work happened that it hasn't checked on.

**Anyone who can reach the page can spend your agent's tokens on your files.**
Vibey has no accounts and no auth, so who can reach it is the whole control:

- `npm start` binds to `127.0.0.1` unless `HOST` says otherwise, or it is
  serving TLS — which is the phone case, and the network by definition.
- Reaching it is not the same as being it. The connector API refuses anything
  that changes a setting if the browser says it came from another page, and the
  realtime socket refuses the handshake outright. Without that second check a
  page in an unrelated tab could open the call — WebSockets are outside the
  same-origin policy — put a sentence in your mouth and get an agent spawned on
  your files. Requests with no `Origin` at all are left alone: that is not a
  browser, and anything already running here needs no help from one.
- What is left is the network you put it on. On a LAN, everyone on it can reach
  the page, and the page is the whole authorisation story.

## In Docker

Connectors are not usable in the published image: the agent CLIs aren't in it,
and neither is your workspace. Running them from a container means an image of
your own with the CLI installed, the repo mounted at `CONNECTOR_CWD`, and
whatever each CLI reads its credentials from mounted too.
