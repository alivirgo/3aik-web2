import path from "node:path";
import { tmpdir } from "node:os";
import { constants as fsConstants } from "node:fs";
import { access, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { AgentError, SafetyError } from "./errors.js";
import {
  DEFAULT_IGNORES,
  classifyCommand,
  createApprovalPolicy,
  isSensitivePath,
  resolveTrustedExecutable,
  resolveWorkspacePath,
  scrubEnvironment,
} from "./safety.js";
import { applyUnifiedPatch } from "./patch.js";

const DEFAULT_LIMITS = Object.freeze({
  maxReadBytes: 512_000,
  maxWriteBytes: 2_000_000,
  maxSearchFileBytes: 1_000_000,
  maxSearchFiles: 4_000,
  maxSearchDepth: 24,
  maxEntries: 4_000,
  maxResults: 250,
  maxOutputBytes: 256_000,
  timeoutMs: 120_000,
});

function byteLength(value) {
  return Buffer.byteLength(value, "utf8");
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw signal.reason || new DOMException("Aborted", "AbortError");
}

async function fileStamp(target) {
  try {
    const info = await stat(target, { bigint: true });
    return `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;
  } catch (error) {
    if (error?.code === "ENOENT") return "missing";
    throw error;
  }
}

function relativeDisplay(root, value) {
  const relative = path.relative(root, value);
  return relative || ".";
}

function isProbablyBinary(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8_000));
  if (sample.includes(0)) return true;
  let suspicious = 0;
  for (const byte of sample) {
    if (byte < 7 || (byte > 14 && byte < 32)) suspicious += 1;
  }
  return sample.length > 0 && suspicious / sample.length > 0.1;
}

function windowsTaskkillPath(environment = process.env) {
  const configured = environment.SystemRoot || environment.SYSTEMROOT || environment.WINDIR;
  const systemRoot = configured && path.win32.isAbsolute(configured)
    ? path.win32.normalize(configured)
    : path.win32.join(path.win32.parse(process.execPath).root || "C:\\", "Windows");
  return path.win32.join(systemRoot, "System32", "taskkill.exe");
}

async function runProcess(executable, args, { cwd, timeoutMs, maxOutputBytes, shell = false, signal, environment } = {}) {
  if (signal?.aborted) throw signal.reason || new DOMException("Aborted", "AbortError");
  return await new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn(executable, args, {
      cwd,
      shell,
      windowsHide: true,
      env: { ...scrubEnvironment(process.env), ...(environment || {}) },
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    const chunks = { stdout: [], stderr: [] };
    let captured = 0;
    let truncated = false;
    let timedOut = false;
    let aborted = false;
    let closed = false;
    let escalationTimer;

    const terminate = (force = false) => {
      if (!child.pid || closed) return;
      if (process.platform === "win32") {
        const taskkill = windowsTaskkillPath();
        const killer = spawn(taskkill, ["/pid", String(child.pid), "/t", "/f"], {
          cwd: path.win32.dirname(taskkill),
          env: scrubEnvironment(process.env),
          windowsHide: true,
          stdio: "ignore",
        });
        killer.on("error", () => child.kill(force ? "SIGKILL" : "SIGTERM"));
        return;
      }
      try { process.kill(-child.pid, force ? "SIGKILL" : "SIGTERM"); } catch { child.kill(force ? "SIGKILL" : "SIGTERM"); }
    };

    const scheduleEscalation = () => {
      if (process.platform === "win32" || escalationTimer || closed) return;
      escalationTimer = setTimeout(() => {
        escalationTimer = undefined;
        if (!closed) terminate(true);
      }, 1_000);
      escalationTimer.unref();
    };

    const collect = (channel) => (chunk) => {
      if (captured >= maxOutputBytes) {
        truncated = true;
        return;
      }
      const remaining = maxOutputBytes - captured;
      const selected = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
      chunks[channel].push(selected);
      captured += selected.length;
      if (selected.length < chunk.length) truncated = true;
    };

    child.stdout.on("data", collect("stdout"));
    child.stderr.on("data", collect("stderr"));
    child.on("error", reject);
    const abort = () => {
      aborted = true;
      terminate(false);
      scheduleEscalation();
    };
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      terminate(false);
      scheduleEscalation();
    }, timeoutMs);
    timer.unref();

    child.on("close", (code, exitSignal) => {
      closed = true;
      clearTimeout(timer);
      clearTimeout(escalationTimer);
      signal?.removeEventListener("abort", abort);
      if (aborted) {
        reject(signal?.reason || new DOMException("Aborted", "AbortError"));
        return;
      }
      resolve({
        command: [executable, ...args].join(" "),
        exitCode: typeof code === "number" ? code : null,
        signal: exitSignal,
        stdout: Buffer.concat(chunks.stdout).toString("utf8"),
        stderr: Buffer.concat(chunks.stderr).toString("utf8"),
        truncated,
        timedOut,
        durationMs: Date.now() - startedAt,
      });
    });
  });
}

function isolatedGitEnvironment(root, overrides = {}) {
  const nullConfig = process.platform === "win32" ? "NUL" : "/dev/null";
  return {
    GIT_ATTR_NOSYSTEM: "1",
    GIT_CEILING_DIRECTORIES: path.dirname(root),
    GIT_CONFIG_GLOBAL: nullConfig,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_SYSTEM: nullConfig,
    GIT_DISCOVERY_ACROSS_FILESYSTEM: "0",
    GIT_NO_LAZY_FETCH: "1",
    GIT_OPTIONAL_LOCKS: "0",
    ...overrides,
  };
}

function gitDiscoveryArgs(root, ...args) {
  return [
    "--no-pager",
    "--no-optional-locks",
    `--work-tree=${root}`,
    "-c", "core.bare=false",
    "-c", "core.fsmonitor=false",
    "-c", `core.worktree=${root}`,
    ...args,
  ];
}

function comparablePath(value) {
  const normalized = path.resolve(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function pathsEqual(left, right) {
  return comparablePath(left) === comparablePath(right);
}

function unsafeGitMetadata(message = "Git metadata is not bound to the selected workspace.") {
  return new SafetyError(message, { code: "unsafe_git_metadata" });
}

async function readGitPointer(target, { prefix } = {}) {
  let info;
  try {
    info = await lstat(target);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  if (!info.isFile() || info.isSymbolicLink() || info.size > 4_096) throw unsafeGitMetadata();
  const value = (await readFile(target, "utf8")).replace(/\r\n/g, "\n").trimEnd();
  if (!value || value.includes("\0") || value.includes("\n")) throw unsafeGitMetadata();
  if (!prefix) return value;
  const match = value.match(new RegExp(`^${prefix}:\\s*(.+)$`, "i"));
  if (!match?.[1]) throw unsafeGitMetadata();
  return match[1];
}

async function validateDirectory(target) {
  const info = await lstat(target);
  if (!info.isDirectory() || info.isSymbolicLink()) throw unsafeGitMetadata();
  return realpath(target);
}

async function rejectGitObjectAlternates(objectDirectory) {
  for (const name of ["alternates", "http-alternates"]) {
    const target = path.join(objectDirectory, "info", name);
    const info = await lstat(target).catch((error) => {
      if (error?.code === "ENOENT") return null;
      throw error;
    });
    if (!info) continue;
    if (!info.isFile() || info.isSymbolicLink() || info.size > 0) {
      throw unsafeGitMetadata("Git object alternates are not trusted for workspace diffs.");
    }
  }
}

async function readConfiguredWorktree(gitExecutable, gitDir, root, { signal }) {
  const configPath = path.join(gitDir, "config");
  const configInfo = await lstat(configPath).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (!configInfo?.isFile() || configInfo.isSymbolicLink() || configInfo.size > 1_000_000) return null;
  const result = await runProcess(gitExecutable, [
    "--no-pager",
    "--no-optional-locks",
    "config",
    `--file=${configPath}`,
    "--no-includes",
    "--null",
    "--path",
    "--get-all",
    "core.worktree",
  ], {
    cwd: root,
    timeoutMs: 30_000,
    maxOutputBytes: 8_192,
    signal,
    environment: isolatedGitEnvironment(root),
  });
  if (result.exitCode === 1 && !result.stdout) return null;
  if (result.exitCode !== 0 || result.timedOut || result.truncated) throw unsafeGitMetadata();
  const values = result.stdout.split("\0").filter(Boolean);
  if (values.length !== 1 || /[\0\r\n]/.test(values[0])) throw unsafeGitMetadata();
  return path.resolve(gitDir, values[0]);
}

async function validateGitMetadata(gitExecutable, root, metadata, { signal }) {
  const marker = path.join(root, ".git");
  let markerInfo;
  try {
    markerInfo = await lstat(marker);
  } catch (error) {
    if (error?.code === "ENOENT") throw unsafeGitMetadata("The workspace root does not contain its own Git metadata.");
    throw error;
  }
  if (markerInfo.isSymbolicLink()) throw unsafeGitMetadata();

  let validatedGitDir;
  let validatedCommonDir;
  if (markerInfo.isDirectory()) {
    validatedGitDir = await validateDirectory(marker);
    validatedCommonDir = validatedGitDir;
  } else if (markerInfo.isFile() && markerInfo.size <= 4_096) {
    const targetValue = await readGitPointer(marker, { prefix: "gitdir" });
    const target = path.resolve(path.dirname(marker), targetValue);
    validatedGitDir = await validateDirectory(target);

    const backlinkValue = await readGitPointer(path.join(validatedGitDir, "gitdir"));
    if (backlinkValue) {
      const backlink = path.resolve(validatedGitDir, backlinkValue);
      const backlinkTarget = await realpath(backlink).catch(() => null);
      const markerTarget = await realpath(marker);
      if (!backlinkTarget || !pathsEqual(backlinkTarget, markerTarget)) throw unsafeGitMetadata();
      const commonValue = await readGitPointer(path.join(validatedGitDir, "commondir"));
      if (!commonValue) throw unsafeGitMetadata();
      validatedCommonDir = await validateDirectory(path.resolve(validatedGitDir, commonValue));
    } else {
      const configuredWorktree = await readConfiguredWorktree(gitExecutable, validatedGitDir, root, { signal });
      const configuredTarget = configuredWorktree
        ? await realpath(configuredWorktree).catch(() => null)
        : null;
      if (!configuredTarget || !pathsEqual(configuredTarget, root)) throw unsafeGitMetadata();
      validatedCommonDir = validatedGitDir;
    }
  } else {
    throw unsafeGitMetadata();
  }

  const reportedGitDir = await realpath(metadata.gitDir).catch(() => null);
  const reportedCommonDir = await realpath(metadata.commonDir).catch(() => null);
  if (
    !reportedGitDir
    || !reportedCommonDir
    || !pathsEqual(reportedGitDir, validatedGitDir)
    || !pathsEqual(reportedCommonDir, validatedCommonDir)
  ) {
    throw unsafeGitMetadata();
  }

  const expectedIndex = path.join(validatedGitDir, "index");
  if (!pathsEqual(metadata.indexPath, expectedIndex)) throw unsafeGitMetadata();
  const indexInfo = await lstat(expectedIndex).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (indexInfo && (!indexInfo.isFile() || indexInfo.isSymbolicLink())) throw unsafeGitMetadata();

  const expectedObjects = path.join(validatedCommonDir, "objects");
  if (!pathsEqual(metadata.objectDirectory, expectedObjects)) throw unsafeGitMetadata();
  const validatedObjects = await validateDirectory(expectedObjects);
  if (!pathsEqual(validatedObjects, expectedObjects)) throw unsafeGitMetadata();
  await rejectGitObjectAlternates(validatedObjects);

  return {
    ...metadata,
    gitDir: validatedGitDir,
    commonDir: validatedCommonDir,
    indexPath: expectedIndex,
    objectDirectory: validatedObjects,
  };
}

async function inspectGitRepository(gitExecutable, root, { signal, maxOutputBytes }) {
  const environment = isolatedGitEnvironment(root);
  const metadataResult = await runProcess(gitExecutable, gitDiscoveryArgs(
    root,
    "rev-parse",
    "--path-format=absolute",
    "--absolute-git-dir",
    "--git-common-dir",
    "--git-path", "objects",
    "--git-path", "index",
    "--show-object-format",
  ), {
    cwd: root,
    timeoutMs: 30_000,
    maxOutputBytes,
    signal,
    environment,
  });
  if (metadataResult.exitCode !== 0 || metadataResult.truncated) {
    throw new AgentError(metadataResult.stderr.trim() || "Unable to inspect the Git repository.", { code: "git_error" });
  }

  const lines = metadataResult.stdout.trim().split(/\r?\n/);
  if (lines.length !== 5 || !["sha1", "sha256"].includes(lines[4])) {
    throw new AgentError("Git returned invalid repository metadata.", { code: "git_error" });
  }
  const [gitDir, commonDir, objectDirectory, indexPath, objectFormat] = lines;
  if ([gitDir, commonDir, objectDirectory, indexPath].some((value) => !path.isAbsolute(value) || /[\0\r\n]/.test(value))) {
    throw new AgentError("Git returned unsafe repository paths.", { code: "git_error" });
  }
  const metadata = await validateGitMetadata(
    gitExecutable,
    root,
    { gitDir, commonDir, objectDirectory, indexPath, objectFormat },
    { signal },
  );

  const headResult = await runProcess(gitExecutable, gitDiscoveryArgs(
    root,
    "rev-parse",
    "--verify",
    "--quiet",
    "HEAD^{commit}",
  ), {
    cwd: root,
    timeoutMs: 30_000,
    maxOutputBytes: 1_024,
    signal,
    environment,
  });
  if (headResult.timedOut || headResult.truncated || ![0, 1].includes(headResult.exitCode)) {
    throw new AgentError(headResult.stderr.trim() || "Unable to inspect Git HEAD.", { code: "git_error" });
  }
  const head = headResult.exitCode === 0 ? headResult.stdout.trim() : null;
  const expectedLength = objectFormat === "sha256" ? 64 : 40;
  if (head && !new RegExp(`^[0-9a-f]{${expectedLength}}$`, "i").test(head)) {
    throw new AgentError("Git returned an invalid HEAD object ID.", { code: "git_error" });
  }

  return { ...metadata, head };
}

async function createGitDiffSandbox(metadata) {
  const directory = await mkdtemp(path.join(tmpdir(), "3aik-git-diff-"));
  try {
    const gitDir = path.join(directory, "git");
    await mkdir(path.join(gitDir, "objects", "info"), { recursive: true });
    await mkdir(path.join(gitDir, "refs", "heads"), { recursive: true });
    await mkdir(path.join(gitDir, "refs", "tags"), { recursive: true });
    await writeFile(
      path.join(gitDir, "objects", "info", "alternates"),
      `${metadata.objectDirectory.replaceAll("\\", "/")}\n`,
      "utf8",
    );
    const repositoryFormatVersion = metadata.objectFormat === "sha256" ? 1 : 0;
    const objectFormatConfig = metadata.objectFormat === "sha256"
      ? "[extensions]\n\tobjectFormat = sha256\n"
      : "";
    await writeFile(
      path.join(gitDir, "config"),
      `[core]\n\trepositoryFormatVersion = ${repositoryFormatVersion}\n\tbare = false\n${objectFormatConfig}`,
      "utf8",
    );
    await writeFile(
      path.join(gitDir, "HEAD"),
      metadata.head ? `${metadata.head}\n` : "ref: refs/heads/3aik-unborn\n",
      "utf8",
    );
    return { directory, gitDir };
  } catch (error) {
    await rm(directory, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

function isContainedGitPath(root, value) {
  if (typeof value !== "string" || !value || value.includes("\0") || path.isAbsolute(value)) return false;
  const relative = path.relative(root, path.resolve(root, value));
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export { windowsTaskkillPath };

export const TOOL_DEFINITIONS = Object.freeze([
  { type: "function", function: { name: "read_file", description: "Read a UTF-8 file inside the workspace, optionally by inclusive line range.", parameters: { type: "object", properties: { path: { type: "string" }, startLine: { type: "integer" }, endLine: { type: "integer" } }, required: ["path"], additionalProperties: false } } },
  { type: "function", function: { name: "list_files", description: "List files and directories without following symlinks or entering common generated directories.", parameters: { type: "object", properties: { path: { type: "string" }, recursive: { type: "boolean" }, maxDepth: { type: "integer" } }, additionalProperties: false } } },
  { type: "function", function: { name: "search", description: "Search UTF-8 workspace files for literal text.", parameters: { type: "object", properties: { query: { type: "string" }, path: { type: "string" }, caseSensitive: { type: "boolean" } }, required: ["query"], additionalProperties: false } } },
  { type: "function", function: { name: "write_file", description: "Create or replace a UTF-8 workspace file. Requires local approval.", parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"], additionalProperties: false } } },
  { type: "function", function: { name: "apply_patch", description: "Apply unified diff hunks to one workspace file. Requires local approval.", parameters: { type: "object", properties: { path: { type: "string" }, patch: { type: "string" } }, required: ["path", "patch"], additionalProperties: false } } },
  { type: "function", function: { name: "run_command", description: "Run a shell command locally in a contained workspace directory. Always risk-classified and requires local approval.", parameters: { type: "object", properties: { command: { type: "string" }, cwd: { type: "string" }, timeoutMs: { type: "integer" } }, required: ["command"], additionalProperties: false } } },
  { type: "function", function: { name: "git_diff", description: "Read the current Git diff without changing the repository.", parameters: { type: "object", properties: { staged: { type: "boolean" }, path: { type: "string" } }, additionalProperties: false } } },
]);

export class LocalWorkspace {
  constructor(root, options = {}) {
    if (!root) throw new AgentError("A workspace root is required.", { code: "invalid_workspace" });
    this.root = path.resolve(root);
    if (isSensitivePath(this.root)) {
      throw new SafetyError("A secret or credential directory cannot be used as the workspace root.", { code: "sensitive_workspace" });
    }
    this.limits = { ...DEFAULT_LIMITS, ...(options.limits || {}) };
    this.ignores = new Set([...DEFAULT_IGNORES, ...(options.ignores || [])]);
    this.approve = options.approve || createApprovalPolicy(options);
    this.readOnly = Boolean(options.readOnly);
  }

  async verify() {
    const info = await stat(this.root);
    if (!info.isDirectory()) throw new AgentError("Workspace root is not a directory.", { code: "invalid_workspace" });
    return this.root;
  }

  async resolve(requested = ".", options) {
    await this.verify();
    return resolveWorkspacePath(this.root, requested, options);
  }

  async readFile(requested, { startLine = 1, endLine, signal } = {}) {
    throwIfAborted(signal);
    if (isSensitivePath(requested)) throw new SafetyError(`Refusing to read sensitive file: ${requested}`, { code: "sensitive_file" });
    const target = await this.resolve(requested);
    if (isSensitivePath(relativeDisplay(this.root, target))) throw new SafetyError(`Refusing to read sensitive file: ${requested}`, { code: "sensitive_file" });
    const info = await stat(target);
    if (!info.isFile()) throw new AgentError(`${requested} is not a file.`, { code: "not_a_file" });
    if (info.size > this.limits.maxReadBytes) {
      throw new AgentError(`File is too large to read (${info.size} bytes).`, { code: "file_too_large" });
    }
    const buffer = await readFile(target);
    throwIfAborted(signal);
    if (isProbablyBinary(buffer)) throw new AgentError("Binary files cannot be read as text.", { code: "binary_file" });
    const lines = buffer.toString("utf8").replace(/\r\n/g, "\n").split("\n");
    const first = Math.max(1, Number.isInteger(startLine) ? startLine : 1);
    const last = Math.min(lines.length, Number.isInteger(endLine) ? endLine : lines.length);
    if (last < first) throw new AgentError("endLine must not be before startLine.", { code: "invalid_range" });
    return {
      path: relativeDisplay(this.root, target),
      startLine: first,
      endLine: last,
      totalLines: lines.length,
      content: lines.slice(first - 1, last).map((line, index) => `${first + index}: ${line}`).join("\n"),
    };
  }

  async listFiles(requested = ".", { recursive = true, maxDepth = 6, signal } = {}) {
    throwIfAborted(signal);
    if (isSensitivePath(requested)) throw new SafetyError(`Refusing to list sensitive path: ${requested}`, { code: "sensitive_file" });
    const target = await this.resolve(requested);
    if (isSensitivePath(relativeDisplay(this.root, target))) throw new SafetyError(`Refusing to list sensitive path: ${requested}`, { code: "sensitive_file" });
    const targetInfo = await stat(target);
    if (!targetInfo.isDirectory()) return { path: relativeDisplay(this.root, target), entries: [relativeDisplay(this.root, target)], truncated: false };
    const entries = [];
    let truncated = false;
    const depthLimit = Math.max(0, Math.min(20, Number.isInteger(maxDepth) ? maxDepth : 6));

    const visit = async (directory, depth) => {
      throwIfAborted(signal);
      if (entries.length >= this.limits.maxEntries) {
        truncated = true;
        return;
      }
      const children = await readdir(directory, { withFileTypes: true });
      throwIfAborted(signal);
      children.sort((left, right) => left.name.localeCompare(right.name));
      for (const child of children) {
        throwIfAborted(signal);
        if (entries.length >= this.limits.maxEntries) {
          truncated = true;
          break;
        }
        if (this.ignores.has(child.name)) continue;
        const full = path.join(directory, child.name);
        const relative = relativeDisplay(this.root, full);
        if (isSensitivePath(relative)) continue;
        if (child.isSymbolicLink()) {
          entries.push(`${relative} -> [symlink not followed]`);
        } else if (child.isDirectory()) {
          entries.push(`${relative}${path.sep}`);
          if (recursive && depth < depthLimit) await visit(full, depth + 1);
        } else if (child.isFile()) {
          entries.push(relative);
        }
      }
    };

    await visit(target, 0);
    return { path: relativeDisplay(this.root, target), entries, truncated };
  }

  async search(query, { path: requested = ".", regex = false, caseSensitive = false, signal } = {}) {
    throwIfAborted(signal);
    if (typeof query !== "string" || !query) throw new AgentError("Search query is required.", { code: "invalid_query" });
    if (query.length > 1_000) throw new AgentError("Search query is too long.", { code: "invalid_query" });
    if (regex) throw new SafetyError("Regular-expression search is disabled; use a literal query.", { code: "regex_disabled" });
    if (isSensitivePath(requested)) throw new SafetyError(`Refusing to search sensitive path: ${requested}`, { code: "sensitive_file" });
    const needle = caseSensitive ? query : query.toLowerCase();
    const target = await this.resolve(requested);
    if (isSensitivePath(relativeDisplay(this.root, target))) throw new SafetyError(`Refusing to search sensitive path: ${requested}`, { code: "sensitive_file" });
    const results = [];
    let filesScanned = 0;
    let entriesVisited = 0;
    let truncated = false;

    const inspect = async (file) => {
      throwIfAborted(signal);
      if (filesScanned >= this.limits.maxSearchFiles || results.length >= this.limits.maxResults) {
        truncated = true;
        return;
      }
      const info = await stat(file);
      throwIfAborted(signal);
      if (!info.isFile() || info.size > this.limits.maxSearchFileBytes) return;
      if (isSensitivePath(relativeDisplay(this.root, file))) return;
      filesScanned += 1;
      const buffer = await readFile(file);
      throwIfAborted(signal);
      if (isProbablyBinary(buffer)) return;
      const lines = buffer.toString("utf8").replace(/\r\n/g, "\n").split("\n");
      for (let index = 0; index < lines.length; index += 1) {
        const matches = (caseSensitive ? lines[index] : lines[index].toLowerCase()).includes(needle);
        if (matches) results.push({ path: relativeDisplay(this.root, file), line: index + 1, text: lines[index].slice(0, 500) });
        if (results.length >= this.limits.maxResults) {
          truncated = true;
          break;
        }
      }
    };

    const walk = async (entry, depth = 0) => {
      throwIfAborted(signal);
      if (truncated) return;
      if (depth > this.limits.maxSearchDepth || entriesVisited >= this.limits.maxEntries) {
        truncated = true;
        return;
      }
      const info = await stat(entry);
      throwIfAborted(signal);
      if (info.isFile()) return inspect(entry);
      const children = await readdir(entry, { withFileTypes: true });
      throwIfAborted(signal);
      for (const child of children) {
        throwIfAborted(signal);
        if (truncated) break;
        entriesVisited += 1;
        if (entriesVisited > this.limits.maxEntries) {
          truncated = true;
          break;
        }
        if (this.ignores.has(child.name) || child.isSymbolicLink()) continue;
        const full = path.join(entry, child.name);
        if (isSensitivePath(relativeDisplay(this.root, full))) continue;
        if (child.isDirectory()) await walk(full, depth + 1);
        else if (child.isFile()) await inspect(full);
      }
    };

    await walk(target);
    return { query, results, filesScanned, entriesVisited, truncated };
  }

  async #authorize(kind, description, risk = "caution", signal) {
    throwIfAborted(signal);
    if (this.readOnly) throw new SafetyError(`${kind} is disabled in read-only mode.`, { code: "read_only" });
    const decision = await this.approve({ kind, description, risk });
    throwIfAborted(signal);
    if (decision?.dryRun) return { dryRun: true };
    if (!decision?.approved) throw new SafetyError(`${kind} was not approved (${decision?.reason || "declined"}).`, { code: "approval_required" });
    return { dryRun: false };
  }

  async writeFile(requested, content, { allowSensitive = false, signal } = {}) {
    throwIfAborted(signal);
    if (!allowSensitive && isSensitivePath(requested)) throw new SafetyError(`Refusing to write sensitive file: ${requested}`, { code: "sensitive_file" });
    if (typeof content !== "string") throw new AgentError("File content must be text.", { code: "invalid_content" });
    if (byteLength(content) > this.limits.maxWriteBytes) throw new AgentError("File content exceeds the write limit.", { code: "file_too_large" });
    const target = await this.resolve(requested, { mustExist: false });
    if (!allowSensitive && isSensitivePath(relativeDisplay(this.root, target))) throw new SafetyError(`Refusing to write sensitive file: ${requested}`, { code: "sensitive_file" });
    const initialStamp = await fileStamp(target);
    const authorization = await this.#authorize("write_file", `Write ${relativeDisplay(this.root, target)} (${byteLength(content)} bytes)`, "caution", signal);
    if (authorization.dryRun) return { path: relativeDisplay(this.root, target), bytes: byteLength(content), changed: false, dryRun: true };
    throwIfAborted(signal);
    const confirmedTarget = await this.resolve(requested, { mustExist: false });
    if (confirmedTarget !== target || await fileStamp(confirmedTarget) !== initialStamp) {
      throw new AgentError("Target changed while approval was pending. Re-read it and try again.", { code: "file_changed" });
    }
    await mkdir(path.dirname(confirmedTarget), { recursive: true });
    throwIfAborted(signal);
    await writeFile(confirmedTarget, content, "utf8");
    return { path: relativeDisplay(this.root, confirmedTarget), bytes: byteLength(content), changed: true, dryRun: false };
  }

  async applyPatch(requested, patchText, { signal } = {}) {
    throwIfAborted(signal);
    if (isSensitivePath(requested)) throw new SafetyError(`Refusing to patch sensitive file: ${requested}`, { code: "sensitive_file" });
    if (typeof patchText !== "string" || byteLength(patchText) > this.limits.maxWriteBytes) {
      throw new AgentError("Patch is missing or exceeds the write limit.", { code: "invalid_patch" });
    }
    const target = await this.resolve(requested);
    if (isSensitivePath(relativeDisplay(this.root, target))) throw new SafetyError(`Refusing to patch sensitive file: ${requested}`, { code: "sensitive_file" });
    const info = await stat(target);
    if (!info.isFile()) throw new AgentError(`${requested} is not a file.`, { code: "not_a_file" });
    if (info.size > this.limits.maxWriteBytes) throw new AgentError("Target file exceeds the write limit.", { code: "file_too_large" });
    const source = await readFile(target, "utf8");
    const initialStamp = await fileStamp(target);
    const normalized = applyUnifiedPatch(source, patchText);
    const updated = source.includes("\r\n") ? normalized.replace(/\n/g, "\r\n") : normalized;
    const authorization = await this.#authorize("apply_patch", `Patch ${relativeDisplay(this.root, target)}`, "caution", signal);
    if (authorization.dryRun) return { path: relativeDisplay(this.root, target), changed: source !== updated, dryRun: true };
    throwIfAborted(signal);
    const confirmedTarget = await this.resolve(requested);
    const confirmedInfo = await stat(confirmedTarget);
    if (
      confirmedTarget !== target
      || !confirmedInfo.isFile()
      || confirmedInfo.size > this.limits.maxWriteBytes
      || await fileStamp(confirmedTarget) !== initialStamp
      || await readFile(confirmedTarget, "utf8") !== source
    ) {
      throw new AgentError("Target changed while approval was pending. Re-read it and try again.", { code: "file_changed" });
    }
    throwIfAborted(signal);
    await writeFile(confirmedTarget, updated, "utf8");
    return { path: relativeDisplay(this.root, confirmedTarget), changed: source !== updated, dryRun: false };
  }

  async runCommand(command, { cwd = ".", timeoutMs, signal } = {}) {
    throwIfAborted(signal);
    const classification = classifyCommand(command);
    if (classification.level === "blocked") {
      throw new SafetyError(`Command blocked: ${classification.reason}.`, { code: "command_blocked", details: classification });
    }
    const directory = await this.resolve(cwd);
    const info = await stat(directory);
    if (!info.isDirectory()) throw new AgentError("Command working directory is not a directory.", { code: "invalid_cwd" });
    const authorization = await this.#authorize("run_command", `[${classification.level}] ${command}`, classification.level, signal);
    if (authorization.dryRun) return { command, cwd: relativeDisplay(this.root, directory), risk: classification, dryRun: true };
    throwIfAborted(signal);
    const limitedTimeout = Math.max(100, Math.min(600_000, Number.isFinite(timeoutMs) ? timeoutMs : this.limits.timeoutMs));
    const result = await runProcess(command, [], {
      cwd: directory,
      timeoutMs: limitedTimeout,
      maxOutputBytes: this.limits.maxOutputBytes,
      shell: true,
      signal,
    });
    return { ...result, command, cwd: relativeDisplay(this.root, directory), risk: classification, dryRun: false };
  }

  async gitDiff({ staged = false, path: requested, signal } = {}) {
    throwIfAborted(signal);
    const root = await this.resolve(".");
    const gitExecutable = await resolveTrustedExecutable("git", { excludeRoot: root });
    throwIfAborted(signal);
    const metadata = await inspectGitRepository(gitExecutable, root, {
      signal,
      maxOutputBytes: Math.min(this.limits.maxOutputBytes, 64_000),
    });
    throwIfAborted(signal);

    let sandbox;
    try {
      sandbox = await createGitDiffSandbox(metadata);
      throwIfAborted(signal);
      const environment = isolatedGitEnvironment(root, { GIT_INDEX_FILE: metadata.indexPath });
      const baseArgs = [
        "--no-pager",
        "--no-optional-locks",
        `--git-dir=${sandbox.gitDir}`,
        `--work-tree=${root}`,
        "--literal-pathspecs",
        "-c", "core.bare=false",
        "-c", "core.fsmonitor=false",
        "-c", "diff.external=",
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--ignore-submodules=dirty",
        "--no-color",
        "--no-renames",
      ];
      if (staged) baseArgs.push("--staged");
      const nameArgs = [...baseArgs, "--name-only", "-z"];
      if (requested) {
        if (isSensitivePath(requested)) throw new SafetyError(`Refusing to diff sensitive path: ${requested}`, { code: "sensitive_file" });
        const target = await this.resolve(requested, { mustExist: false });
        nameArgs.push("--", relativeDisplay(root, target));
      }
      const nameResult = await runProcess(gitExecutable, nameArgs, {
        cwd: root,
        timeoutMs: 30_000,
        maxOutputBytes: this.limits.maxOutputBytes,
        signal,
        environment,
      });
      if (nameResult.exitCode !== 0) throw new AgentError(nameResult.stderr.trim() || "Unable to inspect Git changes.", { code: "git_error" });
      const changedPaths = [...new Set(nameResult.stdout.split("\0").filter(Boolean))];
      const safePaths = changedPaths.filter((changedPath) => (
        isContainedGitPath(root, changedPath) && !isSensitivePath(changedPath)
      ));
      const selectedPaths = safePaths.slice(0, 500);
      const secretsOmitted = safePaths.length !== changedPaths.length;
      if (!selectedPaths.length) {
        return { diff: "", staged, truncated: nameResult.truncated || safePaths.length > selectedPaths.length, secretsOmitted };
      }
      const result = await runProcess(gitExecutable, [...baseArgs, "--", ...selectedPaths], {
        cwd: root,
        timeoutMs: 30_000,
        maxOutputBytes: this.limits.maxOutputBytes,
        signal,
        environment,
      });
      if (result.exitCode !== 0) throw new AgentError(result.stderr.trim() || "Unable to read Git diff.", { code: "git_error" });
      return {
        diff: result.stdout,
        staged,
        truncated: nameResult.truncated || result.truncated || safePaths.length > selectedPaths.length,
        secretsOmitted,
      };
    } finally {
      if (sandbox?.directory) await rm(sandbox.directory, { recursive: true, force: true }).catch(() => {});
    }
  }

  async isWritable() {
    try {
      await access(this.root, fsConstants.W_OK);
      return true;
    } catch {
      return false;
    }
  }

  async executeTool(name, args = {}, options = {}) {
    throwIfAborted(options.signal);
    switch (name) {
      case "read_file": return this.readFile(args.path, { ...args, signal: options.signal });
      case "list_files": return this.listFiles(args.path, { ...args, signal: options.signal });
      case "search": return this.search(args.query, { ...args, signal: options.signal });
      case "write_file": return this.writeFile(args.path, args.content, { signal: options.signal });
      case "apply_patch": return this.applyPatch(args.path, args.patch, { signal: options.signal });
      case "run_command": return this.runCommand(args.command, { ...args, signal: options.signal });
      case "git_diff": return this.gitDiff({ ...args, signal: options.signal });
      default: throw new AgentError(`Unknown tool: ${name}`, { code: "unknown_tool" });
    }
  }
}

export { DEFAULT_LIMITS };
