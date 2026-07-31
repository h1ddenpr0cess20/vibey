/** How long the mic has to be held down before the tap becomes a hang-up. */
export const HANG_MS = 650;

export function createControls({
  root = document,
  getStatus,
  onMicToggle,
  onHangUp,
  onSubmit,
  onModelChange,
  onVoiceChange,
  onAgentChange,
  onCancel,
  hangMs = HANG_MS,
}) {
  const composerEl = root.querySelector('#composer');
  const promptEl = root.querySelector('#prompt');
  const modelEl = root.querySelector('#model');
  const voiceEl = root.querySelector('#voice');
  const agentEl = root.querySelector('#agent');
  const sendEl = root.querySelector('#send');
  const micEl = root.querySelector('#mic');

  function sync() {
    const { connected, busy, muted } = getStatus();
    const live = connected && !muted;
    micEl.setAttribute('aria-pressed', String(live));
    micEl.setAttribute('aria-label', !connected
      ? 'Start talking'
      : `${live ? 'Turn the microphone off' : 'Turn the microphone on'}. Hold to hang up.`);
    micEl.title = connected ? 'Hold to hang up' : '';
    micEl.classList.toggle('muted', connected && !live);
    promptEl.disabled = !connected;
    promptEl.placeholder = connected ? 'Or type. The table waits.' : 'Tap the mic. Tell it what you do.';
    sendEl.disabled = !connected || busy;
  }

  async function toggleMic() {
    if ('busy' in micEl.dataset) return;
    micEl.dataset.busy = '';
    try {
      await onMicToggle();
    } finally {
      delete micEl.dataset.busy;
      sync();
    }
  }

  /**
   * The agent picker appears with the agents: switching one on in the panel
   * fills it, switching the last one off takes it away again. Keeping the
   * current pick matters — it is what a dispatch defaults to.
   */
  function setAgents(agents = []) {
    const had = agentEl.value;
    agentEl.hidden = !agents.length;
    agentEl.replaceChildren(...agents.map((id) => new Option(id, id)));
    agentEl.value = agents.includes(had) ? had : agents[0] ?? '';
    return agentEl.value;
  }

  /**
   * One button, two jobs. A tap is the microphone switch it always was; holding
   * it down hangs the call up, which is the only other thing anyone wants from
   * it and had nowhere to live. The hold only means anything while a call is up
   * — with none there is nothing to end, and the tap is what starts one.
   *
   * The click that closes a press still arrives after the hold has fired, and
   * would toggle the mute of a call that is already gone, so it is swallowed.
   */
  let holding = 0;
  let hung = false;

  /** The ring that closes while it is held is timed from here, not the sheet. */
  micEl.style.setProperty('--hang', `${hangMs}ms`);

  function hold() {
    hung = false;
    if (holding || micEl.disabled || 'busy' in micEl.dataset || !getStatus().connected) return;
    micEl.classList.add('holding');
    holding = setTimeout(() => {
      release();
      hung = true;
      onHangUp?.();
      sync();
    }, hangMs);
  }

  function release() {
    clearTimeout(holding);
    holding = 0;
    micEl.classList.remove('holding');
  }

  micEl.addEventListener('click', () => {
    if (hung) {
      hung = false;
      return;
    }
    toggleMic();
  });

  /** The primary button only: a right-click opens a menu, it does not hang up. */
  micEl.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    hold();
  });
  micEl.addEventListener('pointerup', release);
  micEl.addEventListener('pointercancel', release);
  micEl.addEventListener('pointerleave', release);

  /**
   * Held down from the keyboard too. Space is the one key that can carry it: a
   * button pressed with Space clicks on the way up, so a long one is a hold,
   * where Enter clicks on the way down and is only ever a tap.
   */
  micEl.addEventListener('keydown', (e) => {
    if (e.key !== ' ' || e.repeat) return;
    hold();
  });
  micEl.addEventListener('keyup', release);
  micEl.addEventListener('blur', release);

  composerEl.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = promptEl.value;
    if (!text.trim()) return;
    promptEl.value = '';
    onSubmit(text);
  });

  modelEl.addEventListener('change', () => onModelChange(modelEl.value));
  voiceEl.addEventListener('change', () => onVoiceChange(voiceEl.value));
  agentEl.addEventListener('change', () => onAgentChange?.(agentEl.value));

  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') onCancel();
  });

  return {
    sync,
    toggleMic,
    focus: () => micEl.focus(),

    setCatalog({ models, model, voices, voice, tools }) {
      modelEl.replaceChildren(...models.map((id) => new Option(id, id)));
      modelEl.value = models.includes(model) ? model : models[0];

      voiceEl.replaceChildren(...voices.map((v) => new Option(v, v)));
      voiceEl.value = voices.includes(voice) ? voice : voices[0];

      return {
        model: modelEl.value,
        voice: voiceEl.value,
        agent: setAgents(tools?.connectors ?? []),
      };
    },

    setAgents,

    unavailable() {
      modelEl.replaceChildren(new Option('unavailable', ''));
      voiceEl.replaceChildren(new Option('—', ''));
      agentEl.hidden = true;
      micEl.disabled = true;
    },
  };
}
