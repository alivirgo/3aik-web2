import path from "node:path";
import { constants as fsConstants } from "node:fs";
import { access, lstat, realpath, stat } from "node:fs/promises";
import { SafetyError } from "./errors.js";

export const DEFAULT_IGNORES = Object.freeze([
  ".git",
  ".hg",
  ".svn",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
  ".wrangler",
  ".idea",
  ".vscode",
  "node_modules",
  "bower_components",
  "coverage",
  "dist",
  "build",
  "out",
  "target",
  "vendor",
  "__pycache__",
  ".venv",
  "venv",
]);

const SENSITIVE_NAMES = new Set([
  ".npmrc",
  ".pypirc",
  ".netrc",
  "_netrc",
  ".envrc",
  ".dev.vars",
  ".git-credentials",
  ".gitmodules",
  ".dockercfg",
  "gradle.properties",
  "keystore.properties",
  "signing.properties",
  "id_rsa",
  "id_ed25519",
  "id_ecdsa",
  "id_dsa",
]);
const SENSITIVE_DIRECTORIES = new Set([".git", ".ssh", ".gnupg", ".aws", ".azure", ".kube", ".docker", ".direnv", ".wrangler", "credentials", "secrets"]);
const SENSITIVE_EXTENSIONS = new Set([".pem", ".key", ".p12", ".pfx", ".jks", ".keystore", ".kdbx", ".tfstate", ".tfvars"]);

export function isSensitivePath(value) {
  if (typeof value !== "string") return false;
  const parts = value.split(/[\\/]+/).filter(Boolean).map((part) => part.toLowerCase());
  if (!parts.length) return false;
  if (parts.some((part) => SENSITIVE_DIRECTORIES.has(part))) return true;
  const name = parts.at(-1);
  if (name === "config.json" && parts.slice(0, -1).some((part) => part === "3aik" || part === ".3aik")) return true;
  if (SENSITIVE_NAMES.has(name) || name === ".env" || name.startsWith(".env.") || name === ".dev.vars" || name.startsWith(".dev.vars.")) return true;
  if (/\.tfstate(?:\..+)?$/i.test(name)) return true;
  if (/^(?:credentials?|secrets?)(?:\.|$)/i.test(name)) return true;
  return SENSITIVE_EXTENSIONS.has(path.extname(name));
}

function comparable(value) {
  const normalized = path.resolve(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

export function isPathInside(root, candidate) {
  const base = comparable(root);
  const target = comparable(candidate);
  return target === base || target.startsWith(`${base}${path.sep}`);
}

function environmentValue(environment, name) {
  const entry = Object.entries(environment || {}).find(([key, value]) => key.toUpperCase() === name && typeof value === "string");
  return entry?.[1] || "";
}

export async function resolveTrustedExecutable(name, { environment = process.env, excludeRoot } = {}) {
  if (typeof name !== "string" || !/^[a-zA-Z0-9._-]+$/.test(name)) {
    throw new SafetyError("Executable name is invalid.", { code: "invalid_executable" });
  }
  const searchPath = environmentValue(environment, "PATH");
  const extensions = process.platform === "win32" && !path.extname(name)
    ? environmentValue(environment, "PATHEXT").split(";").filter(Boolean).map((value) => value.startsWith(".") ? value : `.${value}`)
    : [""];
  const candidates = extensions.length ? extensions : [".EXE", ".CMD", ".BAT", ".COM"];
  const excluded = excludeRoot ? path.resolve(excludeRoot) : null;

  for (const rawEntry of searchPath.split(path.delimiter)) {
    const entry = rawEntry.trim().replace(/^"(.*)"$/, "$1");
    if (!entry) continue;
    const directory = path.resolve(entry);
    if (excluded && isPathInside(excluded, directory)) continue;
    for (const extension of candidates) {
      try {
        const resolved = await realpath(path.join(directory, `${name}${extension}`));
        if (excluded && isPathInside(excluded, resolved)) continue;
        if (!(await stat(resolved)).isFile()) continue;
        await access(resolved, fsConstants.X_OK);
        return resolved;
      } catch (error) {
        if (["ENOENT", "EACCES", "ENOTDIR"].includes(error?.code)) continue;
        throw error;
      }
    }
  }
  throw new SafetyError(`Could not find a trusted ${name} executable outside the workspace.`, { code: "trusted_executable_not_found" });
}

export function resolveLexicalPath(root, requested = ".") {
  if (typeof requested !== "string" || requested.includes("\0")) {
    throw new SafetyError("Path must be a valid string.", { code: "invalid_path" });
  }
  const base = path.resolve(root);
  const candidate = path.resolve(base, requested || ".");
  if (!isPathInside(base, candidate)) {
    throw new SafetyError(`Path escapes the workspace: ${requested}`, { code: "path_escape" });
  }
  return candidate;
}

async function nearestExisting(target) {
  let current = target;
  const suffix = [];
  while (true) {
    try {
      await lstat(current);
      return { existing: current, suffix };
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      suffix.unshift(path.basename(current));
      current = parent;
    }
  }
}

export async function resolveWorkspacePath(root, requested = ".", { mustExist = true } = {}) {
  const base = await realpath(path.resolve(root));
  const candidate = resolveLexicalPath(base, requested);
  let resolved;

  try {
    resolved = await realpath(candidate);
  } catch (error) {
    if (mustExist || error?.code !== "ENOENT") throw error;
    const { existing, suffix } = await nearestExisting(candidate);
    const realExisting = await realpath(existing);
    resolved = path.join(realExisting, ...suffix);
  }

  if (!isPathInside(base, resolved)) {
    throw new SafetyError(`Path resolves outside the workspace: ${requested}`, { code: "symlink_escape" });
  }
  return resolved;
}

const BLOCKED_PATTERNS = [
  { re: /(?:^|[\s"'`=\\/])\.?3aik[\\/]config\.json(?:$|[\s"'`;&|)])/i, reason: "command references the 3aik credential-bearing config" },
  { re: /\b3aik(?:\.(?:js|cmd|exe))?\s+config\s+get\s+apiKey\b/i, reason: "command requests a stored API credential" },
  { re: /(?:^|[\s"'`=\\/])(?:\.env(?:\.[^\s"'`\\/]*)?|\.dev\.vars(?:\.[^\s"'`\\/]*)?|\.envrc|\.npmrc|\.pypirc|\.netrc|_netrc|\.git-credentials|\.gitmodules|\.git[\\/]config|\.dockercfg|\.ssh|\.gnupg|\.aws|\.azure|\.kube|\.docker|\.direnv|\.wrangler|(?:gradle|keystore|signing)\.properties|id_(?:rsa|ed25519|ecdsa|dsa)|(?:credentials?|secrets?)(?:\.[^\s"'`\\/]*)?|[^\s"'`\\/]+\.(?:pem|key|p12|pfx|jks|keystore|kdbx|tfstate(?:\.[^\s"'`\\/]*)?|tfvars))(?:$|[\s"'`;&|)\\/])/i, reason: "command references a sensitive file" },
  { re: /^\s*(?:env|printenv|set)\s*(?:$|[|>&])/i, reason: "command dumps the process environment" },
  { re: /\b(?:Get-ChildItem|Get-Item|gci|gi|dir|ls)\s+(?:-Path\s+)?Env:/i, reason: "command dumps the process environment" },
  { re: /\[Environment\]::GetEnvironmentVariables\s*\(/i, reason: "command dumps the process environment" },
  { re: /(?:^|[;&|]\s*)rm\s+(?:-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\s+(?:\/|~|\$HOME)(?:\s|$)/i, reason: "recursive deletion of a broad system path" },
  { re: /\b(?:format|diskpart|mkfs(?:\.[a-z0-9]+)?|fdisk)\b/i, reason: "disk formatting or partitioning" },
  { re: /\b(?:shutdown|reboot|poweroff|halt)\b/i, reason: "system power control" },
  { re: /\b(?:Remove-Item|del|erase|rmdir)\b[^\r\n]*(?:\\|\/)\s*(?:-Recurse|-r|-s)?/i, reason: "broad filesystem deletion" },
  { re: /\b(?:curl|wget|Invoke-WebRequest|iwr)\b[^\r\n]*\|\s*(?:sh|bash|zsh|pwsh|powershell)\b/i, reason: "downloaded code piped directly to a shell" },
  { re: /:\(\)\s*\{\s*:\|:\s*&\s*\}\s*;/, reason: "fork bomb" },
];

const DANGEROUS_PATTERNS = [
  /\bgit\s+(?:reset\s+--hard|clean\s+-[^\s]*f|checkout\s+--|restore\s+[^\r\n]*--worktree)\b/i,
  /\b(?:rm|rmdir|del|erase|Remove-Item)\b/i,
  /\b(?:npm|pnpm|yarn)\s+(?:publish|unpublish)\b/i,
  /\b(?:git\s+push\b[^\r\n]*(?:--force|-f)\b|gh\s+repo\s+delete)\b/i,
  /\b(?:DROP|TRUNCATE)\s+(?:DATABASE|TABLE)\b/i,
  /\b(?:sudo|runas)\b/i,
];

const CAUTION_PATTERNS = [
  /\b(?:npm|pnpm|yarn)\s+(?:install|add|remove|update|upgrade)\b/i,
  /\b(?:pip|pip3|uv)\s+(?:install|uninstall|sync)\b/i,
  /\b(?:git\s+(?:commit|push|pull|merge|rebase|checkout|switch|restore|stash)|gh\s+pr\s+(?:create|merge))\b/i,
  /\b(?:wrangler|vercel|netlify|firebase)\s+(?:deploy|publish)\b/i,
  /(?:^|\s)(?:>|>>)(?:\s|[^&])/,
  /\b(?:mv|move|cp|copy|mkdir|New-Item|Set-Content|Add-Content)\b/i,
];

export function classifyCommand(command) {
  if (typeof command !== "string" || !command.trim()) {
    return { level: "blocked", reason: "empty command" };
  }
  if (command.includes("\0") || command.length > 20_000) {
    return { level: "blocked", reason: "invalid or excessively long command" };
  }
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.re.test(command)) return { level: "blocked", reason: pattern.reason };
  }
  if (DANGEROUS_PATTERNS.some((pattern) => pattern.test(command))) {
    return { level: "dangerous", reason: "command may destroy data or alter remote state" };
  }
  if (CAUTION_PATTERNS.some((pattern) => pattern.test(command))) {
    return { level: "caution", reason: "command changes files, dependencies, source control, or deployments" };
  }
  return { level: "safe", reason: "no known high-risk operation detected" };
}

const SAFE_CHILD_ENV_NAMES = new Set([
  "ANDROID_HOME", "ANDROID_SDK_ROOT", "APPDATA", "CARGO_HOME", "CHROME_BIN", "CI", "COLORTERM",
  "COMMONPROGRAMFILES", "COMMONPROGRAMFILES(X86)", "COMSPEC", "CONDA_PREFIX", "COREPACK_HOME", "CUDA_PATH",
  "DOTNET_ROOT", "FORCE_COLOR", "GOPATH", "GOROOT", "GOMODCACHE", "GRADLE_USER_HOME", "HOME", "JAVA_HOME",
  "LANG", "LANGUAGE", "LOCALAPPDATA", "LOGNAME", "NO_COLOR", "NUMBER_OF_PROCESSORS", "NPM_CONFIG_CACHE",
  "NPM_CONFIG_PREFIX", "NVM_BIN", "NVM_HOME", "NVM_SYMLINK", "OS", "PATH", "PATHEXT", "PLAYWRIGHT_BROWSERS_PATH",
  "PNPM_HOME", "PROCESSOR_ARCHITECTURE", "PROGRAMDATA", "PROGRAMFILES", "PROGRAMFILES(X86)", "RUSTUP_HOME",
  "SHELL", "SYSTEMDRIVE", "SYSTEMROOT", "TEMP", "TERM", "TERM_PROGRAM", "TERM_PROGRAM_VERSION", "TMP", "TMPDIR",
  "TZ", "USER", "USERNAME", "USERPROFILE", "VIRTUAL_ENV", "VOLTA_HOME", "WINDIR",
]);

export function scrubEnvironment(environment = process.env) {
  const safe = Object.fromEntries(Object.entries(environment).filter(([name, value]) => {
    const normalized = name.toUpperCase();
    return value !== undefined && (SAFE_CHILD_ENV_NAMES.has(normalized) || /^LC_[A-Z0-9_]+$/.test(normalized));
  }));
  safe.GIT_TERMINAL_PROMPT = "0";
  safe.GCM_INTERACTIVE = "Never";
  return safe;
}

export function createApprovalPolicy({ yes = false, dryRun = false, confirm } = {}) {
  return async ({ kind, description, risk = "caution" }) => {
    if (dryRun) return { approved: false, dryRun: true, reason: "dry-run" };
    if (yes) return { approved: true, dryRun: false, reason: "--yes" };
    if (typeof confirm !== "function") {
      return { approved: false, dryRun: false, reason: "confirmation unavailable" };
    }
    const approved = Boolean(await confirm({ kind, description, risk }));
    return { approved, dryRun: false, reason: approved ? "confirmed" : "declined" };
  };
}
