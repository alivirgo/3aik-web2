import test from "node:test";
import assert from "node:assert/strict";
import { formatToolResult, normalizeToolCalls, parseToolEnvelopes } from "../src/index.js";

test("parses fenced and tagged tool envelopes without confusing final prose", () => {
  const source = `thinking\n\`\`\`3aik-tool\n{"id":"a","name":"read_file","arguments":{"path":"x.js"}}\n\`\`\`\n<3aik_tool_call>{"tool":"git_diff","args":{}}</3aik_tool_call>`;
  const parsed = parseToolEnvelopes(source);
  assert.equal(parsed.calls.length, 2);
  assert.equal(parsed.calls[0].name, "read_file");
  assert.equal(parsed.calls[1].name, "git_diff");
  assert.equal(parsed.content, "thinking");
});

test("reports malformed envelopes and normalizes OpenAI calls", () => {
  assert.equal(parseToolEnvelopes("```3aik-tool\nnope\n```").errors.length, 1);
  const calls = normalizeToolCalls([{ id: "x", function: { name: "search", arguments: "{\"query\":\"hi\"}" } }]);
  assert.deepEqual(calls[0].arguments, { query: "hi" });
});

test("tool results are bounded", () => {
  const result = formatToolResult({ id: "x", name: "read" }, { content: "a".repeat(500) }, { maxChars: 100 });
  assert(result.content.length < 140);
  assert.match(result.content, /truncated/);
});
