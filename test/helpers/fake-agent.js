/**
 * Stands in for `claude` and `codex` — same flags, same output shapes, no
 * model behind it. Which one it is playing comes first on the command line,
 * and what it does comes from the task text itself:
 *
 *   ...fail     writes to stderr and exits non-zero
 *   ...sleep    stays up until it is killed
 *   ...quiet    exits cleanly having said nothing
 */
const [shape, ...argv] = process.argv.slice(2);

const task = shape === 'claude' ? argv[argv.indexOf('-p') + 1] : argv[argv.length - 1];

if (/\bfail\b/.test(task)) {
  process.stderr.write('the build is on fire\n');
  process.exit(3);
}

if (/\bsleep\b/.test(task)) {
  setInterval(() => {}, 1000);
} else if (/\bquiet\b/.test(task)) {
  process.exit(0);
} else if (shape === 'claude') {
  process.stdout.write(`${JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    num_turns: 2,
    session_id: 'fake-session',
    result: `claude did: ${task}`,
  })}\n`);
} else {
  const lines = [
    { type: 'thread.started', thread_id: 'fake-thread' },
    { type: 'item.completed', item: { type: 'reasoning', text: 'thinking about it' } },
    { type: 'item.completed', item: { type: 'agent_message', text: `codex did: ${task}` } },
    { type: 'turn.completed', usage: { input_tokens: 12, output_tokens: 34 } },
  ];
  process.stdout.write(`${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);
}
