import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { exec, execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

test("packed release installs into a fresh prefix and runs its Windows-compatible bin", { timeout: 60_000 }, async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "3aik-pack-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const npmCli = process.env.npm_execpath || (process.platform === "win32" ? path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js") : "");
  const npm = npmCli ? process.execPath : "npm";
  const npmArgs = npmCli ? [npmCli] : [];
  const packed = await execFileAsync(npm, [...npmArgs, "pack", "--json", "--ignore-scripts", "--pack-destination", temporary], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
  const [{ filename, bundled, files }] = JSON.parse(packed.stdout);
  assert(bundled.includes("@3aik/agent-core"));
  const paths = new Set(files.map((file) => file.path.replaceAll("\\", "/")));
  for (const required of [
    "LICENSE",
    "README.md",
    "bin/3aik.js",
    "node_modules/@3aik/agent-core/LICENSE",
    "node_modules/@3aik/agent-core/README.md",
    "node_modules/@3aik/agent-core/src/index.js",
  ]) assert(paths.has(required), `packed artifact is missing ${required}`);
  const tarball = path.join(temporary, filename);
  const prefix = path.join(temporary, "prefix");
  await execFileAsync(npm, [...npmArgs, "install", "--global", "--prefix", prefix, "--ignore-scripts", "--no-audit", "--no-fund", tarball], {
    cwd: temporary,
    encoding: "utf8",
    windowsHide: true,
  });
  const executable = process.platform === "win32" ? path.join(prefix, "3aik.cmd") : path.join(prefix, "bin", "3aik");
  const result = await execAsync(`"${executable}" --version`, { windowsHide: true });
  assert.equal(result.stdout.trim(), "3.0.0");
});
