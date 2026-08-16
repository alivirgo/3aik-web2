import test from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "../src/args.js";

test("parses commands, global options in any position, and prompts", () => {
  const parsed = parseArgs(["agent", "fix", "the", "tests", "--yes", "--timeout=5000", "-C", "project"]);
  assert.equal(parsed.command, "agent");
  assert.deepEqual(parsed.positionals, ["fix", "the", "tests"]);
  assert.equal(parsed.options.yes, true);
  assert.equal(parsed.options.timeoutMs, 5_000);
  assert.equal(parsed.options.cwd, "project");
});

test("defaults unknown prose to chat and supports local provider flags", () => {
  const parsed = parseArgs(["hello", "world", "--provider", "ollama", "--model", "coder"]);
  assert.equal(parsed.command, "chat");
  assert.deepEqual(parsed.positionals, ["hello", "world"]);
  assert.equal(parsed.options.provider, "ollama");
  assert.equal(parsed.options.model, "coder");
});

test("validates numeric ranges and unknown options", () => {
  assert.throws(() => parseArgs(["chat", "--max-tokens", "10"]), { code: "invalid_argument" });
  assert.throws(() => parseArgs(["--wat"]), { code: "invalid_argument" });
  assert.throws(() => parseArgs(["--provider", "mystery"]), { code: "invalid_argument" });
  assert.equal(parseArgs(["--max-tokens", "8192"]).options.maxTokens, 8_192);
});
