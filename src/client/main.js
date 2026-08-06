import './styles.css';
import './vendor/three-d-stage.js';

import { fetchConfig } from './api.js';
import { createHistory } from './history.js';
import { createMemory } from './memory.js';
import { createStar } from './star/index.js';
import { createVoiceSession } from './session/index.js';
import { createToolSwitches } from './tools.js';
import { createTaskBoard } from './tasks.js';
import { createControls } from './ui/controls.js';
import { createHistoryPanel } from './ui/history.js';
import { createMemoryPanel } from './ui/memory.js';
import { createConnectorsPanel } from './ui/connectors.js';
import { createToolsPanel } from './ui/tools.js';
import { createHud } from './ui/hud.js';
import { stripStageChrome } from './ui/stage.js';
import { trackKeyboardInset } from './ui/viewport.js';

const stage = stripStageChrome(document.querySelector('three-d-stage'));

const { THREE } = await stage.ready;

const star = createStar({ stage, THREE });
const memory = createMemory();
const switches = createToolSwitches();
const session = createVoiceSession({ memory, switches });
const hud = createHud();
const history = createHistory();
const historyPanel = createHistoryPanel({
  history,
  onNew: startFresh,
  onResume: pickUp,
  /** Turns that have been deleted are not context: the next dial must not hand
   *  over the conversation the log was just cleared of. */
  onClear: () => { session.context = []; },
});
const memoryPanel = createMemoryPanel({
  memory,
  onChange: () => {
    session.syncMemory();
    paintTools();
  },
});
const toolsPanel = createToolsPanel({
  switches,
  onChange: () => {
    session.syncTools();
    paintTools();
  },
});
const board = createTaskBoard();
const connectorsPanel = createConnectorsPanel({
  board,
  /** Switching an agent on in the panel fills the picker in the composer. */
  onAgents: (agents) => {
    const chosen = controls.setAgents(agents);
    session.agent = chosen;
  },
});

/** Whether the server has memory at all — the switch in the panel is local. */
let memoryTool = false;

/**
 * The chip under the composer: what Star can actually reach for, right now.
 * The agents come from the board rather than from the switches — they are the
 * connectors panel's to turn on, and they answer for the whole server.
 */
function paintTools() {
  hud.showTools([
    ...switches.labels,
    memoryTool && memory.enabled ? 'memory' : null,
    ...board.agents,
  ]);
}

board.subscribe(paintTools);

trackKeyboardInset();

const controls = createControls({
  getStatus: () => ({ connected: session.connected, busy: session.busy, muted: session.muted }),

  async onMicToggle() {
    if (session.connected) {
      session.muted = !session.muted;
      hud.setState(chipState());
      armIdleMute();
      return;
    }
    hud.setState('connecting');
    hud.clearCaption();
    /** A conversation picked up in the log is already open: this joins it. */
    if (!history.live) history.begin({ model: session.model, voice: session.voice });
    await session.start();
    if (session.stale) setTimeout(redial, 0);
  },

  /** Held down rather than tapped: end the call instead of muting it. */
  onHangUp() {
    session.stop();
  },

  onSubmit(text) {
    if (!session.connected) return;
    hud.showUser(text);
    hud.clearCaption();
    session.send(text);
  },

  onModelChange(model) {
    session.model = model;
    redial();
  },

  onVoiceChange(voice) {
    session.voice = voice;
    redial();
  },

  onAgentChange(agent) {
    session.agent = agent;
  },

  onCancel() {
    if (toolsPanel.isOpen) return toolsPanel.close();
    if (memoryPanel.isOpen) return memoryPanel.close();
    if (historyPanel.isOpen) return historyPanel.close();
    if (connectorsPanel.isOpen) return connectorsPanel.close();
    session.cancel();
  },
});

const IDLE_MUTE_MS = 60_000;
let idle = 0;

function armIdleMute() {
  clearTimeout(idle);
  idle = 0;
  if (!session.connected || session.muted) return;
  if (session.busy || session.state === 'thinking' || session.state === 'speaking') return;
  idle = setTimeout(() => {
    if (!session.connected || session.muted) return;
    session.muted = true;
    hud.setState(chipState());
    controls.sync();
  }, IDLE_MUTE_MS);
}

function startFresh() {
  history.end();
  session.context = [];
  if (session.connected) redial();
}

/**
 * Carries on an old conversation. Whatever call is up ends first — this is a
 * different conversation, and the model is handed the stored turns as it dials
 * — and from here what is said lands back in that same entry in the log.
 */
async function pickUp(id) {
  if (session.connected) session.stop();
  const earlier = history.resume(id);
  if (!earlier) return;
  session.context = earlier.messages;
  await controls.toggleMic();
}

function chipState() {
  if (!session.connected || !session.muted) return star.state;
  return star.state === 'listening' || star.state === 'idle' ? 'muted' : star.state;
}

/**
 * A new call for the same conversation, after a pick or a stale one. Where the
 * conversation was picked up out of the log it stays picked up, turns and all,
 * including the ones from the call being replaced — a voice is worth changing
 * mid-sentence, and losing the thread over it is not.
 */
function redial() {
  if (!session.connected) return;
  const thread = session.context.length ? history.live : null;
  session.stop();
  if (thread) session.context = history.resume(thread)?.messages ?? [];
  controls.toggleMic();
}

session.on('state', (state) => {
  if (state === 'idle') {
    history.end();
    hud.hideUser();
  }
  if (state !== 'idle') star.stall(false);
  if (state === 'thinking') hud.clearCaption();
  if (state === 'listening' || state === 'idle') hud.setTool(null);
  star.setState(state);
  hud.setState(chipState());
  armIdleMute();
  controls.sync();
});

session.on('busy', () => {
  armIdleMute();
  controls.sync();
});

session.on('level', (level) => star.setLevel(level));
session.on('pulse', (weight) => star.pulse(weight));
session.on('caption', (text) => {
  hud.setCaption(text);
  armIdleMute();
});
session.on('user', (text) => {
  hud.showUser(text);
  armIdleMute();
});
session.on('tool', (label) => hud.setTool(label));

/** Dispatched work outlives the call it came from, so the board is never cleared. */
session.on('task', (task, replay) => {
  board.apply(task);
  /** A redial replays every task the server still holds, to refill the board.
   *  Logging those again would copy the whole session into the log each time. */
  if (replay || task.status === 'running') return;

  /** What the agent sent back belongs in the log, beside the talk that sent it. */
  history.append({
    role: 'agent',
    agent: task.agent,
    taskId: task.id,
    status: task.status,
    task: task.task,
    content: task.error ? `${task.error}${task.summary ? `\n\n${task.summary}` : ''}` : task.summary,
  });
});

/** The setup changed — in this page's panel or another one's. */
session.on('agents', (agents) => {
  session.agent = controls.setAgents(agents);
  board.refresh().catch(() => {});
});

session.on('message', (message) => history.append(message));

session.on('interrupted', () => star.jolt(0.9));

session.on('error', ({ message }) => {
  star.stall(true);
  hud.showError(message);
  hud.setState(chipState());
  controls.sync();
});

try {
  const config = await fetchConfig();
  const chosen = controls.setCatalog(config);
  session.model = chosen.model;
  session.voice = chosen.voice;
  session.agent = chosen.agent;
  switches.setCatalog(config.switches);
  memoryTool = Boolean(config.tools.memory);
  paintTools();
  if (!config.ready) throw new Error('XAI_API_KEY is not set — nothing to dial with.');
} catch (err) {
  star.stall(true);
  controls.unavailable();
  hud.showError(`${err.message} — is the proxy running? (npm run dev)`);
}

/** What was dispatched before this page existed, and whether there is an agent at all. */
board.refresh().catch(() => {});

window.addEventListener('pagehide', () => session.stop());

controls.sync();

if (window.matchMedia('(pointer: fine)').matches) controls.focus();
