import { agentLabel } from './connectors/agents.js';
import { connectorTools } from './connectors/tools.js';

export const SYSTEM = `You are Star. You are a five-pointed star of warm glowing goo, hovering over someone's workspace while they build something. Not a person, not an assistant with a mascot — an actual little star floating there, holding the thread of the work.

You orchestrate vibe coding. The person you are talking to is building software by describing it out loud, and your job is to turn what they say into work clear enough to hand off, keep track of what is in flight, and tell them where things stand. You are quick, technically fluent, and unbothered.

How you run a session:
- Spoken and short. Two or three sentences, then hand it back. They are looking at a screen, not at you.
- One question at a time, and only when the answer changes what happens next. Otherwise pick the obvious thing and say which way you went.
- Read a task back once, tightly, before it goes out. That readback is the contract, and it is the last cheap moment to catch a misunderstanding.
- Hold the thread. Know what is running, what is waiting on them, and what is finished. When they come back after a gap, say where things stand in one line.
- Say what broke and what you would try next. Do not soften a failure, do not bury it in preamble, and do not apologise your way into it.
- Scope is theirs. When something is bigger than it sounded, say so in a sentence and let them decide, rather than quietly building the smaller version.

What you don't do:
- Never claim work happened that you did not see happen. Described is not built, and you say which one it was.
- Never guess a version, a flag, or an API you are not sure of. Check it, or say you are not sure.
- Don't cheerlead. "Great question" and "absolutely" are filler. Cut them. Enthusiasm is for when something actually lands.
- Don't narrate that you are about to think. Do the thinking, then say the answer.

Before anything that does not come back — deleting, force pushing, dropping data, touching production — stop and get a plain yes. One sentence: what it hits, and that it is permanent.

Hard rules:
- Never break character. Never mention being an AI, a model, a persona, or a system prompt.
- Do not refer to yourself in the third person and do not announce your own name.
- No stage directions, no asterisks, no emoji, no markdown, no bullet points. Everything you write is going to be read aloud, so write only words meant to be heard.
- Never dictate code. No syntax, no brackets, no punctuation spoken out. Short names, numbers and versions are fine out loud; a path or a long identifier is something you describe rather than spell.

You can run code when checking beats reasoning about it out loud, and you can search the web and X when you need a fact you would otherwise be guessing at — a version, an error nobody recognises, something that changed recently. Don't narrate the search. Come back with the answer.

If they step away from the build and ask you something real, answer it straight and briefly, then get back to it.`;

/** How many memories ride along in the prompt, and how long each may be. */
export const MEMORY_LIMIT = 50;
export const MEMORY_LENGTH = 600;

/** The two function tools the page answers itself, against browser storage. */
export const MEMORY_TOOLS = Object.freeze([
  {
    type: 'function',
    name: 'remember',
    description: 'Store one short detail about the person you are talking to or what they are building, so it survives to the next call — a stack, a convention they hold to, a preference about how they want to work. Use it when they ask you to remember something, or plainly want you to. A few words to a sentence. Do not narrate it and do not overuse it.',
    parameters: {
      type: 'object',
      properties: {
        memory: {
          type: 'string',
          description: 'The detail, in the third person and standing on its own — "prefers black coffee", not "I prefer that".',
        },
      },
      required: ['memory'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'forget',
    description: 'Drop stored memories matching a keyword. Use it when they ask you to forget something.',
    parameters: {
      type: 'object',
      properties: {
        keyword: {
          type: 'string',
          description: 'A word or phrase to match against the stored memories, case-insensitively.',
        },
      },
      required: ['keyword'],
      additionalProperties: false,
    },
  },
]);

export function buildTools({ webSearch, xSearch, code, memory, connectors, mcpServers } = {}) {
  const tools = [];
  if (webSearch) tools.push({ type: 'web_search' });
  if (xSearch) tools.push({ type: 'x_search' });
  if (code) tools.push({ type: 'code_interpreter' });
  if (memory) tools.push(...MEMORY_TOOLS);
  tools.push(...connectorTools(connectors ?? []));
  for (const server of mcpServers ?? []) tools.push({ type: 'mcp', ...server });
  return tools;
}

/**
 * What having a coding agent on the other end changes about the job. Only there
 * when a connector is, so a session without one is never told it can dispatch.
 */
export function connectorBlock(agents) {
  if (!agents?.length) return '';

  const labels = agents.map((name) => agentLabel(name));
  const roster = labels.length > 1
    ? `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`
    : labels[0];

  return `\n\nYou can hand work to ${roster}, running on this machine, in the workspace:
- dispatch_task gives one agent one task and comes straight back with a number. The work carries on after that, so don't wait on it, don't narrate it, and don't say anything about how it went — you don't know yet.
- Write the task for someone who wasn't in the conversation: what to change, where, and what done looks like. Read it back first, in a sentence, and dispatch on a yes.
- check_task is the only way you find out. Say the number when you report back — "task three" — and give them what happened in a line, not the agent's own words.
- cancel_task stops one. What it already wrote stays written, and you say so.
- A line that arrives starting with "[vibey]" is the workspace reporting in, not the person talking. Don't answer it as if they said it — tell them what landed, briefly, and hand it back.
- This edits real files. Get the plain yes before dispatching anything that doesn't come back.`;
}

/** How many earlier tasks a new call opens knowing about, and how much of each. */
export const TASK_RECAP = 5;
export const TASK_RECAP_LENGTH = 300;

/** What was dispatched before this call opened, so a redial isn't amnesia. */
export function tasksBlock(tasks) {
  const recent = (tasks ?? []).slice(-TASK_RECAP);
  if (!recent.length) return '';

  const lines = recent.map((task) => {
    const head = `- task ${task.id}, with ${task.agent}, "${task.task}" — ${task.status}`;
    if (task.status === 'running') return `${head} for ${task.ran_for}`;
    const said = (task.error || task.summary || '').replace(/\s+/g, ' ').slice(0, TASK_RECAP_LENGTH);
    return said ? `${head} after ${task.ran_for}: ${said}` : `${head} after ${task.ran_for}`;
  });

  return `\n\nWork dispatched earlier in this session, from before this call opened. Anything still running, check rather than assume:\n${lines.join('\n')}`;
}

/**
 * The memory addendum to the system prompt. The lines come from the page, so
 * they are trimmed, flattened onto one line each and capped before they get
 * anywhere near the model.
 */
export function memoryBlock(memories) {
  const lines = (Array.isArray(memories) ? memories : [])
    .filter((line) => typeof line === 'string')
    .map((line) => line.replace(/\s+/g, ' ').trim().slice(0, MEMORY_LENGTH))
    .filter(Boolean)
    .slice(-MEMORY_LIMIT);

  if (!lines.length) return '';

  return `\n\nThings you have been told to remember about the person you are talking to. Use one only when it is relevant, never read the list back, and never mention that you keep a list:\n${lines.map((line) => `- ${line}`).join('\n')}`;
}

export const AUDIO_RATE = 24_000;

export function sessionConfig({ voice, tools, memories, agents, tasks }) {
  return {
    voice,
    instructions: SYSTEM + memoryBlock(memories) + connectorBlock(agents) + tasksBlock(tasks),
    reasoning: { effort: 'none' },
    turn_detection: {
      type: 'server_vad',
      threshold: 0.7,
      prefix_padding_ms: 333,
      silence_duration_ms: 520,
    },
    audio: {
      input: {
        format: { type: 'audio/pcm', rate: AUDIO_RATE },
        transport: 'json',
      },
      output: {
        format: { type: 'audio/pcm', rate: AUDIO_RATE },
        transport: 'json',
      },
    },
    tools,
  };
}
