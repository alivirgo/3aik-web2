import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { AgentError, DEFAULT_API_BASE } from "@3aik/agent-core";

export const DEFAULT_CONFIG = Object.freeze({
  provider: "3aik",
  baseUrl: "",
  model: "",
  apiKey: "",
  deviceId: "",
  mode: "chat",
  temperature: 0.25,
  maxTokens: 4_096,
  timeoutMs: 120_000,
  maxOutputBytes: 256_000,
  maxIterations: 12,
});

export const CONFIG_KEYS = Object.freeze(Object.keys(DEFAULT_CONFIG));
export const PROJECT_CONFIG_KEYS = Object.freeze([
  "mode",
  "temperature",
  "maxTokens",
  "timeoutMs",
  "maxOutputBytes",
  "maxIterations",
]);

export const PROVIDER_PRESETS = Object.freeze({
  "3aik": { baseUrl: DEFAULT_API_BASE, label: "3aik Cloud" },
  "ollama": { baseUrl: "http://127.0.0.1:11434/v1", label: "Ollama" },
  "lmstudio": { baseUrl: "http://127.0.0.1:1234/v1", label: "LM Studio" },
  "llamacpp": { baseUrl: "http://127.0.0.1:8080/v1", label: "llama.cpp" },
  "openai-compatible": { baseUrl: "http://127.0.0.1:8080/v1", label: "OpenAI-compatible" },
});

export function globalConfigPath(env = process.env, platform = process.platform, home = os.homedir()) {
  if (env.THREEAIK_CONFIG) return path.resolve(env.THREEAIK_CONFIG);
  if (env["3AIK_CONFIG"]) return path.resolve(env["3AIK_CONFIG"]);
  if (platform === "win32") return path.join(env.APPDATA || path.join(home, "AppData", "Roaming"), "3aik", "config.json");
  if (platform === "darwin") return path.join(home, "Library", "Application Support", "3aik", "config.json");
  return path.join(env.XDG_CONFIG_HOME || path.join(home, ".config"), "3aik", "config.json");
}

async function readJson(file) {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("expected an object");
    return parsed;
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw new AgentError(`Cannot read config ${file}: ${error.message}`, { code: "invalid_config", cause: error });
  }
}

export function normalizeConfig(input) {
  const config = { ...DEFAULT_CONFIG, ...input };
  if (input.apiBase && !input.baseUrl) config.baseUrl = input.apiBase;
  if (!PROVIDER_PRESETS[config.provider]) throw new AgentError("provider must be 3aik, ollama, lmstudio, llamacpp, or openai-compatible.", { code: "invalid_config" });
  config.baseUrl ||= PROVIDER_PRESETS[config.provider].baseUrl;
  try {
    const url = new URL(config.baseUrl);
    if (!/^https?:$/.test(url.protocol)) throw new Error();
  } catch {
    throw new AgentError("baseUrl must be an HTTP(S) URL.", { code: "invalid_config" });
  }
  if (typeof config.model !== "string" || typeof config.apiKey !== "string") throw new AgentError("model and apiKey must be strings.", { code: "invalid_config" });
  if (typeof config.deviceId !== "string" || !/^[a-zA-Z0-9-]{16,128}$/.test(config.deviceId)) throw new AgentError("deviceId is invalid.", { code: "invalid_config" });
  if (!["chat", "deep", "code"].includes(config.mode)) throw new AgentError("mode must be chat, deep, or code.", { code: "invalid_config" });
  const checks = [
    ["temperature", 0, 1.2, false],
    ["maxTokens", 256, 8_192, true],
    ["timeoutMs", 100, 600_000, true],
    ["maxOutputBytes", 1_024, 5_000_000, true],
    ["maxIterations", 1, 40, true],
  ];
  for (const [key, min, max, integer] of checks) {
    const value = Number(config[key]);
    if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
      throw new AgentError(`${key} must be ${integer ? "an integer" : "a number"} from ${min} to ${max}.`, { code: "invalid_config" });
    }
    config[key] = value;
  }
  return config;
}

export async function loadConfig({ cwd = process.cwd(), env = process.env, configPath = globalConfigPath(env) } = {}) {
  const global = await readJson(configPath);
  if (!/^[a-zA-Z0-9-]{16,128}$/.test(global.deviceId || "")) {
    global.deviceId = randomUUID();
    await saveGlobalConfig({ ...DEFAULT_CONFIG, ...global }, { configPath });
  }
  const localPath = path.join(path.resolve(cwd), ".3aik", "config.json");
  const localInput = await readJson(localPath);
  const disallowedProjectKeys = Object.keys(localInput).filter((key) => !PROJECT_CONFIG_KEYS.includes(key));
  if (disallowedProjectKeys.length) {
    throw new AgentError(
      `Project config cannot set ${disallowedProjectKeys.join(", ")}. Provider routing, models, credentials, and device identity must be configured globally, through the environment, or with an explicit command flag.`,
      { code: "invalid_project_config" },
    );
  }
  const local = Object.fromEntries(PROJECT_CONFIG_KEYS.filter((key) => localInput[key] !== undefined).map((key) => [key, localInput[key]]));
  const environment = {};
  if (env.THREEAIK_API_BASE || env["3AIK_API_BASE"]) environment.baseUrl = env.THREEAIK_API_BASE || env["3AIK_API_BASE"];
  if (env.THREEAIK_BASE_URL || env["3AIK_BASE_URL"]) environment.baseUrl = env.THREEAIK_BASE_URL || env["3AIK_BASE_URL"];
  if (env.THREEAIK_PROVIDER || env["3AIK_PROVIDER"]) environment.provider = env.THREEAIK_PROVIDER || env["3AIK_PROVIDER"];
  if (env.THREEAIK_MODEL || env["3AIK_MODEL"]) environment.model = env.THREEAIK_MODEL || env["3AIK_MODEL"];
  if (env.THREEAIK_API_KEY || env["3AIK_API_KEY"]) environment.apiKey = env.THREEAIK_API_KEY || env["3AIK_API_KEY"];
  if (env.THREEAIK_MODE || env["3AIK_MODE"]) environment.mode = env.THREEAIK_MODE || env["3AIK_MODE"];
  const merged = { ...global, ...local, ...environment };
  if (environment.provider && environment.baseUrl === undefined) merged.baseUrl = PROVIDER_PRESETS[environment.provider]?.baseUrl;
  return { config: normalizeConfig(merged), globalConfig: normalizeConfig(global), configPath, localPath };
}

export async function saveGlobalConfig(value, { configPath = globalConfigPath() } = {}) {
  const normalized = normalizeConfig(value);
  await mkdir(path.dirname(configPath), { recursive: true });
  const temporary = `${configPath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(normalized, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, configPath);
  return normalized;
}

export function parseConfigValue(key, raw) {
  if (!CONFIG_KEYS.includes(key)) throw new AgentError(`Unknown config key: ${key}`, { code: "invalid_config_key" });
  if (["temperature", "maxTokens", "timeoutMs", "maxOutputBytes", "maxIterations"].includes(key)) return Number(raw);
  return raw;
}
