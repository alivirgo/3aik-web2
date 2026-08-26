'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const MAX_EDITOR_BYTES = 512_000;

async function loadAgentCore() {
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

function normalizeRelativePath(value) {
  if (typeof value !== 'string') throw new TypeError('Path must be text.');
  const trimmed = value.trim().replace(/\\/g, '/');
  if (!trimmed || trimmed === '.') throw new Error('Choose a file path inside the project.');
  if (trimmed.length > 500) throw new Error('File path is too long.');
  return trimmed;
}

function createProjectFiles({ getProjectRoot, getReadOnly }) {
  async function createWorkspace({ readOnly = false, autoApprove = false } = {}) {
    const root = getProjectRoot();
    if (!root) throw new Error('Choose a project folder first.');
    const core = await loadAgentCore();
    return new core.LocalWorkspace(root, {
      readOnly: Boolean(readOnly),
      approve: autoApprove
        ? async () => ({ approved: true })
        : async () => ({ approved: false, reason: 'declined' })
    });
  }

  return {
    async listFiles() {
      const workspace = await createWorkspace({ readOnly: true });
      const listed = await workspace.listFiles('.', { recursive: true, maxDepth: 8 });
      const files = (listed.entries || [])
        .map((entry) => String(entry).replace(/\\/g, '/'))
        .filter((entry) => entry && !entry.endsWith('/') && !entry.includes(' -> '))
        .slice(0, 2000);
      return {
        path: listed.path,
        files,
        truncated: Boolean(listed.truncated) || (listed.entries || []).length > files.length
      };
    },

    async readFile(relativePath) {
      const requested = normalizeRelativePath(relativePath);
      const workspace = await createWorkspace({ readOnly: true });
      const target = await workspace.resolve(requested);
      const info = await fs.stat(target);
      if (!info.isFile()) throw new Error('That path is not a file.');
      if (info.size > MAX_EDITOR_BYTES) {
        throw new Error(`File is too large to edit in-app (${info.size} bytes).`);
      }
      const buffer = await fs.readFile(target);
      if (buffer.includes(0)) throw new Error('Binary files cannot be edited as text.');
      return {
        path: path.relative(getProjectRoot(), target).split(path.sep).join('/'),
        content: buffer.toString('utf8'),
        bytes: buffer.length
      };
    },

    async writeFile(relativePath, content) {
      if (getReadOnly()) throw new Error('Desktop is in read-only mode. Switch approval mode to edit files.');
      if (typeof content !== 'string') throw new TypeError('File content must be text.');
      if (Buffer.byteLength(content, 'utf8') > MAX_EDITOR_BYTES) {
        throw new Error('Edited content exceeds the in-app write limit.');
      }
      const requested = normalizeRelativePath(relativePath);
      const workspace = await createWorkspace({ readOnly: false, autoApprove: true });
      const result = await workspace.writeFile(requested, content);
      return {
        path: result.path,
        bytes: result.bytes,
        changed: Boolean(result.changed)
      };
    }
  };
}

module.exports = {
  MAX_EDITOR_BYTES,
  createProjectFiles
};
