'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { normalizeAgentBaseUrl, normalizeLocalModelBaseUrl } = require('../main/security.cjs');

const PREVIEW_CHARACTER_LIMIT = 24_000;
const WRITE_PREVIEW_LINE_LIMIT = 800;

async function defaultCoreLoader() {
  try {
    return await import('@3aik/agent-core');
  } catch (packageError) {
    const sourcePath = path.resolve(__dirname, '..', '..', '..', '..', 'packages', 'agent-core', 'src', 'index.js');
    try {
      return await import(pathToFileURL(sourcePath).href);
    } catch {
      throw packageError;
    }
  }
}

function normalizePrompt(value) {
  if (typeof value !== 'string') throw new TypeError('Task must be text.');
  const prompt = value.trim();
  if (!prompt) throw new Error('Describe what you want the coding agent to do.');
  if (prompt.length > 8000) throw new Error('Task must be 8,000 characters or fewer.');
  return prompt;
}

function displayToolName(name) {
  return {
    read_file: 'Reading a file',
    list_files: 'Mapping project files',
    search: 'Searching the workspace',
    write_file: 'Writing a file',
    apply_patch: 'Applying a patch',
    run_command: 'Running a command',
    git_diff: 'Reviewing the Git diff'
  }[name] || `Using ${name}`;
}

function toolDetail(call) {
  const args = call && call.arguments ? call.arguments : {};
  if (call.name === 'run_command') return String(args.command || 'command').slice(0, 300);
  if (call.name === 'search') return `Query: ${String(args.query || '').slice(0, 180)}`;
  if (typeof args.path === 'string') return args.path;
  return 'Trusted local tool';
}

function createLocalOnlyFetch(fetchImplementation, baseUrl) {
  const allowed = new URL(baseUrl);
  const allowedPath = allowed.pathname.replace(/\/+$/, '');
  return async (input, options = {}) => {
    const requested = new URL(String(input));
    const insideBasePath =
      requested.pathname === allowedPath || requested.pathname.startsWith(`${allowedPath}/`);
    if (requested.origin !== allowed.origin || !insideBasePath || !normalizeLocalModelBaseUrl(requested.toString())) {
      throw new Error('Blocked a local-model request outside the configured private endpoint.');
    }
    const response = await fetchImplementation(requested.toString(), { ...options, redirect: 'error' });
    if (response.url) {
      const finalUrl = new URL(response.url);
      if (finalUrl.origin !== allowed.origin || !normalizeLocalModelBaseUrl(finalUrl.toString())) {
        throw new Error('Blocked a local-model redirect outside the configured private endpoint.');
      }
    }
    return response;
  };
}

function createOriginLockedFetch(fetchImplementation, baseUrl) {
  const allowed = new URL(baseUrl);
  const allowedPath = allowed.pathname.replace(/\/+$/, '');
  return async (input, options = {}) => {
    const requested = new URL(String(input));
    const insideBasePath =
      requested.pathname === allowedPath || requested.pathname.startsWith(`${allowedPath}/`);
    if (requested.origin !== allowed.origin || !insideBasePath) {
      throw new Error('Blocked a cloud request outside the configured service endpoint.');
    }
    const response = await fetchImplementation(requested.toString(), { ...options, redirect: 'error' });
    if (response.url && new URL(response.url).origin !== allowed.origin) {
      throw new Error('Blocked a cloud redirect outside the configured service endpoint.');
    }
    return response;
  };
}

function truncatePreview(source, { linePrefix = '', maxLines = Number.POSITIVE_INFINITY } = {}) {
  const text = String(source || '');
  const sourceLines = text.split('\n');
  const selectedLines = sourceLines.slice(0, maxLines);
  const rendered = selectedLines.map((line) => `${linePrefix}${line}`).join('\n');
  const lineLimitApplied = sourceLines.length > selectedLines.length;
  const characterLimitApplied = rendered.length > PREVIEW_CHARACTER_LIMIT;
  const preview = rendered.slice(0, PREVIEW_CHARACTER_LIMIT);
  const previewTruncated = lineLimitApplied || characterLimitApplied;
  const details = [];
  if (lineLimitApplied) {
    details.push(`showing the first ${selectedLines.length.toLocaleString()} of ${sourceLines.length.toLocaleString()} lines`);
  }
  if (characterLimitApplied) {
    details.push(`rendered text capped at ${PREVIEW_CHARACTER_LIMIT.toLocaleString()} characters`);
  }
  const warning = previewTruncated
    ? `Preview truncated: ${details.join('; ')}. Review the complete source in your editor before approving.`
    : null;
  return {
    preview: previewTruncated ? `${preview}\n\n[PREVIEW TRUNCATED]\n${warning}` : preview,
    previewTruncated,
    truncation: previewTruncated
      ? {
          warning,
          lineLimitApplied,
          characterLimitApplied,
          sourceLines: sourceLines.length,
          selectedLines: selectedLines.length,
          sourceCharacters: text.length,
          previewCharacters: preview.length
        }
      : null
  };
}

function previewEventMetadata(files) {
  const truncated = files.filter((file) => file.previewTruncated);
  return {
    previewTruncated: truncated.length > 0,
    previewWarning: truncated.length
      ? truncated.length === 1
        ? truncated[0].truncation.warning
        : `${truncated.length} file previews are truncated. Review the complete sources in your editor before approving.`
      : null
  };
}

function parseGitDiff(diff) {
  if (typeof diff !== 'string' || !diff.trim()) return [];
  const sections = diff.split(/(?=^diff --git )/m).filter(Boolean);
  return sections.map((patchText, index) => {
    const header = patchText.match(/^diff --git a\/(.+?) b\/(.+)$/m);
    const targetPath = header ? header[2] : `change-${index + 1}`;
    let additions = 0;
    let deletions = 0;
    for (const line of patchText.split('\n')) {
      if (line.startsWith('+') && !line.startsWith('+++')) additions += 1;
      if (line.startsWith('-') && !line.startsWith('---')) deletions += 1;
    }
    const limited = truncatePreview(patchText);
    return {
      path: targetPath,
      status: patchText.includes('new file mode') ? 'added' : patchText.includes('deleted file mode') ? 'deleted' : 'modified',
      additions,
      deletions,
      patch: limited.preview,
      previewTruncated: limited.previewTruncated,
      truncation: limited.truncation
    };
  });
}

function proposedChange(call) {
  const args = call?.arguments || {};
  if (call?.name === 'apply_patch' && typeof args.patch === 'string') {
    let additions = 0;
    let deletions = 0;
    for (const line of args.patch.split('\n')) {
      if (line.startsWith('+') && !line.startsWith('+++')) additions += 1;
      if (line.startsWith('-') && !line.startsWith('---')) deletions += 1;
    }
    const limited = truncatePreview(args.patch);
    return {
      path: String(args.path || 'proposed patch'),
      status: 'proposed',
      additions,
      deletions,
      patch: limited.preview,
      previewTruncated: limited.previewTruncated,
      truncation: limited.truncation
    };
  }
  if (call?.name === 'write_file' && typeof args.content === 'string') {
    const lines = args.content.split('\n');
    const limited = truncatePreview(args.content, {
      linePrefix: '+',
      maxLines: WRITE_PREVIEW_LINE_LIMIT
    });
    return {
      path: String(args.path || 'proposed file'),
      status: 'proposed',
      additions: lines.length,
      deletions: 0,
      patch: limited.preview,
      previewTruncated: limited.previewTruncated,
      truncation: limited.truncation
    };
  }
  return null;
}

class CoreAgentAdapter {
  #core;
  #fetch;
  #clientFactory;
  #listeners = new Set();
  #tasks = new Map();
  #approvals = new Map();

  constructor({ core, fetchImplementation = fetch, clientFactory } = {}) {
    if (!core?.CodingAgent || !core?.LocalWorkspace) {
      throw new Error('The installed @3aik/agent-core is incompatible with this desktop build.');
    }
    this.#core = core;
    this.#fetch = fetchImplementation;
    this.#clientFactory = clientFactory || null;
  }

  onEvent(listener) {
    if (typeof listener !== 'function') throw new TypeError('Agent listener must be a function.');
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit(event) {
    const payload = Object.freeze({ ...event, at: new Date().toISOString() });
    for (const listener of this.#listeners) listener(payload);
  }

  #createClient(model) {
    if (this.#clientFactory) return this.#clientFactory(model);
    if (model.provider === 'openai-compatible') {
      const baseUrl = normalizeLocalModelBaseUrl(model.localBaseUrl);
      if (!baseUrl) throw new Error('Local model URL must resolve to localhost or a private network address.');
      return new this.#core.OpenAICompatibleClient({
        baseUrl,
        model: model.localModel,
        apiKey: model.localApiKey || '',
        fetchImpl: createLocalOnlyFetch(this.#fetch, baseUrl)
      });
    }
    const apiBase = normalizeAgentBaseUrl(model.agentBaseUrl);
    if (!apiBase) throw new Error('Invalid 3aik Cloud base URL.');
    return new this.#core.ThreeAikClient({
      apiBase,
      fetchImpl: createOriginLockedFetch(this.#fetch, apiBase),
      headers: { 'x-3aik-device': model.deviceId }
    });
  }

  async startTask(request) {
    if (!request || typeof request !== 'object') throw new TypeError('Agent request is required.');
    const prompt = normalizePrompt(request.prompt);
    const projectRoot = await fs.realpath(request.projectRoot);
    const stat = await fs.stat(projectRoot);
    if (!stat.isDirectory()) throw new Error('The selected project is not a directory.');
    const taskId = randomUUID();
    const task = {
      taskId,
      prompt,
      projectRoot,
      approvalMode: request.approvalMode === 'read-only' ? 'read-only' : 'ask',
      model: request.model,
      controller: new AbortController(),
      completed: false,
      lastDiff: '',
      pendingPreviewWarning: null
    };
    this.#tasks.set(taskId, task);
    setImmediate(() => {
      if (!task.completed && this.#tasks.get(taskId) === task) void this.#run(task);
    });
    return { taskId };
  }

  async #requestApproval(task, details) {
    if (task.completed || task.controller.signal.aborted || this.#tasks.get(task.taskId) !== task) {
      return { approved: false, dryRun: false, reason: 'task cancelled' };
    }
    if (task.approvalMode === 'read-only') {
      return { approved: false, dryRun: false, reason: 'read-only mode' };
    }
    const approvalId = randomUUID();
    const previewWarning = task.pendingPreviewWarning;
    task.pendingPreviewWarning = null;
    return new Promise((resolve) => {
      this.#approvals.set(approvalId, { taskId: task.taskId, resolve });
      this.#emit({
        type: 'approval.requested',
        taskId: task.taskId,
        approvalId,
        title: details.kind === 'run_command' ? 'Allow this command?' : 'Allow this file change?',
        message: details.description,
        risk: details.risk || 'caution',
        action: details.kind,
        previewTruncated: Boolean(previewWarning),
        previewWarning
      });
    });
  }

  async #emitWorkspaceDiff(task, workspace, fallbackPath) {
    try {
      const result = await workspace.gitDiff({});
      if (!result.diff) {
        if (fallbackPath) {
          this.#emit({
            type: 'diff.preview',
            taskId: task.taskId,
            title: 'File changed',
            summary: 'Git does not report this path yet (it may be untracked).',
            files: [{ path: fallbackPath, status: 'modified', additions: 0, deletions: 0, patch: 'Change applied. Add the file to Git to include it in the repository diff.' }]
          });
        }
        return;
      }
      if (result.diff === task.lastDiff) return;
      task.lastDiff = result.diff;
      const files = parseGitDiff(result.diff);
      this.#emit({
        type: 'diff.preview',
        taskId: task.taskId,
        title: `${files.length} changed ${files.length === 1 ? 'file' : 'files'}`,
        summary: 'Live, uncommitted Git diff from the selected project.',
        files,
        ...previewEventMetadata(files)
      });
    } catch {
      if (!fallbackPath) return;
      this.#emit({
        type: 'diff.preview',
        taskId: task.taskId,
        title: 'File changed',
        summary: 'The workspace is not a Git repository, so a unified repository diff is unavailable.',
        files: [{ path: fallbackPath, status: 'modified', additions: 0, deletions: 0, patch: 'Change applied. Initialize Git to see a full diff.' }]
      });
    }
  }

  async #handleCoreEvent(task, workspace, event) {
    if (task.completed || task.controller.signal.aborted) return;
    if (event.type === 'turn_start') {
      this.#emit({
        type: 'activity',
        taskId: task.taskId,
        tone: 'working',
        title: `Planning turn ${event.iteration}`,
        message: task.model.provider === 'openai-compatible'
          ? 'Reasoning on your configured local model.'
          : 'Reasoning with 3aik Cloud.'
      });
      return;
    }
    if (event.type === 'tool_start') {
      this.#emit({
        type: 'activity',
        taskId: task.taskId,
        tone: 'working',
        title: displayToolName(event.call.name),
        message: toolDetail(event.call),
        tool: event.call.name
      });
      const proposed = proposedChange(event.call);
      if (proposed) {
        task.pendingPreviewWarning = proposed.previewTruncated ? proposed.truncation.warning : null;
        this.#emit({
          type: 'diff.preview',
          taskId: task.taskId,
          title: 'Proposed change · awaiting approval',
          summary: 'This is the model’s proposal. It has not been applied to the project.',
          proposed: true,
          files: [proposed],
          ...previewEventMetadata([proposed])
        });
      }
      return;
    }
    if (event.type === 'tool_error') {
      this.#emit({
        type: 'activity',
        taskId: task.taskId,
        tone: 'warning',
        title: `${displayToolName(event.call.name)} was not completed`,
        message: event.error?.message || String(event.error || 'Tool failed.'),
        tool: event.call.name
      });
      return;
    }
    if (event.type === 'protocol_error') {
      this.#emit({
        type: 'activity',
        taskId: task.taskId,
        tone: 'warning',
        title: 'Model response needed repair',
        message: (event.errors || []).join('; ')
      });
      return;
    }
    if (event.type === 'tool_end') {
      const result = event.result || {};
      let message = 'Completed locally.';
      if (event.call.name === 'list_files') message = `Mapped ${result.entries?.length || 0} workspace entries.`;
      else if (event.call.name === 'read_file') message = `Read ${result.path || 'file'} lines ${result.startLine || 1}–${result.endLine || result.totalLines || '?'}.`;
      else if (event.call.name === 'search') message = `Found ${result.results?.length || 0} matches across ${result.filesScanned || 0} files.`;
      else if (event.call.name === 'run_command') {
        const output = [result.stdout, result.stderr].filter((value) => typeof value === 'string' && value.trim()).join('\n').trim();
        message = `${result.command || 'Command'} exited ${result.exitCode ?? 'without a code'} in ${result.durationMs || 0} ms.${output ? `\n${output.slice(0, 4000)}` : ''}`;
      }
      else if (event.call.name === 'git_diff') message = result.diff ? 'Loaded the current uncommitted diff.' : 'The Git working tree is clean.';
      else if (result.path) message = `${result.path} ${result.changed === false ? 'did not need changes' : 'was updated'}.`;
      this.#emit({
        type: 'activity',
        taskId: task.taskId,
        tone: 'success',
        title: `${displayToolName(event.call.name)} complete`,
        message,
        tool: event.call.name
      });
      if (event.call.name === 'git_diff' && result.diff) {
        task.lastDiff = result.diff;
        const files = parseGitDiff(result.diff);
        this.#emit({
          type: 'diff.preview',
          taskId: task.taskId,
          title: `${files.length} changed ${files.length === 1 ? 'file' : 'files'}`,
          summary: 'Live, uncommitted Git diff from the selected project.',
          files,
          ...previewEventMetadata(files)
        });
      } else if (['write_file', 'apply_patch', 'run_command'].includes(event.call.name) && !result.dryRun) {
        await this.#emitWorkspaceDiff(task, workspace, result.path);
      }
    }
  }

  async #run(task) {
    try {
      const workspace = new this.#core.LocalWorkspace(task.projectRoot, {
        readOnly: task.approvalMode === 'read-only',
        approve: (details) => this.#requestApproval(task, details)
      });
      const client = this.#createClient(task.model);
      const agent = new this.#core.CodingAgent({ client, workspace, maxIterations: 16 });
      this.#emit({
        type: 'task.started',
        taskId: task.taskId,
        message: task.approvalMode === 'read-only'
          ? 'Started a read-only coding-agent session.'
          : 'Started a coding-agent session with approval-gated changes.'
      });
      const result = await agent.run(task.prompt, {
        signal: task.controller.signal,
        onEvent: (event) => this.#handleCoreEvent(task, workspace, event)
      });
      if (task.completed) return;
      await this.#emitWorkspaceDiff(task, workspace);
      task.completed = true;
      this.#tasks.delete(task.taskId);
      this.#emit({
        type: 'task.completed',
        taskId: task.taskId,
        status: 'complete',
        title: 'Task complete',
        message: result.content,
        model: result.model,
        iterations: result.iterations
      });
    } catch (error) {
      if (task.completed) return;
      task.completed = true;
      this.#tasks.delete(task.taskId);
      if (task.controller.signal.aborted || error?.name === 'AbortError') {
        this.#emit({
          type: 'task.cancelled',
          taskId: task.taskId,
          title: 'Task stopped',
          message: 'The coding agent was stopped.'
        });
        return;
      }
      this.#emit({
        type: 'task.failed',
        taskId: task.taskId,
        title: 'Agent task failed',
        message: error instanceof Error ? error.message : 'Unknown agent error.'
      });
    }
  }

  async resolveApproval(approvalId, approved) {
    const approval = this.#approvals.get(approvalId);
    if (!approval) return false;
    this.#approvals.delete(approvalId);
    const task = this.#tasks.get(approval.taskId);
    const accepted = Boolean(approved) && Boolean(task) && !task.completed && !task.controller.signal.aborted;
    approval.resolve({
      approved: accepted,
      dryRun: false,
      reason: accepted ? 'approved in 3aik Desktop' : task ? 'declined in 3aik Desktop' : 'task cancelled'
    });
    this.#emit({
      type: 'approval.resolved',
      taskId: approval.taskId,
      approvalId,
      approved: accepted
    });
    return true;
  }

  async cancelTask(taskId) {
    const task = this.#tasks.get(taskId);
    if (!task || task.completed) return false;
    task.completed = true;
    this.#tasks.delete(taskId);
    for (const [approvalId, approval] of this.#approvals) {
      if (approval.taskId === taskId) {
        this.#approvals.delete(approvalId);
        approval.resolve({ approved: false, dryRun: false, reason: 'task cancelled' });
      }
    }
    task.controller.abort(new DOMException('Stopped by user', 'AbortError'));
    this.#emit({
      type: 'task.cancelled',
      taskId,
      title: 'Task stopped',
      message: 'The coding agent was stopped. Completed changes, if any, remain visible in the diff.'
    });
    return true;
  }

  async dispose() {
    for (const taskId of [...this.#tasks.keys()]) await this.cancelTask(taskId);
    this.#listeners.clear();
  }
}

async function createCoreAgentAdapter(options = {}) {
  const core = options.core || (await (options.coreLoader || defaultCoreLoader)());
  return new CoreAgentAdapter({ ...options, core });
}

module.exports = {
  CoreAgentAdapter,
  createLocalOnlyFetch,
  createOriginLockedFetch,
  createCoreAgentAdapter,
  defaultCoreLoader,
  parseGitDiff,
  previewEventMetadata,
  proposedChange,
  truncatePreview
};
