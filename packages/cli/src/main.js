import { AgentError } from "@3aik/agent-core";
import { parseArgs } from "./args.js";
import {
  HELP,
  VERSION,
  createRuntime,
  runAgent,
  runChat,
  runConfig,
  runDoctor,
  runInit,
  runModels,
  runReview,
  sanitizeTerminalText,
} from "./commands.js";
import { TerminalUI } from "./ui.js";

const COMMAND_HANDLERS = {
  chat: runChat,
  agent: runAgent,
  review: runReview,
  doctor: runDoctor,
  models: runModels,
  config: runConfig,
  init: runInit,
};

export async function main(argv, dependencies = {}) {
  const ui = dependencies.ui || new TerminalUI({ color: argv.includes("--no-color") ? false : undefined });
  const controller = new AbortController();
  const interrupt = () => {
    controller.abort(new DOMException("Interrupted", "AbortError"));
    ui.close();
  };
  process.once("SIGINT", interrupt);
  try {
    const parsed = parseArgs(argv);
    if (parsed.options.version) {
      ui.line(VERSION);
      return 0;
    }
    if (parsed.options.help) {
      ui.line(HELP);
      return 0;
    }
    const runtime = await createRuntime(parsed, { ui, env: dependencies.env, fetchImpl: dependencies.fetchImpl });
    const handler = COMMAND_HANDLERS[parsed.command];
    if (!handler) throw new AgentError(`Unknown command: ${parsed.command}`, { code: "invalid_command" });
    return await handler(runtime, parsed, ui, controller.signal);
  } catch (error) {
    if (controller.signal.aborted || error?.name === "AbortError") {
      ui.fail("Interrupted.");
      return 130;
    }
    ui.fail(`3aik: ${sanitizeTerminalText(error?.message || error)}`);
    if (!(error instanceof AgentError) && (process.env.THREEAIK_DEBUG || process.env["3AIK_DEBUG"])) ui.fail(sanitizeTerminalText(error?.stack || ""));
    return 1;
  } finally {
    process.removeListener("SIGINT", interrupt);
    ui.close();
  }
}

export { parseArgs } from "./args.js";
