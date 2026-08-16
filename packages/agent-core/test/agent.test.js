import test from "node:test";
import assert from "node:assert/strict";
import { CodingAgent } from "../src/index.js";
import { compactMessages } from "../src/agent.js";

function fakeWorkspace({ readOnly = false } = {}) {
  const calls = [];
  return {
    root: "/workspace",
    readOnly,
    calls,
    async verify() {},
    async executeTool(name, args) {
      calls.push({ name, args });
      return { content: "file data" };
    },
  };
}

test("coding agent executes a native tool call locally then returns a final answer", async () => {
  const workspace = fakeWorkspace();
  const turns = [
    { type: "tool_calls", calls: [{ id: "c1", name: "read_file", arguments: { path: "a.js" } }], model: "test" },
    { type: "message", content: "Done.", model: "test" },
  ];
  const client = { async agentTurn() { return turns.shift(); } };
  const events = [];
  const result = await new CodingAgent({ client, workspace }).run("Inspect", { onEvent: (event) => events.push(event.type) });
  assert.equal(result.content, "Done.");
  assert.deepEqual(workspace.calls, [{ name: "read_file", args: { path: "a.js" } }]);
  assert(events.includes("tool_end"));
  assert.equal(result.messages.at(-2).role, "tool");
});

test("coding agent supports textual fallback envelopes", async () => {
  const workspace = fakeWorkspace();
  let turn = 0;
  const client = {
    async agentTurn() {
      turn += 1;
      return turn === 1
        ? { type: "message", content: '```3aik-tool\n{"name":"search","arguments":{"query":"todo"}}\n```', fallback: true }
        : { type: "message", content: "No TODOs." };
    },
  };
  const result = await new CodingAgent({ client, workspace }).run("Check TODOs");
  assert.equal(result.content, "No TODOs.");
  assert.equal(workspace.calls[0].name, "search");
});

test("read-only agents do not expose mutating tools", async () => {
  const workspace = fakeWorkspace({ readOnly: true });
  const client = {
    async agentTurn(request) {
      const names = request.tools.map((tool) => tool.function.name);
      assert(!names.includes("write_file"));
      assert(!names.includes("apply_patch"));
      assert(!names.includes("run_command"));
      return { type: "message", content: "Reviewed." };
    },
  };
  assert.equal((await new CodingAgent({ client, workspace }).run("Review")).content, "Reviewed.");
});

test("iteration limits stop runaway tool loops", async () => {
  const workspace = fakeWorkspace();
  const client = { async agentTurn() { return { type: "tool_calls", calls: [{ id: "x", name: "read_file", arguments: { path: "x" } }] }; } };
  await assert.rejects(new CodingAgent({ client, workspace, maxIterations: 2 }).run("Loop"), { code: "iteration_limit" });
});

test("cancelling a multi-tool turn prevents every later tool", async () => {
  const controller = new AbortController();
  const workspace = fakeWorkspace();
  workspace.executeTool = async (name, args) => {
    workspace.calls.push({ name, args });
    if (name === "read_file") controller.abort(new DOMException("Stopped by test", "AbortError"));
    return { content: "file data" };
  };
  const client = {
    async agentTurn() {
      return {
        type: "tool_calls",
        calls: [
          { id: "read", name: "read_file", arguments: { path: "a.js" } },
          { id: "write", name: "write_file", arguments: { path: "a.js", content: "changed" } },
        ],
      };
    },
  };
  await assert.rejects(new CodingAgent({ client, workspace }).run("Inspect then write", { signal: controller.signal }), { name: "AbortError" });
  assert.deepEqual(workspace.calls.map((call) => call.name), ["read_file"]);
});

test("reused model tool-call IDs are made unique before history is sent again", async () => {
  const workspace = fakeWorkspace();
  const requests = [];
  let turn = 0;
  const client = {
    async agentTurn(request) {
      requests.push(structuredClone(request.messages));
      turn += 1;
      if (turn <= 2) return { type: "tool_calls", calls: [{ id: "reused", name: "read_file", arguments: { path: "x" } }] };
      return { type: "message", content: "Finished." };
    },
  };
  await new CodingAgent({ client, workspace }).run("Inspect twice");
  const ids = requests.at(-1).flatMap((message) => (message.tool_calls || []).map((call) => call.id));
  assert.equal(new Set(ids).size, ids.length);
});

test("unknown tool requests are repaired without poisoning validated history", async () => {
  const workspace = fakeWorkspace();
  let turn = 0;
  const client = {
    async agentTurn(request) {
      if (turn++ === 0) return { type: "tool_calls", calls: [{ id: "x", name: "steal_secret", arguments: {} }] };
      assert(!request.messages.some((message) => message.tool_calls?.some((call) => call.function.name === "steal_secret")));
      return { type: "message", content: "Cannot use that tool." };
    },
  };
  assert.equal((await new CodingAgent({ client, workspace }).run("Try")).content, "Cannot use that tool.");
  assert.equal(workspace.calls.length, 0);
});

test("history compaction preserves complete assistant-tool groups under the hard bound", () => {
  const messages = [{ role: "user", content: "initial request" }];
  for (let index = 0; index < 9; index += 1) {
    const id = `call-${index}`;
    messages.push(
      { role: "assistant", content: "", tool_calls: [{ id, type: "function", function: { name: "read_file", arguments: "{}" } }] },
      { role: "tool", tool_call_id: id, name: "read_file", content: "x".repeat(8_000) },
      { role: "assistant", content: `observed ${index}` },
      { role: "user", content: `continue ${index}` },
    );
  }
  const compacted = compactMessages(messages, 52_000);
  assert(JSON.stringify(compacted).length <= 52_000);
  assert(compacted.some((message) => message.tool_call_id === "call-8"), "most recent complete tool group must survive");
  for (let index = 0; index < compacted.length; index += 1) {
    if (compacted[index].role !== "tool") continue;
    let assistant = index - 1;
    while (assistant >= 0 && compacted[assistant].role === "tool") assistant -= 1;
    const ids = compacted[assistant]?.tool_calls?.map((call) => call.id) || [];
    assert(ids.includes(compacted[index].tool_call_id), `orphan tool result: ${compacted[index].tool_call_id}`);
  }
});

test("history compaction also stays below the API message-count limit", () => {
  const messages = [{ role: "user", content: "initial" }];
  for (let index = 0; index < 40; index += 1) {
    messages.push({ role: "assistant", content: `answer ${index}` }, { role: "user", content: `question ${index}` });
  }
  const compacted = compactMessages(messages);
  assert(compacted.length <= 60);
  assert.equal(compacted[0].role, "user");
  assert.equal(compacted.at(-1).content, "question 39");
});
