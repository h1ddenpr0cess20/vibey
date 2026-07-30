import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';

import { AGENTS, splitArgs } from '../../src/server/connectors/agents.js';
import { connectorTools } from '../../src/server/connectors/tools.js';
import { loadConfig } from '../../src/server/config.js';
import { buildTools, connectorBlock, tasksBlock } from '../../src/server/persona.js';
import { startApp, settle } from '../helpers/app.js';
import { startXaiStub } from '../helpers/xai-stub.js';

const FAKE = fileURLToPath(new URL('../helpers/fake-agent.js', import.meta.url));

const wired = (extra = {}) => ({
  CONNECTORS: 'claude',
  CLAUDE_COMMAND: `node "${FAKE}" claude`,
  ...extra,
});

async function until(ok, ms = 8000) {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = ok();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('nothing arrived in time');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('which agents are connected', () => {
  it('is nobody unless CONNECTORS says otherwise', () => {
    const config = loadConfig({});
    assert.deepEqual(config.tools.connectors, []);
    assert.equal(buildTools(config.tools).some((t) => t.name === 'dispatch_task'), false);
  });

  it('takes the two it knows, in the order they were named', () => {
    const { tools, connectors } = loadConfig({ CONNECTORS: 'codex, claude' });
    assert.deepEqual(tools.connectors, ['codex', 'claude']);
    assert.deepEqual(Object.keys(connectors.agents), ['codex', 'claude']);
  });

  it('drops an agent it has never heard of rather than refusing to boot', () => {
    assert.deepEqual(loadConfig({ CONNECTORS: 'claude, cursor' }).tools.connectors, ['claude']);
    assert.deepEqual(loadConfig({ CONNECTORS: 'devin' }).tools.connectors, []);
  });

  it('defaults each agent to its own CLI and its safer mode', () => {
    const { connectors } = loadConfig({ CONNECTORS: 'claude, codex' });
    assert.deepEqual(connectors.agents.claude.command, ['claude']);
    assert.equal(connectors.agents.claude.mode, 'acceptEdits');
    assert.deepEqual(connectors.agents.codex.command, ['codex']);
    assert.equal(connectors.agents.codex.mode, 'workspace-write');
    assert.equal(connectors.timeoutMs, 900_000);
    assert.equal(connectors.limit, 3);
  });

  it('lets the command be a whole command line, so the CLI can be wrapped', () => {
    const { connectors } = loadConfig({
      CONNECTORS: 'codex',
      CODEX_COMMAND: 'docker exec -w "/work space" dev codex',
      CODEX_ARGS: '--skip-git-repo-check',
      CODEX_MODEL: 'gpt-5-codex',
    });
    assert.deepEqual(connectors.agents.codex.command,
      ['docker', 'exec', '-w', '/work space', 'dev', 'codex']);
    assert.deepEqual(connectors.agents.codex.extra, ['--skip-git-repo-check']);
    assert.equal(connectors.agents.codex.model, 'gpt-5-codex');
  });

  it('splits a command line the way a shell would, quotes included', () => {
    assert.deepEqual(splitArgs(''), []);
    assert.deepEqual(splitArgs(undefined), []);
    assert.deepEqual(splitArgs(`npx claude "two words" 'and more'`),
      ['npx', 'claude', 'two words', 'and more']);
  });
});

describe('the command each agent is given', () => {
  it('runs claude headless, with JSON back and a permission mode', () => {
    const args = AGENTS.claude.args({
      task: 'add a retry', model: 'opus', mode: 'acceptEdits', extra: ['--add-dir', '/tmp'],
    });
    assert.deepEqual(args, [
      '-p', 'add a retry',
      '--output-format', 'json',
      '--permission-mode', 'acceptEdits',
      '--model', 'opus',
      '--add-dir', '/tmp',
    ]);
  });

  it('runs codex through exec, with the task last', () => {
    const args = AGENTS.codex.args({
      task: 'add a retry', model: '', mode: 'workspace-write', extra: ['--skip-git-repo-check'],
    });
    assert.deepEqual(args, [
      'exec', '--json', '--sandbox', 'workspace-write', '--skip-git-repo-check', 'add a retry',
    ]);
  });
});

describe('reading what an agent printed', () => {
  it('takes claude’s result out of its JSON document', () => {
    const stdout = JSON.stringify({ type: 'result', is_error: false, result: 'four files changed' });
    assert.deepEqual(AGENTS.claude.parse(stdout, ''), { summary: 'four files changed' });
  });

  it('treats claude’s own error flag as a failure', () => {
    const stdout = JSON.stringify({ type: 'result', is_error: true, result: 'ran out of turns' });
    assert.deepEqual(AGENTS.claude.parse(stdout, ''), { error: 'ran out of turns' });
  });

  it('takes the last thing codex said out of its event stream', () => {
    const stdout = [
      '{"type":"item.completed","item":{"type":"reasoning","text":"hmm"}}',
      'a log line that is not JSON at all',
      '{"type":"item.completed","item":{"type":"agent_message","text":"tests pass"}}',
    ].join('\n');
    assert.deepEqual(AGENTS.codex.parse(stdout, ''), { summary: 'tests pass' });
  });

  it('reads the shapes codex has been through, not just the current one', () => {
    const older = '{"msg":{"type":"agent_message","message":"tests pass"}}';
    assert.deepEqual(AGENTS.codex.parse(older, ''), { summary: 'tests pass' });

    const typed = '{"type":"item.completed","item":{"item_type":"agent_message","text":"tests pass"}}';
    assert.deepEqual(AGENTS.codex.parse(typed, ''), { summary: 'tests pass' });
  });

  it('keeps the plain output when neither shape is there', () => {
    assert.deepEqual(AGENTS.claude.parse('done, I think\n', ''), { summary: 'done, I think' });
    assert.deepEqual(AGENTS.codex.parse('', 'no such model'), { summary: 'no such model' });
  });
});

describe('what the session is told', () => {
  it('says nothing about dispatching when nothing is connected', () => {
    assert.equal(connectorBlock([]), '');
    assert.equal(connectorBlock(undefined), '');
    assert.equal(tasksBlock([]), '');
  });

  it('names the agents it actually has, and what is already running', () => {
    assert.match(connectorBlock(['claude', 'codex']), /Claude Code and Codex/);
    assert.match(connectorBlock(['claude']), /dispatch_task/);

    const block = tasksBlock([
      { id: '1', agent: 'codex', status: 'running', task: 'add a retry', ran_for: '2m 0s' },
      { id: '2', agent: 'claude', status: 'done', task: 'fix the lint', ran_for: '30s', summary: 'one file' },
    ]);
    assert.match(block, /task 1, with codex, "add a retry" — running for 2m 0s/);
    assert.match(block, /task 2, with claude, "fix the lint" — done after 30s: one file/);
  });

  it('offers the three tools, and only the agents that are on', () => {
    const [dispatch, check, cancel] = connectorTools(['claude']);
    assert.deepEqual([dispatch.name, check.name, cancel.name],
      ['dispatch_task', 'check_task', 'cancel_task']);
    assert.deepEqual(dispatch.parameters.properties.agent.enum, ['claude']);
    assert.deepEqual(dispatch.parameters.required, ['task']);
    assert.deepEqual(cancel.parameters.required, ['id']);
    assert.deepEqual(connectorTools([]), []);
  });
});

describe('handing work over, end to end', () => {
  let xai;
  let app;
  let client;

  const outputs = () => xai.received()
    .filter((f) => f.type === 'conversation.item.create' && f.item?.type === 'function_call_output')
    .map((f) => ({ call_id: f.item.call_id, ...JSON.parse(f.item.output) }));

  const notes = () => xai.received()
    .filter((f) => f.type === 'conversation.item.create' && f.item?.type === 'message')
    .map((f) => f.item.content[0].text);

  const answerFor = (id) => until(() => outputs().find((o) => o.call_id === id));

  const callTool = (call_id, name, args) => xai.send({
    type: 'response.output_item.done',
    item: { type: 'function_call', call_id, name, arguments: JSON.stringify(args) },
  });

  before(async () => {
    xai = await startXaiStub();
    app = await startApp(wired({ XAI_REALTIME_URL: xai.address }));
    client = await app.openSocket();
    await client.waitFor('proxy.ready');
  });

  after(async () => {
    await app.close();
    await xai.close();
  });

  it('declares the tools and the block that explains them', () => {
    const [update] = xai.received();
    const named = update.session.tools.map((t) => t.name ?? t.type);
    assert.ok(named.includes('dispatch_task'), 'the model can dispatch');
    assert.match(update.session.instructions, /You can hand work to Claude Code/);
  });

  it('dispatches, answers the call at once, and tells the page', async () => {
    callTool('c1', 'dispatch_task', { task: 'add a retry' });

    const answer = await answerFor('c1');
    assert.equal(answer.ok, true);
    assert.equal(answer.id, '1');
    assert.equal(answer.agent, 'claude');
    assert.equal(answer.status, 'running');

    const update = await client.waitFor('task.update');
    assert.equal(update.task.id, '1');
    assert.equal(update.task.status, 'running');
  });

  it('reports back in the person’s place once the agent is done', async () => {
    const note = await until(() => notes().find((text) => /task 1/.test(text)));
    assert.match(note, /^\[vibey\]/);
    assert.match(note, /finished/);
    assert.match(note, /claude did: add a retry/);

    const at = xai.received().findIndex((f) => f.item?.content?.[0]?.text === note);
    assert.equal(xai.received()[at + 1].type, 'response.create', 'and asks for an answer');
  });

  it('has the whole story when it is asked for it', async () => {
    callTool('c2', 'check_task', { id: '1' });

    const answer = await answerFor('c2');
    assert.equal(answer.status, 'done');
    assert.match(answer.summary, /claude did: add a retry/);
    assert.match(answer.ran_for, /^\d+s$/);
  });

  it('says which task it is when there is no number', async () => {
    callTool('c3', 'check_task', {});

    const answer = await answerFor('c3');
    assert.deepEqual(answer.tasks.map((t) => t.id), ['1']);
  });

  it('calls a failed run a failure, and says what it printed', async () => {
    callTool('c4', 'dispatch_task', { task: 'make it fail' });
    await answerFor('c4');

    const note = await until(() => notes().find((text) => /task 2/.test(text)));
    assert.match(note, /failed/);
    assert.match(note, /the build is on fire/);
  });

  it('stops one that is still going, and keeps the number', async () => {
    callTool('c5', 'dispatch_task', { task: 'sleep on it' });
    const dispatched = await answerFor('c5');
    assert.equal(dispatched.status, 'running');

    callTool('c6', 'cancel_task', { id: dispatched.id });
    const cancelled = await answerFor('c6');
    assert.equal(cancelled.ok, true);

    const settled = await until(() => client.frames.find(
      (f) => f.type === 'task.update' && f.task.id === dispatched.id && f.task.status === 'cancelled',
    ));
    assert.match(settled.task.error, /stopped before it finished/);
  });

  it('refuses a number that was never handed out', async () => {
    callTool('c7', 'check_task', { id: '99' });
    const answer = await answerFor('c7');
    assert.equal(answer.ok, false);
    assert.match(answer.error, /no task 99/);

    callTool('c8', 'cancel_task', { id: '1' });
    const stale = await answerFor('c8');
    assert.equal(stale.ok, false);
    assert.match(stale.error, /already done/);
  });

  it('leaves the page’s own tools to the page', async () => {
    const before = outputs().length;
    callTool('c9', 'remember', { memory: 'drinks his coffee black' });
    await settle();
    assert.equal(outputs().length, before, 'the proxy answered nothing');
  });
});

describe('a task that outlives the call it came from', () => {
  let xai;
  let app;

  before(async () => {
    xai = await startXaiStub();
    app = await startApp(wired({ XAI_REALTIME_URL: xai.address }));
  });

  after(async () => {
    await app.close();
    await xai.close();
  });

  it('is still there, and in the prompt, when the next call opens', async () => {
    const first = await app.openSocket();
    await first.waitFor('proxy.ready');
    xai.send({
      type: 'response.output_item.done',
      item: {
        type: 'function_call',
        call_id: 'd1',
        name: 'dispatch_task',
        arguments: JSON.stringify({ task: 'sleep through the redial' }),
      },
    });
    await until(() => xai.received().some((f) => f.item?.type === 'function_call_output'));

    first.ws.close();
    await settle();

    const second = await app.openSocket();
    const replayed = await second.waitFor('task.update');
    assert.equal(replayed.task.status, 'running');

    const update = xai.received().findLast((f) => f.type === 'session.update');
    assert.match(update.session.instructions, /sleep through the redial/);
  });
});

describe('a task nobody stops', () => {
  it('is stopped for them, and says so', async () => {
    const xai = await startXaiStub();
    const app = await startApp(wired({ XAI_REALTIME_URL: xai.address, CONNECTOR_TIMEOUT: '0.4' }));
    try {
      const client = await app.openSocket();
      await client.waitFor('proxy.ready');
      xai.send({
        type: 'response.output_item.done',
        item: {
          type: 'function_call',
          call_id: 'e1',
          name: 'dispatch_task',
          arguments: JSON.stringify({ task: 'sleep forever' }),
        },
      });

      const settled = await until(() => client.frames.find(
        (f) => f.type === 'task.update' && f.task.status === 'timeout',
      ));
      assert.match(settled.task.error, /time limit/);
    } finally {
      await app.close();
      await xai.close();
    }
  });
});

describe('too much at once', () => {
  it('is turned down rather than queued', async () => {
    const xai = await startXaiStub();
    const app = await startApp(wired({ XAI_REALTIME_URL: xai.address, CONNECTOR_LIMIT: '1' }));
    try {
      const client = await app.openSocket();
      await client.waitFor('proxy.ready');

      const call = (id, task) => xai.send({
        type: 'response.output_item.done',
        item: { type: 'function_call', call_id: id, name: 'dispatch_task', arguments: JSON.stringify({ task }) },
      });

      call('f1', 'sleep on the first one');
      call('f2', 'sleep on the second one');

      const answers = await until(() => {
        const found = xai.received()
          .filter((f) => f.item?.type === 'function_call_output')
          .map((f) => JSON.parse(f.item.output));
        return found.length === 2 ? found : null;
      });

      assert.equal(answers[0].ok, true);
      assert.equal(answers[1].ok, false);
      assert.match(answers[1].error, /already running/);
    } finally {
      await app.close();
      await xai.close();
    }
  });
});
