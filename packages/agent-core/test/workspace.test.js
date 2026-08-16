import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { LocalWorkspace, createApprovalPolicy } from "../src/index.js";
import { windowsTaskkillPath } from "../src/workspace.js";

async function fixture(t, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "3aik-workspace-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "src"));
  await mkdir(path.join(root, "node_modules"));
  await writeFile(path.join(root, "src", "app.js"), "first\nconst answer = 42;\nlast\n");
  await writeFile(path.join(root, "node_modules", "ignored.js"), "answer");
  await writeFile(path.join(root, ".env"), "API_TOKEN=secret-value\n");
  await writeFile(path.join(root, ".env.example"), "API_TOKEN=secret-value\n");
  await writeFile(path.join(root, "credentials.json"), "{\"token\":\"secret-value\"}\n");
  await writeFile(path.join(root, "private.pem"), "secret-value\n");
  await writeFile(path.join(root, ".dev.vars"), "CLOUDFLARE_TOKEN=secret-value\n");
  await mkdir(path.join(root, ".wrangler"));
  await writeFile(path.join(root, ".wrangler", "state.json"), "{\"token\":\"secret-value\"}\n");
  await mkdir(path.join(root, ".git"));
  await writeFile(path.join(root, ".git", "config"), "https://user:secret-value@example.test/repo.git\n");
  await mkdir(path.join(root, ".3aik"));
  await writeFile(path.join(root, ".3aik", "config.json"), "{\"apiKey\":\"secret-value\"}\n");
  return { root, workspace: new LocalWorkspace(root, options) };
}

test("reads line ranges, lists safely, and searches text", async (t) => {
  const { workspace } = await fixture(t);
  const read = await workspace.readFile("src/app.js", { startLine: 2, endLine: 2 });
  assert.equal(read.content, "2: const answer = 42;");
  const listed = await workspace.listFiles(".");
  assert(listed.entries.some((entry) => entry.endsWith(path.join("src", "app.js"))));
  assert(!listed.entries.some((entry) => entry.includes("node_modules")));
  assert(!listed.entries.some((entry) => /\.env|credentials|private\.pem/.test(entry)));
  const searched = await workspace.search("ANSWER", { caseSensitive: false });
  assert.equal(searched.results.length, 1);
  assert.equal(searched.results[0].line, 2);
});

test("secret-like files are denied explicitly and omitted from broad searches", async (t) => {
  const { workspace } = await fixture(t);
  for (const file of [".env", ".env.example", ".dev.vars", "credentials.json", "private.pem", ".3aik/config.json", ".wrangler/state.json", ".git/config"]) {
    await assert.rejects(workspace.readFile(file), { code: "sensitive_file" });
    await assert.rejects(workspace.search("secret-value", { path: file }), { code: "sensitive_file" });
  }
  const result = await workspace.search("secret-value");
  assert.equal(result.results.length, 0);
});

test("credential directories cannot become the workspace root", async (t) => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "3aik-sensitive-root-"));
  t.after(() => rm(parent, { recursive: true, force: true }));
  for (const name of [".docker", ".ssh", ".aws"]) {
    const root = path.join(parent, name);
    await mkdir(root);
    assert.throws(() => new LocalWorkspace(root), { code: "sensitive_workspace" });
  }
});

test("model-controlled regular expressions are rejected before scanning", async (t) => {
  const { workspace } = await fixture(t);
  await assert.rejects(workspace.search("(a+)+$", { regex: true }), { code: "regex_disabled" });
});

test("search is cancellable after traversal starts", async (t) => {
  const { workspace } = await fixture(t);
  const controller = new AbortController();
  const running = workspace.search("answer", { signal: controller.signal });
  queueMicrotask(() => controller.abort(new DOMException("Stopped search", "AbortError")));
  await assert.rejects(running, { name: "AbortError" });
});

test("search bounds directory entries even when no files are eligible", async (t) => {
  const { root, workspace } = await fixture(t, { limits: { maxEntries: 3 } });
  for (let index = 0; index < 8; index += 1) await mkdir(path.join(root, `empty-${index}`));
  const result = await workspace.search("not-present");
  assert.equal(result.truncated, true);
  assert(result.entriesVisited <= 4);
});

test("writes require approval and dry-run never changes a file", async (t) => {
  const denied = await fixture(t, { approve: async () => ({ approved: false, reason: "declined" }) });
  await assert.rejects(denied.workspace.writeFile("new.txt", "hello"), { code: "approval_required" });

  const dry = await fixture(t, { approve: createApprovalPolicy({ dryRun: true }) });
  const result = await dry.workspace.writeFile("new.txt", "hello");
  assert.equal(result.dryRun, true);
  await assert.rejects(readFile(path.join(dry.root, "new.txt")), { code: "ENOENT" });

  const allowed = await fixture(t, { approve: createApprovalPolicy({ yes: true }) });
  await allowed.workspace.writeFile("nested/new.txt", "hello");
  assert.equal(await readFile(path.join(allowed.root, "nested", "new.txt"), "utf8"), "hello");
});

test("applies patches only after approval", async (t) => {
  const { root, workspace } = await fixture(t, { approve: createApprovalPolicy({ yes: true }) });
  await workspace.applyPatch("src/app.js", "@@ -1,3 +1,3 @@\n first\n-const answer = 42;\n+const answer = 43;\n last");
  assert.match(await readFile(path.join(root, "src", "app.js"), "utf8"), /answer = 43/);
});

test("patches preserve CRLF line endings", async (t) => {
  const { root, workspace } = await fixture(t, { approve: createApprovalPolicy({ yes: true }) });
  await writeFile(path.join(root, "windows.txt"), "one\r\ntwo\r\n", "utf8");
  await workspace.applyPatch("windows.txt", "@@ -1,2 +1,2 @@\n one\n-two\n+TWO");
  assert.equal(await readFile(path.join(root, "windows.txt"), "utf8"), "one\r\nTWO\r\n");
});

test("oversized patch targets are rejected before reading or approval", async (t) => {
  let approvals = 0;
  const { root, workspace } = await fixture(t, {
    limits: { maxWriteBytes: 64 },
    approve: async () => {
      approvals += 1;
      return { approved: true };
    },
  });
  await writeFile(path.join(root, "oversized.txt"), "x".repeat(65));
  await assert.rejects(workspace.applyPatch("oversized.txt", "@@ -1 +1 @@\n-x\n+y"), { code: "file_too_large" });
  assert.equal(approvals, 0);
});

test("patch approval never clobbers a file changed while the user decides", async (t) => {
  let target;
  const { root, workspace } = await fixture(t, {
    approve: async () => {
      await writeFile(target, "external edit\n", "utf8");
      return { approved: true };
    },
  });
  target = path.join(root, "src", "app.js");
  await assert.rejects(
    workspace.applyPatch("src/app.js", "@@ -1,3 +1,3 @@\n first\n-const answer = 42;\n+const answer = 43;\n last"),
    { code: "file_changed" },
  );
  assert.equal(await readFile(target, "utf8"), "external edit\n");
});

test("write approval never clobbers a file changed while the user decides", async (t) => {
  let target;
  const { root, workspace } = await fixture(t, {
    approve: async () => {
      await writeFile(target, "external edit\n", "utf8");
      return { approved: true };
    },
  });
  target = path.join(root, "src", "app.js");
  await assert.rejects(workspace.writeFile("src/app.js", "agent edit\n"), { code: "file_changed" });
  assert.equal(await readFile(target, "utf8"), "external edit\n");
});

test("auto-approval cannot overwrite or patch sensitive files", async (t) => {
  const { workspace } = await fixture(t, { approve: createApprovalPolicy({ yes: true }) });
  await assert.rejects(workspace.writeFile(".env", "REPLACED=true\n"), { code: "sensitive_file" });
  await assert.rejects(workspace.writeFile("new-private.key", "secret"), { code: "sensitive_file" });
  await assert.rejects(workspace.writeFile(".3aik/config.json", "{}"), { code: "sensitive_file" });
  await assert.rejects(workspace.applyPatch("credentials.json", '@@ -1 +1 @@\n-{"token":"secret-value"}\n+{}'), { code: "sensitive_file" });
});

test("commands require approval, enforce output limits, time out, and block catastrophic input", async (t) => {
  const denied = await fixture(t, { approve: async () => ({ approved: false, reason: "declined" }) });
  await assert.rejects(denied.workspace.runCommand("node --version"), { code: "approval_required" });

  const allowed = await fixture(t, {
    approve: createApprovalPolicy({ yes: true }),
    limits: { timeoutMs: 100, maxOutputBytes: 100 },
  });
  const output = await allowed.workspace.runCommand("node -e \"process.stdout.write('x'.repeat(1000))\"");
  assert.equal(output.stdout.length, 100);
  assert.equal(output.truncated, true);
  const timeout = await allowed.workspace.runCommand("node -e \"setTimeout(()=>{},1000)\"");
  assert.equal(timeout.timedOut, true);
  await assert.rejects(allowed.workspace.runCommand("rm -rf /"), { code: "command_blocked" });
  await assert.rejects(allowed.workspace.runCommand(process.platform === "win32" ? "type .env" : "cat .env"), { code: "command_blocked" });
  await assert.rejects(allowed.workspace.runCommand(process.platform === "win32" ? "type .dev.vars" : "cat .dev.vars"), { code: "command_blocked" });
  await assert.rejects(allowed.workspace.runCommand(process.platform === "win32" ? "type .git\\config" : "cat .git/config"), { code: "command_blocked" });
  await assert.rejects(allowed.workspace.runCommand(process.platform === "win32" ? "type .3aik\\config.json" : "cat .3aik/config.json"), { code: "command_blocked" });
  await assert.rejects(allowed.workspace.runCommand(process.platform === "win32" ? "set" : "printenv"), { code: "command_blocked" });
});

test("Windows command cancellation resolves the system taskkill executable absolutely", () => {
  const resolved = windowsTaskkillPath({
    SystemRoot: "C:\\Windows",
    PATH: `C:\\untrusted-project;${process.env.PATH || ""}`,
  });
  assert.equal(resolved, "C:\\Windows\\System32\\taskkill.exe");
  assert(path.win32.isAbsolute(resolved));
  assert(!resolved.toLowerCase().includes("untrusted-project"));
});

test("commands do not inherit secret-like environment variables", async (t) => {
  const { workspace } = await fixture(t, { approve: createApprovalPolicy({ yes: true }) });
  process.env.THREEAIK_TEST_SECRET = "must-not-leak";
  try {
    const result = await workspace.runCommand('node -e "process.stdout.write(process.env.THREEAIK_TEST_SECRET || \'missing\')"');
    assert.equal(result.stdout, "missing");
  } finally {
    delete process.env.THREEAIK_TEST_SECRET;
  }
});

test("aborting a command rejects with the caller's reason", async (t) => {
  const { workspace } = await fixture(t, { approve: createApprovalPolicy({ yes: true }) });
  const controller = new AbortController();
  const running = workspace.runCommand("node -e \"setTimeout(()=>{},5000)\"", { signal: controller.signal });
  setTimeout(() => controller.abort(new Error("cancelled by test")), 25);
  await assert.rejects(running, /cancelled by test/);
});

test("cancellation after approval prevents a pending write", async (t) => {
  const controller = new AbortController();
  const { root, workspace } = await fixture(t, {
    approve: async () => {
      controller.abort(new DOMException("Stopped before write", "AbortError"));
      return { approved: true };
    },
  });
  await assert.rejects(workspace.writeFile("cancelled.txt", "must not exist", { signal: controller.signal }), { name: "AbortError" });
  await assert.rejects(readFile(path.join(root, "cancelled.txt")), { code: "ENOENT" });
});

test("read-only workspaces reject every mutating tool", async (t) => {
  const { workspace } = await fixture(t, { readOnly: true, approve: createApprovalPolicy({ yes: true }) });
  await assert.rejects(workspace.writeFile("x", "x"), { code: "read_only" });
  await assert.rejects(workspace.runCommand("node --version"), { code: "read_only" });
});

test("Git diff omits sensitive paths even when Git quotes their names", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "3aik-git-sensitive-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, ".ssh"));
  await writeFile(path.join(root, "visible.txt"), "safe before\n");
  await writeFile(path.join(root, ".ssh", "clé.txt"), "secret before\n");
  try {
    execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["add", "."], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["-c", "user.name=3aik Test", "-c", "user.email=test@3aik.invalid", "commit", "-m", "fixture"], { cwd: root, stdio: "ignore" });
  } catch (error) {
    if (error?.code === "ENOENT") return t.skip("Git is unavailable.");
    throw error;
  }
  if (process.platform === "win32") {
    const systemRoot = process.env.SystemRoot || process.env.WINDIR || "C:\\Windows";
    await copyFile(path.join(systemRoot, "System32", "where.exe"), path.join(root, "git.exe"));
  }
  await writeFile(path.join(root, "visible.txt"), "safe after\n");
  await writeFile(path.join(root, ".ssh", "clé.txt"), "secret after\n");
  const result = await new LocalWorkspace(root).gitDiff({});
  assert.match(result.diff, /safe after/);
  assert(!result.diff.includes("secret before"));
  assert(!result.diff.includes("secret after"));
  assert.equal(result.secretsOmitted, true);
});

test("Git diff treats repository filenames as literal pathspecs", async (t) => {
  if (process.platform === "win32") return t.skip("Windows filenames cannot contain Git's colon pathspec introducer.");
  const root = await mkdtemp(path.join(os.tmpdir(), "3aik-git-pathspec-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, ".ssh"));
  await writeFile(path.join(root, ":(glob)**"), "literal before\n");
  await writeFile(path.join(root, ".ssh", "secret.txt"), "secret before\n");
  try {
    execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["add", "."], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["-c", "user.name=3aik Test", "-c", "user.email=test@3aik.invalid", "commit", "-m", "fixture"], { cwd: root, stdio: "ignore" });
  } catch (error) {
    if (error?.code === "ENOENT") return t.skip("Git is unavailable.");
    throw error;
  }
  await writeFile(path.join(root, ":(glob)**"), "literal after\n");
  await writeFile(path.join(root, ".ssh", "secret.txt"), "secret after\n");
  const result = await new LocalWorkspace(root).gitDiff({});
  assert.match(result.diff, /literal after/);
  assert(!result.diff.includes("secret before"));
  assert(!result.diff.includes("secret after"));
  assert.equal(result.secretsOmitted, true);
});

test("Git diff never executes a repository-local fsmonitor command", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "3aik-git-fsmonitor-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "tracked.txt"), "before\n");
  try {
    execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["add", "."], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["-c", "user.name=3aik Test", "-c", "user.email=test@3aik.invalid", "commit", "-m", "fixture"], { cwd: root, stdio: "ignore" });
  } catch (error) {
    if (error?.code === "ENOENT") return t.skip("Git is unavailable.");
    throw error;
  }

  const marker = path.join(root, "fsmonitor-executed.txt");
  const helper = path.join(root, "fsmonitor-helper.js");
  await writeFile(helper, `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "executed");\n`);
  const nodeExecutable = process.execPath.replaceAll("\\", "/");
  const helperPath = helper.replaceAll("\\", "/");
  execFileSync("git", ["config", "core.fsmonitor", `\"${nodeExecutable}\" \"${helperPath}\"`], { cwd: root, stdio: "ignore" });
  await writeFile(path.join(root, "tracked.txt"), "after\n");

  const result = await new LocalWorkspace(root).gitDiff({});
  assert.match(result.diff, /after/);
  await assert.rejects(readFile(marker), { code: "ENOENT" });
});

test("Git diff pins the work tree to the selected workspace", async (t) => {
  const base = await mkdtemp(path.join(os.tmpdir(), "3aik-git-worktree-config-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = path.join(base, "workspace");
  const outside = path.join(base, "outside");
  await mkdir(root);
  await mkdir(outside);
  await writeFile(path.join(root, "tracked.txt"), "before\n");
  try {
    execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["add", "."], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["-c", "user.name=3aik Test", "-c", "user.email=test@3aik.invalid", "commit", "-m", "fixture"], { cwd: root, stdio: "ignore" });
  } catch (error) {
    if (error?.code === "ENOENT") return t.skip("Git is unavailable.");
    throw error;
  }

  await writeFile(path.join(outside, "tracked.txt"), "outside secret\n");
  execFileSync("git", ["config", "core.worktree", outside], { cwd: root, stdio: "ignore" });
  await writeFile(path.join(root, "tracked.txt"), "safe workspace edit\n");

  const result = await new LocalWorkspace(root).gitDiff({});
  assert.match(result.diff, /safe workspace edit/);
  assert(!result.diff.includes("outside secret"));
});

test("Git diff works from a linked worktree without trusting its shared config", async (t) => {
  const base = await mkdtemp(path.join(os.tmpdir(), "3aik-git-linked-worktree-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const main = path.join(base, "main");
  const linked = path.join(base, "linked");
  await mkdir(main);
  await writeFile(path.join(main, "tracked.txt"), "before\n");
  try {
    execFileSync("git", ["init"], { cwd: main, stdio: "ignore" });
    execFileSync("git", ["add", "."], { cwd: main, stdio: "ignore" });
    execFileSync("git", ["-c", "user.name=3aik Test", "-c", "user.email=test@3aik.invalid", "commit", "-m", "fixture"], { cwd: main, stdio: "ignore" });
    execFileSync("git", ["worktree", "add", "-b", "linked-fixture", linked], { cwd: main, stdio: "ignore" });
  } catch (error) {
    if (error?.code === "ENOENT") return t.skip("Git is unavailable.");
    throw error;
  }

  await writeFile(path.join(linked, "tracked.txt"), "linked edit\n");
  const workspace = new LocalWorkspace(linked);
  const unstaged = await workspace.gitDiff({});
  assert.match(unstaged.diff, /linked edit/);

  execFileSync("git", ["add", "tracked.txt"], { cwd: linked, stdio: "ignore" });
  const staged = await workspace.gitDiff({ staged: true });
  assert.match(staged.diff, /linked edit/);
});

test("Git diff rejects a forged pointer to an unrelated outside repository", async (t) => {
  const base = await mkdtemp(path.join(os.tmpdir(), "3aik-git-forged-pointer-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const outside = path.join(base, "outside");
  const workspaceRoot = path.join(base, "workspace");
  await mkdir(outside);
  await mkdir(workspaceRoot);
  const secret = "outside-repository-secret-must-not-leak";
  await writeFile(path.join(outside, "secret.txt"), `${secret}\n`);
  try {
    execFileSync("git", ["init"], { cwd: outside, stdio: "ignore" });
    execFileSync("git", ["add", "."], { cwd: outside, stdio: "ignore" });
    execFileSync("git", ["-c", "user.name=3aik Test", "-c", "user.email=test@3aik.invalid", "commit", "-m", "fixture"], { cwd: outside, stdio: "ignore" });
  } catch (error) {
    if (error?.code === "ENOENT") return t.skip("Git is unavailable.");
    throw error;
  }
  await writeFile(
    path.join(workspaceRoot, ".git"),
    `gitdir: ${path.join(outside, ".git").replaceAll("\\", "/")}\n`,
  );

  const unsafeBaseline = execFileSync("git", [
    "--no-pager",
    "--no-optional-locks",
    `--work-tree=${workspaceRoot}`,
    "-c", "core.bare=false",
    "-c", "core.fsmonitor=false",
    "-c", "diff.external=",
    "diff",
    "--no-ext-diff",
    "--no-textconv",
    "--no-color",
  ], { cwd: workspaceRoot, encoding: "utf8" });
  assert.match(unsafeBaseline, new RegExp(secret));

  const error = await new LocalWorkspace(workspaceRoot).gitDiff({}).then(
    () => null,
    (reason) => reason,
  );
  assert.equal(error?.code, "unsafe_git_metadata");
  assert(!String(error?.message).includes(secret));
});

test("Git diff rejects object alternates that expose an outside repository", async (t) => {
  const base = await mkdtemp(path.join(os.tmpdir(), "3aik-git-object-alternate-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const outside = path.join(base, "outside");
  const workspaceRoot = path.join(base, "workspace");
  await mkdir(outside);
  await mkdir(workspaceRoot);
  const secret = "outside-alternate-secret-must-not-leak";
  await writeFile(path.join(outside, "secret.txt"), `${secret}\n`);
  let outsideHead;
  try {
    execFileSync("git", ["init"], { cwd: outside, stdio: "ignore" });
    execFileSync("git", ["add", "."], { cwd: outside, stdio: "ignore" });
    execFileSync("git", ["-c", "user.name=3aik Test", "-c", "user.email=test@3aik.invalid", "commit", "-m", "fixture"], { cwd: outside, stdio: "ignore" });
    outsideHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: outside, encoding: "utf8" }).trim();
    execFileSync("git", ["init"], { cwd: workspaceRoot, stdio: "ignore" });
  } catch (error) {
    if (error?.code === "ENOENT") return t.skip("Git is unavailable.");
    throw error;
  }

  await writeFile(path.join(workspaceRoot, ".git", "HEAD"), `${outsideHead}\n`);
  await writeFile(
    path.join(workspaceRoot, ".git", "objects", "info", "alternates"),
    `${path.join(outside, ".git", "objects").replaceAll("\\", "/")}\n`,
  );
  const unsafeBaseline = execFileSync("git", [
    "--no-pager",
    "--no-optional-locks",
    `--work-tree=${workspaceRoot}`,
    "-c", "core.bare=false",
    "-c", "core.fsmonitor=false",
    "-c", "diff.external=",
    "diff",
    "--cached",
    "--no-ext-diff",
    "--no-textconv",
    "--no-color",
  ], { cwd: workspaceRoot, encoding: "utf8" });
  assert.match(unsafeBaseline, new RegExp(secret));

  const error = await new LocalWorkspace(workspaceRoot).gitDiff({ staged: true }).then(
    () => null,
    (reason) => reason,
  );
  assert.equal(error?.code, "unsafe_git_metadata");
  assert(!String(error?.message).includes(secret));
});

test("Git diff accepts an absorbed submodule whose core.worktree points back", async (t) => {
  const base = await mkdtemp(path.join(os.tmpdir(), "3aik-git-submodule-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const source = path.join(base, "source");
  const parent = path.join(base, "parent");
  const submodule = path.join(parent, "submodule");
  await mkdir(source);
  await mkdir(parent);
  await writeFile(path.join(source, "tracked.txt"), "before\n");
  try {
    execFileSync("git", ["init"], { cwd: source, stdio: "ignore" });
    execFileSync("git", ["add", "."], { cwd: source, stdio: "ignore" });
    execFileSync("git", ["-c", "user.name=3aik Test", "-c", "user.email=test@3aik.invalid", "commit", "-m", "fixture"], { cwd: source, stdio: "ignore" });
    execFileSync("git", ["init"], { cwd: parent, stdio: "ignore" });
    execFileSync("git", ["-c", "protocol.file.allow=always", "submodule", "add", source, "submodule"], { cwd: parent, stdio: "ignore" });
  } catch (error) {
    if (error?.code === "ENOENT") return t.skip("Git is unavailable.");
    throw error;
  }

  await writeFile(path.join(submodule, "tracked.txt"), "submodule edit\n");
  const result = await new LocalWorkspace(submodule).gitDiff({});
  assert.match(result.diff, /submodule edit/);
});
