'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createProjectFiles } = require('../src/main/project-files.cjs');

test('project files can list, read, and save inside a selected workspace', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '3aik-desktop-files-'));
  const relative = path.join('src', 'hello.txt');
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.writeFile(path.join(root, relative), 'hello\n', 'utf8');

  let readOnly = false;
  const files = createProjectFiles({
    getProjectRoot: () => root,
    getReadOnly: () => readOnly
  });

  const listed = await files.listFiles();
  assert.ok(listed.files.includes('src/hello.txt') || listed.files.includes(path.join('src', 'hello.txt').split(path.sep).join('/')));

  const opened = await files.readFile('src/hello.txt');
  assert.equal(opened.content, 'hello\n');

  const saved = await files.writeFile('src/hello.txt', 'updated\n');
  assert.equal(saved.changed, true);
  assert.equal(await fs.readFile(path.join(root, relative), 'utf8'), 'updated\n');

  readOnly = true;
  await assert.rejects(() => files.writeFile('src/hello.txt', 'blocked\n'), /read-only/i);
});
