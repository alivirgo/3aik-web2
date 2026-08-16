import path from "node:path";
import { spawnSync } from "node:child_process";
import { rm, rename } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npmCli = process.env.npm_execpath || (process.platform === "win32" ? path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js") : "");
const executable = npmCli ? process.execPath : "npm";
const packed = spawnSync(executable, [...(npmCli ? [npmCli] : []), "pack", "--json", "--ignore-scripts"], {
  cwd: root,
  encoding: "utf8",
  windowsHide: true,
});
if (packed.status !== 0) {
  process.stderr.write(packed.stderr || packed.stdout);
  process.exit(packed.status || 1);
}

const [{ filename }] = JSON.parse(packed.stdout);
const source = path.join(root, filename);
const target = path.join(root, "3aik-cli.tgz");
await rm(target, { force: true });
await rename(source, target);
process.stdout.write(`${target}\n`);
