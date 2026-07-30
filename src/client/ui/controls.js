export function createControls({
  root = document,
  getStatus,
  onMicToggle,
  onSubmit,
  onModelChange,
  onVoiceChange,
  onCancel,
}) {
  const composerEl = root.querySelector('#composer');
  const promptEl = root.querySelector('#prompt');
  const modelEl = root.querySelector('#model');
  const voiceEl = root.querySelector('#voice');
  const sendEl = root.querySelector('#send');
  const micEl = root.querySelector('#mic');

  function sync() {
    const { connected, busy, muted } = getStatus();
    const live = connected && !muted;
    micEl.setAttribute('aria-pressed', String(live));
    micEl.setAttribute('aria-label',
      !connected ? 'Start talking' : live ? 'Turn the microphone off' : 'Turn the microphone on');
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

  micEl.addEventListener('click', toggleMic);

  composerEl.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = promptEl.value;
    if (!text.trim()) return;
    promptEl.value = '';
    onSubmit(text);
  });

  modelEl.addEventListener('change', () => onModelChange(modelEl.value));
  voiceEl.addEventListener('change', () => onVoiceChange(voiceEl.value));

  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') onCancel();
  });

  return {
    sync,
    toggleMic,
    focus: () => micEl.focus(),

    setCatalog({ models, model, voices, voice }) {
      modelEl.replaceChildren(...models.map((id) => new Option(id, id)));
      modelEl.value = models.includes(model) ? model : models[0];

      voiceEl.replaceChildren(...voices.map((v) => new Option(v, v)));
      voiceEl.value = voices.includes(voice) ? voice : voices[0];

      return { model: modelEl.value, voice: voiceEl.value };
    },

    unavailable() {
      modelEl.replaceChildren(new Option('unavailable', ''));
      voiceEl.replaceChildren(new Option('—', ''));
      micEl.disabled = true;
    },
  };
}
