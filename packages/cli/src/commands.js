import path from "node:path";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import { stat } from "node:fs/promises";
import {
  AgentError,
  CodingAgent,
  LocalWorkspace,
  OpenAICompatibleClient,
  ThreeAikClient,
  createApprovalPolicy,
  resolveTrustedExecutable,
  scrubEnvironment,
} from "@3aik/agent-core";
import { CONFIG_KEYS, DEFAULT_CONFIG, PROVIDER_PRESETS, loadConfig, parseConfigValue, saveGlobalConfig } from "./config.js";
import { readStdin } from "./ui.js";

const execFileAsync = promisify(execFile);

export const VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

const MAX_PROPOSAL_PREVIEW = 64_000;

export function sanitizeTerminalText(value) {
  const input = String(value ?? "");
  let output = "";
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    if (code === 0x1b) {
      const introducer = input.charCodeAt(index + 1);
      index += 1;
      if (introducer === 0x5b) {
        while (index + 1 < input.length) {
          const next = input.charCodeAt(index + 1);
          index += 1;
          if (next >= 0x40 && next <= 0x7e) break;
        }
      } else if ([0x50, 0x5d, 0x5e, 0x5f].includes(introducer)) {
        while (index + 1 < input.length) {
          const next = input.charCodeAt(index + 1);
          index += 1;
          if (next === 0x07) break;
          if (next === 0x1b && input.charCodeAt(index + 1) === 0x5c) {
            index += 1;
            break;
          }
        }
      }
      continue;
    }
    if ((code >= 0x00 && code <= 0x08) || (code >= 0x0b && code <= 0x1f) || (code >= 0x7f && code <= 0x9f)) continue;
    output += input[index];
  }
  return output;
}

export function proposalPreview(call) {
  const value = call?.name === "apply_patch"
    ? call?.arguments?.patch
    : call?.name === "write_file"
      ? call?.arguments?.content
      : undefined;
  if (typeof value !== "string") return "";
  const safe = sanitizeTerminalText(value);
  if (safe.length <= MAX_PROPOSAL_PREVIEW) return safe;
  return `${safe.slice(0, MAX_PROPOSAL_PREVIEW)}\n[proposal preview truncated after ${MAX_PROPOSAL_PREVIEW.toLocaleString("en-US")} characters]`;
}

export const HELP = `3aik ${VERSION} — AI chat and a local-first coding agent

Usage:
  3aik chat [prompt]                 Stream a response; interactive without a prompt
  3aik agent [prompt]                Inspect, edit, and test the current workspace
  3aik review [path] [--staged]      Review the Git diff without write access
  3aik doctor                        Check Node, Git, workspace, and API health
  3aik models                        Check the provider and list available models
  3aik config [get|set|unset|path]   View or change global configuration
  3aik init                          Create .3aik project configuration

Global options:
  -C, --cwd <path>       Workspace (default: current directory)
  -y, --yes              Approve local writes and non-blocked commands
      --dry-run          Show proposed writes/commands without executing them
      --read-only        Disable writes, patches, and commands
      --api-base <url>   API base (default: https://3aik.com)
      --provider <name>  3aik, ollama, lmstudio, llamacpp, openai-compatible
      --base-url <url>   Override the provider's OpenAI-compatible base URL
      --model <id>       Local model ID
      --api-key <value>  Optional local/provider API key (prefer THREEAIK_API_KEY)
      --timeout <ms>     API and command timeout
      --max-output <n>   Maximum captured command bytes
      --mode <mode>      chat, deep, or code
      --max-tokens <n>   256–8192
      --temperature <n>  0–1.2
      --no-color         Disable ANSI color
  -h, --help             Show help
  -v, --version          Show version

Safety:
  Tool paths cannot escape the workspace, symlinks are not followed during scans,
  destructive system commands are blocked, and writes/commands ask first unless
  --yes is supplied. Use --dry-run to inspect an agent's proposed actions.
  These controls reduce accidental damage; they are not an OS sandbox.`;

function toolSummary(result) {
  if (!result || typeof result !== "object") return "done";
  if (result.dryRun) return "dry-run; no changes made";
  if (result.path) return result.changed === false ? `${result.path} (unchanged)` : result.path;
  if (Number.isInteger(result.exitCode)) return `exit ${result.exitCode}${result.truncated ? ", output truncated" : ""}`;
  if (Array.isArray(result.entries)) return `${result.entries.length} entries${result.truncated ? " (truncated)" : ""}`;
  if (Array.isArray(result.results)) return `${result.results.length} matches${result.truncated ? " (truncated)" : ""}`;
  return "done";
}

async function projectInstructions(workspace) {
  try {
    const result = await workspace.readFile(".3aik/instructions.md");
    return result.content.slice(0, 700);
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    return "";
  }
}

export async function createRuntime(parsed, { ui, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const cwd = path.resolve(parsed.options.cwd || process.cwd());
  const loaded = await loadConfig({ cwd, env });
  const provider = parsed.options.provider || loaded.config.provider;
  const providerChanged = parsed.options.provider && parsed.options.provider !== loaded.config.provider;
  const config = {
    ...loaded.config,
    provider,
    ...(providerChanged ? { baseUrl: PROVIDER_PRESETS[provider].baseUrl } : {}),
    ...(parsed.options.apiBase !== undefined ? { baseUrl: parsed.options.apiBase } : {}),
    ...(parsed.options.baseUrl !== undefined ? { baseUrl: parsed.options.baseUrl } : {}),
    ...(parsed.options.model !== undefined ? { model: parsed.options.model } : {}),
    ...(parsed.options.apiKey !== undefined ? { apiKey: parsed.options.apiKey } : {}),
    ...(parsed.options.mode !== undefined ? { mode: parsed.options.mode } : {}),
    ...(parsed.options.temperature !== undefined ? { temperature: parsed.options.temperature } : {}),
    ...(parsed.options.maxTokens !== undefined ? { maxTokens: parsed.options.maxTokens } : {}),
    ...(parsed.options.timeoutMs !== undefined ? { timeoutMs: parsed.options.timeoutMs } : {}),
    ...(parsed.options.maxOutputBytes !== undefined ? { maxOutputBytes: parsed.options.maxOutputBytes } : {}),
  };
  const approve = createApprovalPolicy({
    yes: parsed.options.yes,
    dryRun: parsed.options.dryRun,
    confirm: (request) => ui.confirm({
      ...request,
      description: sanitizeTerminalText(request.description),
    }),
  });
  const workspace = new LocalWorkspace(cwd, {
    approve,
    readOnly: parsed.options.readOnly,
    limits: { timeoutMs: config.timeoutMs, maxOutputBytes: config.maxOutputBytes },
  });
  const client = config.provider === "3aik"
    ? new ThreeAikClient({
        apiBase: config.baseUrl,
        timeoutMs: config.timeoutMs,
        fetchImpl,
        headers: { "x-3aik-device": config.deviceId },
      })
    : new OpenAICompatibleClient({
        baseUrl: config.baseUrl,
        model: config.model,
        apiKey: config.apiKey,
        timeoutMs: config.timeoutMs,
        fetchImpl,
      });
  return { cwd, config, globalConfig: loaded.globalConfig, configPath: loaded.configPath, workspace, client };
}

async function streamOne(client, ui, prompt, config, messages, signal) {
  messages.push({ role: "user", content: prompt.slice(0, 12_000) });
  while (messages.length > 24 || messages.reduce((total, message) => total + message.content.length, 0) > 52_000) {
    messages.splice(0, Math.min(2, messages.length - 1));
  }
  let content = "";
  for await (const delta of client.streamChat({
    messages: messages.slice(-24),
    mode: config.mode,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
    signal,
  })) {
    content += delta;
    ui.write(sanitizeTerminalText(delta));
  }
  ui.line();
  messages.push({ role: "assistant", content });
  return content;
}

export async function runChat(runtime, parsed, ui, signal) {
  let prompt = parsed.positionals.join(" ").trim();
  if (!prompt && !ui.input.isTTY) prompt = await readStdin(ui.input);
  const messages = [];
  if (prompt) {
    await streamOne(runtime.client, ui, prompt, runtime.config, messages, signal);
    return 0;
  }

  ui.line(ui.style(`3aik chat · ${runtime.config.mode} · /help for commands`, "dim"));
  while (true) {
    const input = (await ui.question(ui.style("you › ", "cyan", "bold"))).trim();
    if (!input) continue;
    if (["/exit", "/quit"].includes(input)) return 0;
    if (input === "/clear") {
      messages.length = 0;
      ui.line("Conversation cleared.");
      continue;
    }
    if (input === "/help") {
      ui.line("/mode chat|deep|code · /clear · /exit");
      continue;
    }
    if (input.startsWith("/mode ")) {
      const mode = input.slice(6).trim();
      if (!["chat", "deep", "code"].includes(mode)) ui.warn("Mode must be chat, deep, or code.");
      else {
        runtime.config.mode = mode;
        ui.line(`Mode: ${mode}`);
      }
      continue;
    }
    ui.write(ui.style("3aik › ", "green", "bold"));
    await streamOne(runtime.client, ui, input, runtime.config, messages, signal);
  }
}

export function agentEvents(ui) {
  return async (event) => {
    if (event.type === "tool_start") {
      const args = sanitizeTerminalText(JSON.stringify(event.call.arguments) || "{}");
      const name = sanitizeTerminalText(event.call.name);
      ui.line(ui.style(`→ ${name} ${args.length > 180 ? `${args.slice(0, 177)}...` : args}`, "cyan"));
      const preview = proposalPreview(event.call);
      if (preview) {
        const label = event.call.name === "apply_patch" ? "Proposed patch" : "Proposed file content";
        ui.line(ui.style(`${label} (review before approving):`, "yellow", "bold"));
        ui.line(preview);
      }
    } else if (event.type === "tool_end") {
      ui.line(ui.style(`✓ ${sanitizeTerminalText(event.call.name)}: ${sanitizeTerminalText(toolSummary(event.result))}`, "green"));
    } else if (event.type === "tool_error") {
      ui.warn(`! ${sanitizeTerminalText(event.call.name)}: ${sanitizeTerminalText(event.error.message)}`);
    } else if (event.type === "protocol_error") {
      ui.warn("The model sent a malformed tool request; asking it to repair the request.");
    }
  };
}

export async function runAgent(runtime, parsed, ui, signal) {
  let prompt = parsed.positionals.join(" ").trim();
  if (!prompt && !ui.input.isTTY) prompt = await readStdin(ui.input);
  const agent = new CodingAgent({
    client: runtime.client,
    workspace: runtime.workspace,
    maxIterations: runtime.config.maxIterations,
    maxTokens: runtime.config.maxTokens,
    systemPrompt: await projectInstructions(runtime.workspace),
  });
  let history = [];
  const execute = async (value) => {
    const result = await agent.run(value, { signal, history, onEvent: agentEvents(ui) });
    history = result.messages;
    ui.line();
    ui.line(sanitizeTerminalText(result.content));
  };
  if (prompt) {
    await execute(prompt);
    return 0;
  }

  ui.line(ui.style(`3aik agent · ${runtime.cwd}`, "dim"));
  ui.line(ui.style("Local writes and commands require approval. /clear · /exit", "dim"));
  while (true) {
    const input = (await ui.question(ui.style("agent › ", "cyan", "bold"))).trim();
    if (!input) continue;
    if (["/exit", "/quit"].includes(input)) return 0;
    if (input === "/clear") {
      history = [];
      ui.line("Agent context cleared.");
      continue;
    }
    await execute(input);
  }
}

export async function runReview(runtime, parsed, ui, signal) {
  const requested = parsed.positionals[0];
  const diff = await runtime.workspace.gitDiff({ staged: parsed.options.staged, path: requested });
  if (!diff.diff.trim()) {
    ui.line(`No ${parsed.options.staged ? "staged " : ""}changes to review${requested ? ` in ${requested}` : ""}.`);
    return 0;
  }
  const reviewWorkspace = new LocalWorkspace(runtime.cwd, {
    readOnly: true,
    limits: { maxOutputBytes: runtime.config.maxOutputBytes },
  });
  const agent = new CodingAgent({
    client: runtime.client,
    workspace: reviewWorkspace,
    maxIterations: runtime.config.maxIterations,
    maxTokens: runtime.config.maxTokens,
    systemPrompt: "Review only. Prioritize correctness, security, regressions, and missing tests. Cite files and lines. Do not request mutations or commands.",
  });
  const omission = diff.secretsOmitted ? "\n[Sensitive-file diff sections were omitted locally.]" : "";
  const excerpt = diff.diff.length > 9_000 ? `${diff.diff.slice(0, 9_000)}\n[diff truncated; use read_file/search for context]${omission}` : `${diff.diff}${omission}`;
  const prompt = `Review this ${parsed.options.staged ? "staged " : ""}Git diff. Report findings by severity; if there are no material findings, say so.\n\n${excerpt}`;
  const result = await agent.run(prompt, { signal, onEvent: agentEvents(ui) });
  ui.line(sanitizeTerminalText(result.content));
  return 0;
}

export async function runDoctor(runtime, parsed, ui) {
  const checks = [];
  const record = (name, ok, detail) => checks.push({ name, ok, detail });
  const major = Number(process.versions.node.split(".")[0]);
  record("Node.js", major >= 24, process.version);
  try {
    await runtime.workspace.verify();
    record("Workspace", true, runtime.cwd);
    const writable = await runtime.workspace.isWritable();
    record("Workspace write access", writable, writable ? "available" : "read-only");
  } catch (error) {
    record("Workspace", false, error.message);
  }
  try {
    const gitExecutable = await resolveTrustedExecutable("git", { excludeRoot: runtime.cwd });
    const { stdout } = await execFileAsync(gitExecutable, ["--version"], {
      cwd: runtime.cwd,
      env: scrubEnvironment(process.env),
      timeout: 10_000,
      windowsHide: true,
    });
    record("Git", true, stdout.trim());
  } catch (error) {
    record("Git", false, error.message);
  }
  try {
    const health = await runtime.client.health();
    record("Model provider", ["ok", "ready"].includes(health?.status), `${runtime.config.provider} · ${runtime.config.baseUrl} · ${health?.status || "unknown"}`);
  } catch (error) {
    record("Model provider", false, error.message);
  }

  if (parsed.options.json) ui.line(JSON.stringify({ ok: checks.every((check) => check.ok), checks }, null, 2));
  else for (const check of checks) ui.line(`${check.ok ? ui.style("✓", "green") : ui.style("✗", "red")} ${sanitizeTerminalText(check.name)}: ${sanitizeTerminalText(check.detail)}`);
  return checks.every((check) => check.ok) ? 0 : 1;
}

export async function runConfig(runtime, parsed, ui) {
  const [action, key, ...rest] = parsed.positionals;
  if (!action) {
    ui.line(JSON.stringify({ ...runtime.config, apiKey: runtime.config.apiKey ? "[configured]" : "" }, null, 2));
    ui.line(ui.style(`Global: ${runtime.configPath}`, "dim"));
    return 0;
  }
  if (action === "path") {
    ui.line(runtime.configPath);
    return 0;
  }
  if (action === "get") {
    if (!CONFIG_KEYS.includes(key)) throw new AgentError(`Unknown config key: ${key || "(missing)"}`, { code: "invalid_config_key" });
    ui.line(key === "apiKey" ? (runtime.config.apiKey ? "[configured]" : "") : String(runtime.config[key]));
    return 0;
  }
  if (action !== "set" && action !== "unset") throw new AgentError("config action must be get, set, unset, or path.", { code: "invalid_argument" });
  if (!CONFIG_KEYS.includes(key)) throw new AgentError(`Unknown config key: ${key || "(missing)"}`, { code: "invalid_config_key" });
  if (key === "deviceId") throw new AgentError("deviceId is generated and managed automatically.", { code: "invalid_config_key" });
  if (action === "set" && !rest.length) throw new AgentError("config set requires a value.", { code: "invalid_argument" });
  const next = { ...runtime.globalConfig, [key]: action === "unset" ? DEFAULT_CONFIG[key] : parseConfigValue(key, rest.join(" ")) };
  if (key === "provider") {
    if (!PROVIDER_PRESETS[next.provider]) throw new AgentError("Unknown provider preset.", { code: "invalid_config" });
    next.baseUrl = PROVIDER_PRESETS[next.provider].baseUrl;
    if (next.provider === "3aik") next.model = "";
  }
  const displayValue = key === "apiKey" && next[key] ? "[configured]" : next[key];
  const description = `${action === "unset" ? "Reset" : "Set"} global config ${key}${action === "set" ? `=${displayValue}` : ""}`;
  if (parsed.options.dryRun) {
    ui.line(`[dry-run] ${description}`);
    return 0;
  }
  if (!parsed.options.yes && !(await ui.confirm({ kind: "config", description, risk: "caution" }))) {
    throw new AgentError("Config change was not approved.", { code: "approval_required" });
  }
  await saveGlobalConfig(next, { configPath: runtime.configPath });
  ui.line(`${key}=${displayValue}`);
  return 0;
}

export async function runModels(runtime, parsed, ui, signal) {
  if (runtime.config.provider === "3aik") {
    const health = await runtime.client.health({ signal });
    const modes = Array.isArray(health.modes) ? health.modes : [];
    if (parsed.options.json) ui.line(JSON.stringify({ provider: "3aik", baseUrl: runtime.config.baseUrl, models: modes }, null, 2));
    else {
      ui.line(`${ui.style("✓", "green")} 3aik Cloud · ${runtime.config.baseUrl}`);
      for (const mode of modes) ui.line(`  ${sanitizeTerminalText(mode.id)}: ${sanitizeTerminalText(mode.label)}${mode.description ? ` — ${sanitizeTerminalText(mode.description)}` : ""}`);
    }
    return 0;
  }
  const models = await runtime.client.listModels({ signal });
  if (parsed.options.json) ui.line(JSON.stringify({ provider: runtime.config.provider, baseUrl: runtime.config.baseUrl, selected: runtime.config.model, models }, null, 2));
  else {
    ui.line(`${ui.style("✓", "green")} ${PROVIDER_PRESETS[runtime.config.provider].label} · ${runtime.config.baseUrl}`);
    if (!models.length) ui.line("  Connected, but the server reported no loaded models.");
    for (const model of models) ui.line(`  ${model.id === runtime.config.model ? "*" : " "} ${sanitizeTerminalText(model.id || "(unnamed model)")}`);
    if (!runtime.config.model) ui.line(ui.style("Select one with: 3aik config set model <id>", "dim"));
  }
  return 0;
}

async function exists(file) {
  try { await stat(file); return true; } catch (error) { if (error?.code === "ENOENT") return false; throw error; }
}

export async function runInit(runtime, parsed, ui) {
  const files = [
    {
      path: ".3aik/config.json",
      content: `${JSON.stringify({ maxIterations: 12 }, null, 2)}\n`,
    },
    {
      path: ".3aik/instructions.md",
      content: "# 3aik project instructions\n\nDescribe the architecture, conventions, test commands, and boundaries the coding agent should follow.\n",
    },
  ];
  let changed = 0;
  for (const file of files) {
    const absolute = path.join(runtime.cwd, ...file.path.split("/"));
    if (!parsed.options.force && await exists(absolute)) {
      ui.line(`skip ${file.path} (already exists)`);
      continue;
    }
    const result = await runtime.workspace.writeFile(file.path, file.content, { allowSensitive: file.path === ".3aik/config.json" });
    ui.line(`${result.dryRun ? "plan" : "create"} ${file.path}`);
    changed += result.dryRun ? 0 : 1;
  }
  if (!changed && !parsed.options.dryRun) ui.line("Nothing changed.");
  return 0;
}
