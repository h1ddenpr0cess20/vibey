import './styles.css';
import './vendor/three-d-stage.js';

import { fetchConfig } from './api.js';
import { createHistory } from './history.js';
import { createMemory } from './memory.js';
import { createStar } from './star/index.js';
import { createVoiceSession } from './session/index.js';
import { createTaskBoard } from './tasks.js';
import { createControls } from './ui/controls.js';
import { createHistoryPanel } from './ui/history.js';
import { createMemoryPanel } from './ui/memory.js';
import { createConnectorsPanel } from './ui/connectors.js';
import { createHud } from './ui/hud.js';
import { stripStageChrome } from './ui/stage.js';
import { trackKeyboardInset } from './ui/viewport.js';

const stage = stripStageChrome(document.querySelector('three-d-stage'));

const { THREE } = await stage.ready;

const star = createStar({ stage, THREE });
const memory = createMemory();
const session = createVoiceSession({ memory });
const hud = createHud();
const history = createHistory();
const historyPanel = createHistoryPanel({ history, onNew: startFresh });
const memoryPanel = createMemoryPanel({ memory, onChange: () => session.syncMemory() });
const board = createTaskBoard();
const connectorsPanel = createConnectorsPanel({
  board,
  /** Switching an agent on in the panel fills the picker in the composer. */
  onAgents: (agents) => {
    const chosen = controls.setAgents(agents);
    session.agent = chosen;
  },
});

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
    history.begin({ model: session.model, voice: session.voice });
    await session.start();
    if (session.stale) setTimeout(redial, 0);
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
  if (session.connected) redial();
}

function chipState() {
  if (!session.connected || !session.muted) return star.state;
  return star.state === 'listening' || star.state === 'idle' ? 'muted' : star.state;
}

function redial() {
  if (!session.connected) return;
  session.stop();
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
  hud.showTools(config.tools);
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
