'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createModelClient } = require('../src/agent/model-client.cjs');

test('cloud turns use /api/agent with the local device identifier', async () => {
  let captured;
  const client = createModelClient({
    fetchImplementation: async (url, options) => {
      captured = { url: String(url), options };
      return Response.json({ type: 'message', content: 'Done', model: 'cloud-test' });
    }
  });
  const result = await client.request(
    { provider: '3aik-cloud', agentBaseUrl: 'https://3aik.com', deviceId: 'device-123' },
    { messages: [{ role: 'user', content: 'Review' }], tools: [] }
  );
  assert.equal(result.content, 'Done');
  assert.equal(captured.url, 'https://3aik.com/api/agent');
  assert.equal(captured.options.headers['x-3aik-device'], 'device-123');
});

test('local turns never call 3aik and map OpenAI-compatible tool calls', async () => {
  const requests = [];
  const client = createModelClient({
    fetchImplementation: async (url, options) => {
      requests.push({ url: String(url), options });
      return Response.json({
        model: 'qwen-local',
        choices: [{ message: { tool_calls: [{ id: 'c1', function: { name: 'read_file', arguments: '{"path":"app.js"}' } }] } }]
      });
    }
  });
  const result = await client.request(
    {
      provider: 'openai-compatible',
      localBaseUrl: 'http://127.0.0.1:11434/v1',
      localModel: 'qwen-local',
      localApiKey: 'local-only'
    },
    { messages: [{ role: 'user', content: 'Inspect' }], tools: [{ name: 'read_file', description: 'Read', inputSchema: {} }] }
  );
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'http://127.0.0.1:11434/v1/chat/completions');
  assert(!requests[0].url.includes('3aik.com'));
  assert.equal(requests[0].options.headers.Authorization, 'Bearer local-only');
  assert.equal(result.calls[0].arguments.path, 'app.js');
});

test('connection testing discovers models without sending a prompt', async () => {
  const client = createModelClient({
    fetchImplementation: async (url, options) => {
      assert.equal(String(url), 'http://127.0.0.1:1234/v1/models');
      assert.equal(options.body, undefined);
      return Response.json({ data: [{ id: 'model-a' }, { id: 'model-b' }] });
    }
  });
  const result = await client.testConnection({
    provider: 'openai-compatible',
    localBaseUrl: 'http://127.0.0.1:1234/v1'
  });
  assert.deepEqual(result.models, ['model-a', 'model-b']);
});

test('public hosts are rejected before a local provider request is made', async () => {
  let called = false;
  const client = createModelClient({ fetchImplementation: async () => { called = true; } });
  await assert.rejects(
    client.request(
      { provider: 'openai-compatible', localBaseUrl: 'https://api.example.com/v1', localModel: 'x' },
      { messages: [], tools: [] }
    ),
    /localhost or a private network/
  );
  assert.equal(called, false);
});
