'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const {
  createCoreAgentAdapter,
  createLocalOnlyFetch,
  createOriginLockedFetch,
  parseGitDiff,
  proposedChange
} = require('../src/agent/core-adapter.cjs');

async function loadCore() {
  const source = path.resolve(__dirname, '..', '..', '..', 'packages', 'agent-core', 'src', 'index.js');
  return import(pathToFileURL(source).href);
}

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '3aik-desktop-core-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'app.js'), 'const answer = 1;\n', 'utf8');
  return root;
}

function waitForTerminal(adapter, onEvent) {
  return new Promise((resolve) => {
    adapter.onEvent((event) => {
      if (onEvent) onEvent(event);
      if (['task.completed', 'task.cancelled', 'task.failed'].includes(event.type)) resolve(event);
    });
  });
}

function taskRequest(root) {
  return {
    projectRoot: root,
    prompt: 'Update the answer.',
    approvalMode: 'ask',
    model: {
      provider: '3aik-cloud',
      agentBaseUrl: 'https://3aik.com',
      deviceId: 'test-device'
    }
  };
}

test('startTask returns its task ID before a synchronous workspace setup failure is emitted', async (t) => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), '3aik-desktop-start-'));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const sensitiveRoot = path.join(parent, '.ssh');
  await fs.mkdir(sensitiveRoot);
  const adapter = await createCoreAgentAdapter({
    coreLoader: loadCore,
    clientFactory: () => ({ agentTurn: async () => ({ type: 'message', content: 'unused', model: 'test' }) })
  });
  let registeredTaskId = null;
  let registeredTaskIdAtFailure = null;
  const terminal = waitForTerminal(adapter, (event) => {
    if (event.type === 'task.failed') registeredTaskIdAtFailure = registeredTaskId;
  });

  const result = await adapter.startTask(taskRequest(sensitiveRoot));
  registeredTaskId = result.taskId;
  const failure = await terminal;

  assert.equal(failure.type, 'task.failed');
  assert.equal(failure.taskId, result.taskId);
  assert.equal(registeredTaskIdAtFailure, result.taskId);
  assert.match(failure.message, /secret or credential directory/i);
  await adapter.dispose();
});

test('denied approval leaves the project byte-for-byte unchanged', async (t) => {
  const root = await fixture(t);
  const before = await fs.readFile(path.join(root, 'app.js'));
  const turns = [
    {
      type: 'tool_calls',
      calls: [{
        id: 'patch-1',
        name: 'apply_patch',
        arguments: { path: 'app.js', patch: '@@ -1,1 +1,1 @@\n-const answer = 1;\n+const answer = 2;' }
      }],
      model: 'test'
    },
    { type: 'message', content: 'The requested change was declined.', model: 'test' }
  ];
  const adapter = await createCoreAgentAdapter({
    coreLoader: loadCore,
    clientFactory: () => ({ agentTurn: async () => turns.shift() })
  });
  let approvalSeen = false;
  let proposalSeen = false;
  const terminal = waitForTerminal(adapter, (event) => {
    if (event.type === 'diff.preview' && event.proposed) proposalSeen = true;
    if (event.type === 'approval.requested') {
      approvalSeen = true;
      void adapter.resolveApproval(event.approvalId, false);
    }
  });
  await adapter.startTask(taskRequest(root));
  const result = await terminal;
  assert.equal(result.type, 'task.completed');
  assert.equal(approvalSeen, true);
  assert.equal(proposalSeen, true);
  assert.deepEqual(await fs.readFile(path.join(root, 'app.js')), before);
  await adapter.dispose();
});

test('a cancelled task cannot accept a stale approval or mutate the project', async (t) => {
  const root = await fixture(t);
  const before = await fs.readFile(path.join(root, 'app.js'));
  const adapter = await createCoreAgentAdapter({
    coreLoader: loadCore,
    clientFactory: () => ({
      agentTurn: async () => ({
        type: 'tool_calls',
        calls: [{
          id: 'patch-after-cancel',
          name: 'apply_patch',
          arguments: { path: 'app.js', patch: '@@ -1,1 +1,1 @@\n-const answer = 1;\n+const answer = 999;' }
        }],
        model: 'test'
      })
    })
  });
  let taskId;
  let staleApprovalAccepted;
  let cancellationFinished;
  const cancellation = new Promise((resolve) => { cancellationFinished = resolve; });
  const terminal = waitForTerminal(adapter, (event) => {
    if (event.type === 'approval.requested') {
      void (async () => {
        await adapter.cancelTask(taskId);
        staleApprovalAccepted = await adapter.resolveApproval(event.approvalId, true);
        cancellationFinished();
      })();
    }
  });
  ({ taskId } = await adapter.startTask(taskRequest(root)));
  assert.equal((await terminal).type, 'task.cancelled');
  await cancellation;
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(staleApprovalAccepted, false);
  assert.deepEqual(await fs.readFile(path.join(root, 'app.js')), before);
  await adapter.dispose();
});

test('approved patches apply through Agent Core and are surfaced as a diff preview', async (t) => {
  const root = await fixture(t);
  try {
    execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
    execFileSync('git', ['add', 'app.js'], { cwd: root, stdio: 'ignore' });
    execFileSync(
      'git',
      ['-c', 'user.name=3aik Test', '-c', 'user.email=test@3aik.invalid', 'commit', '-m', 'fixture'],
      { cwd: root, stdio: 'ignore' }
    );
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      t.skip('Git is unavailable');
      return;
    }
    throw error;
  }
  const turns = [
    {
      type: 'tool_calls',
      calls: [{ id: 'read-1', name: 'read_file', arguments: { path: 'app.js' } }],
      model: 'test'
    },
    {
      type: 'tool_calls',
      calls: [{
        id: 'patch-1',
        name: 'apply_patch',
        arguments: { path: 'app.js', patch: '@@ -1,1 +1,1 @@\n-const answer = 1;\n+const answer = 2;' }
      }],
      model: 'test'
    },
    {
      type: 'tool_calls',
      calls: [{ id: 'test-1', name: 'run_command', arguments: { command: 'node --check app.js' } }],
      model: 'test'
    },
    { type: 'message', content: 'Updated and verified app.js.', model: 'test' }
  ];
  const adapter = await createCoreAgentAdapter({
    coreLoader: loadCore,
    clientFactory: () => ({ agentTurn: async () => turns.shift() })
  });
  const events = [];
  const terminal = waitForTerminal(adapter, (event) => {
    events.push(event);
    if (event.type === 'approval.requested') void adapter.resolveApproval(event.approvalId, true);
  });
  await adapter.startTask(taskRequest(root));
  const result = await terminal;
  assert.equal(result.type, 'task.completed');
  assert.equal(await fs.readFile(path.join(root, 'app.js'), 'utf8'), 'const answer = 2;\n');
  assert(events.some((event) =>
    event.type === 'diff.preview' &&
    !event.proposed &&
    event.files[0]?.path === 'app.js' &&
    event.files[0]?.patch.includes('diff --git')
  ));
  assert(events.some((event) => event.type === 'activity' && event.tool === 'run_command' && event.tone === 'success'));
  await adapter.dispose();
});

test('Git diff parser reports per-file additions and deletions', () => {
  const files = parseGitDiff('diff --git a/app.js b/app.js\n--- a/app.js\n+++ b/app.js\n@@ -1 +1 @@\n-old\n+new\n');
  assert.equal(files[0].path, 'app.js');
  assert.equal(files[0].additions, 1);
  assert.equal(files[0].deletions, 1);
});

test('large patch and write proposals carry explicit truncation metadata and markers', () => {
  const largePatch = proposedChange({
    name: 'apply_patch',
    arguments: { path: 'large.txt', patch: `@@ -1 +1 @@\n-old\n+${'x'.repeat(25_000)}` }
  });
  assert.equal(largePatch.previewTruncated, true);
  assert.equal(largePatch.truncation.characterLimitApplied, true);
  assert.equal(largePatch.truncation.lineLimitApplied, false);
  assert.match(largePatch.truncation.warning, /Review the complete source in your editor before approving/);
  assert.match(largePatch.patch, /\[PREVIEW TRUNCATED/);

  const largeWrite = proposedChange({
    name: 'write_file',
    arguments: {
      path: 'generated.txt',
      content: Array.from({ length: 900 }, (_, index) => `line ${index + 1}`).join('\n')
    }
  });
  assert.equal(largeWrite.previewTruncated, true);
  assert.equal(largeWrite.truncation.lineLimitApplied, true);
  assert.equal(largeWrite.truncation.sourceLines, 900);
  assert.equal(largeWrite.truncation.selectedLines, 800);
  assert.match(largeWrite.patch, /\[PREVIEW TRUNCATED/);
});

test('large live Git diffs also disclose partial rendering', () => {
  const files = parseGitDiff(`diff --git a/large.txt b/large.txt\n--- a/large.txt\n+++ b/large.txt\n@@ -1 +1 @@\n-old\n+${'x'.repeat(25_000)}\n`);
  assert.equal(files[0].previewTruncated, true);
  assert.equal(files[0].truncation.characterLimitApplied, true);
  assert.match(files[0].patch, /\[PREVIEW TRUNCATED/);
});

test('truncated proposals warn again in the approval event and remain mutation-free when denied', async (t) => {
  const root = await fixture(t);
  const turns = [
    {
      type: 'tool_calls',
      calls: [{
        id: 'write-large',
        name: 'write_file',
        arguments: { path: 'large.txt', content: 'x'.repeat(25_000) }
      }],
      model: 'test'
    },
    { type: 'message', content: 'The partial preview was declined.', model: 'test' }
  ];
  const adapter = await createCoreAgentAdapter({
    coreLoader: loadCore,
    clientFactory: () => ({ agentTurn: async () => turns.shift() })
  });
  let proposal;
  let approval;
  const terminal = waitForTerminal(adapter, (event) => {
    if (event.type === 'diff.preview' && event.proposed) proposal = event;
    if (event.type === 'approval.requested') {
      approval = event;
      void adapter.resolveApproval(event.approvalId, false);
    }
  });
  await adapter.startTask(taskRequest(root));
  assert.equal((await terminal).type, 'task.completed');
  assert.equal(proposal.previewTruncated, true);
  assert.match(proposal.previewWarning, /Preview truncated/);
  assert.equal(approval.previewTruncated, true);
  assert.equal(approval.previewWarning, proposal.previewWarning);
  await assert.rejects(fs.stat(path.join(root, 'large.txt')), { code: 'ENOENT' });
  await adapter.dispose();
});

test('Agent Core local fetch cannot escape its configured private endpoint', async () => {
  let captured;
  const localFetch = createLocalOnlyFetch(async (url, options) => {
    captured = { url, options };
    return Response.json({ data: [] });
  }, 'http://127.0.0.1:11434/v1');
  await localFetch('http://127.0.0.1:11434/v1/models', { method: 'GET' });
  assert.equal(captured.url, 'http://127.0.0.1:11434/v1/models');
  assert.equal(captured.options.redirect, 'error');
  await assert.rejects(
    localFetch('https://3aik.com/api/agent', { method: 'POST' }),
    /outside the configured private endpoint/
  );
});

test('cloud client is locked to the configured HTTPS service origin', async () => {
  let called = false;
  const cloudFetch = createOriginLockedFetch(async () => {
    called = true;
    return Response.json({ ok: true });
  }, 'https://3aik.com');
  await assert.rejects(
    cloudFetch('https://attacker.test/api/agent', { method: 'POST' }),
    /outside the configured service endpoint/
  );
  assert.equal(called, false);
});

test('real Agent Core cloud turns carry x-3aik-device', async (t) => {
  const root = await fixture(t);
  const requests = [];
  const adapter = await createCoreAgentAdapter({
    coreLoader: loadCore,
    fetchImplementation: async (url, options) => {
      requests.push({ url: String(url), options });
      return Response.json({ type: 'message', content: 'Reviewed.', model: 'cloud-test' });
    }
  });
  const terminal = waitForTerminal(adapter);
  await adapter.startTask({ ...taskRequest(root), prompt: 'Review this file.' });
  assert.equal((await terminal).type, 'task.completed');
  assert.equal(requests[0].url, 'https://3aik.com/api/agent');
  assert.equal(requests[0].options.headers['x-3aik-device'], 'test-device');
  await adapter.dispose();
});

test('real Agent Core local tool-loop turns never contact 3aik Cloud', async (t) => {
  const root = await fixture(t);
  const requests = [];
  let turn = 0;
  const adapter = await createCoreAgentAdapter({
    coreLoader: loadCore,
    fetchImplementation: async (url, options) => {
      requests.push({ url: String(url), options });
      turn += 1;
      if (turn === 1) {
        return Response.json({
          model: 'local-test',
          choices: [{ message: { content: '', tool_calls: [{ id: 'list-1', type: 'function', function: { name: 'list_files', arguments: '{}' } }] } }]
        });
      }
      return Response.json({ model: 'local-test', choices: [{ message: { content: 'Reviewed locally.' } }] });
    }
  });
  const terminal = waitForTerminal(adapter);
  await adapter.startTask({
    ...taskRequest(root),
    prompt: 'Review locally.',
    model: {
      provider: 'openai-compatible',
      localBaseUrl: 'http://127.0.0.1:11434/v1',
      localModel: 'local-test',
      localApiKey: ''
    }
  });
  assert.equal((await terminal).type, 'task.completed');
  assert.equal(requests.length, 2);
  assert(requests.every((request) => request.url === 'http://127.0.0.1:11434/v1/chat/completions'));
  assert(requests.every((request) => !request.url.includes('3aik.com')));
  await adapter.dispose();
});
