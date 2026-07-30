import './styles.css';
import './vendor/three-d-stage.js';

import { fetchConfig } from './api.js';
import { createHistory } from './history.js';
import { createMemory } from './memory.js';
import { createStar } from './star/index.js';
import { createVoiceSession } from './session/index.js';
import { createControls } from './ui/controls.js';
import { createHistoryPanel } from './ui/history.js';
import { createMemoryPanel } from './ui/memory.js';
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

  onCancel() {
    if (memoryPanel.isOpen) return memoryPanel.close();
    if (historyPanel.isOpen) return historyPanel.close();
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

/** Dispatched work outlives the call it was dispatched from, so this doesn't clear. */
const tasks = new Map();
session.on('task', (task) => {
  tasks.set(task.id, task);
  hud.setTasks([...tasks.values()]);
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
  hud.showTools(config.tools);
  if (!config.ready) throw new Error('XAI_API_KEY is not set — nothing to dial with.');
} catch (err) {
  star.stall(true);
  controls.unavailable();
  hud.showError(`${err.message} — is the proxy running? (npm run dev)`);
}

window.addEventListener('pagehide', () => session.stop());

controls.sync();

if (window.matchMedia('(pointer: fine)').matches) controls.focus();
