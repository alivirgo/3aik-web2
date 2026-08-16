import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { loadConfig, normalizeConfig, saveGlobalConfig } from "../src/config.js";

test("first load generates and persists a stable device ID", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "3aik-config-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const configPath = path.join(root, "global", "config.json");
  const first = await loadConfig({ cwd: root, env: { THREEAIK_CONFIG: configPath } });
  const second = await loadConfig({ cwd: root, env: { THREEAIK_CONFIG: configPath } });
  assert.match(first.config.deviceId, /^[a-f0-9-]{36}$/);
  assert.equal(second.config.deviceId, first.config.deviceId);
  assert.equal(JSON.parse(await readFile(configPath, "utf8")).deviceId, first.config.deviceId);
});

test("project config can tune bounded behavior without changing provider routing", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "3aik-provider-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const configPath = path.join(root, "global.json");
  await saveGlobalConfig({
    provider: "3aik",
    deviceId: "device-id-1234567890",
    baseUrl: "https://3aik.com",
  }, { configPath });
  await mkdir(path.join(root, ".3aik"));
  await writeFile(path.join(root, ".3aik", "config.json"), JSON.stringify({ mode: "deep", maxIterations: 7 }));
  const loaded = await loadConfig({ cwd: root, env: { THREEAIK_CONFIG: configPath } });
  assert.equal(loaded.config.provider, "3aik");
  assert.equal(loaded.config.baseUrl, "https://3aik.com");
  assert.equal(loaded.config.mode, "deep");
  assert.equal(loaded.config.maxIterations, 7);
  assert.equal(loaded.globalConfig.provider, "3aik");
});

test("project config cannot redirect providers or supply credentials", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "3aik-untrusted-provider-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const configPath = path.join(root, "global.json");
  await saveGlobalConfig({
    provider: "3aik",
    deviceId: "device-id-1234567890",
    baseUrl: "https://3aik.com",
    apiKey: "global-secret",
  }, { configPath });
  await mkdir(path.join(root, ".3aik"));
  await writeFile(path.join(root, ".3aik", "config.json"), JSON.stringify({
    provider: "openai-compatible",
    baseUrl: "https://attacker.example/v1",
    apiKey: "repo-secret",
    deviceId: "repo-controlled-device",
  }));
  await assert.rejects(
    loadConfig({ cwd: root, env: { THREEAIK_CONFIG: configPath, THREEAIK_API_KEY: "environment-secret" } }),
    { code: "invalid_project_config" },
  );
});

test("config validation rejects unsafe URL schemes and invalid provider values", () => {
  const base = { deviceId: "device-id-1234567890" };
  assert.throws(() => normalizeConfig({ ...base, baseUrl: "file:///tmp/model" }), { code: "invalid_config" });
  assert.throws(() => normalizeConfig({ ...base, provider: "unknown" }), { code: "invalid_config" });
});
