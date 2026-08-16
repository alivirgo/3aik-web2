import { AgentError } from "@3aik/agent-core";

const COMMANDS = new Set(["chat", "agent", "review", "doctor", "models", "config", "init", "help"]);
const VALUE_FLAGS = new Map([
  ["--cwd", "cwd"], ["-C", "cwd"],
  ["--api-base", "apiBase"],
  ["--base-url", "baseUrl"],
  ["--provider", "provider"],
  ["--model", "model"],
  ["--api-key", "apiKey"],
  ["--timeout", "timeoutMs"],
  ["--max-output", "maxOutputBytes"],
  ["--mode", "mode"],
  ["--max-tokens", "maxTokens"],
  ["--temperature", "temperature"],
]);
const BOOLEAN_FLAGS = new Map([
  ["--yes", "yes"], ["-y", "yes"],
  ["--dry-run", "dryRun"],
  ["--staged", "staged"],
  ["--read-only", "readOnly"],
  ["--no-color", "noColor"],
  ["--json", "json"],
  ["--force", "force"],
  ["--help", "help"], ["-h", "help"],
  ["--version", "version"], ["-v", "version"],
]);

function numeric(name, value, { min, max, integer = true }) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max || (integer && !Number.isInteger(parsed))) {
    throw new AgentError(`${name} must be ${integer ? "an integer" : "a number"} from ${min} to ${max}.`, { code: "invalid_argument" });
  }
  return parsed;
}

export function parseArgs(argv) {
  const options = {};
  const positionals = [];
  let command = null;
  let passthrough = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (passthrough) {
      positionals.push(token);
      continue;
    }
    if (token === "--") {
      passthrough = true;
      continue;
    }
    const equals = token.startsWith("--") ? token.indexOf("=") : -1;
    const flag = equals > 0 ? token.slice(0, equals) : token;
    if (BOOLEAN_FLAGS.has(flag)) {
      if (equals > 0) throw new AgentError(`${flag} does not take a value.`, { code: "invalid_argument" });
      options[BOOLEAN_FLAGS.get(flag)] = true;
      continue;
    }
    if (VALUE_FLAGS.has(flag)) {
      const value = equals > 0 ? token.slice(equals + 1) : argv[++index];
      if (value === undefined || value === "") throw new AgentError(`${flag} requires a value.`, { code: "invalid_argument" });
      options[VALUE_FLAGS.get(flag)] = value;
      continue;
    }
    if (token.startsWith("-")) throw new AgentError(`Unknown option: ${token}`, { code: "invalid_argument" });
    if (!command && COMMANDS.has(token)) command = token;
    else positionals.push(token);
  }

  command ||= "chat";
  if (command === "help") options.help = true;
  if (options.timeoutMs !== undefined) options.timeoutMs = numeric("--timeout", options.timeoutMs, { min: 100, max: 600_000 });
  if (options.maxOutputBytes !== undefined) options.maxOutputBytes = numeric("--max-output", options.maxOutputBytes, { min: 1_024, max: 5_000_000 });
  if (options.maxTokens !== undefined) options.maxTokens = numeric("--max-tokens", options.maxTokens, { min: 256, max: 8_192 });
  if (options.temperature !== undefined) options.temperature = numeric("--temperature", options.temperature, { min: 0, max: 1.2, integer: false });
  if (options.mode !== undefined && !["chat", "deep", "code"].includes(options.mode)) {
    throw new AgentError("--mode must be chat, deep, or code.", { code: "invalid_argument" });
  }
  if (options.provider !== undefined && !["3aik", "ollama", "lmstudio", "llamacpp", "openai-compatible"].includes(options.provider)) {
    throw new AgentError("--provider must be 3aik, ollama, lmstudio, llamacpp, or openai-compatible.", { code: "invalid_argument" });
  }
  return { command, options, positionals };
}

export { COMMANDS };
