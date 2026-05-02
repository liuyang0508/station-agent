import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { McpProtocol, METHODS } from '../src/lib/mcpProtocol.mjs';
import { SqliteStore } from '../src/lib/sqliteStore.mjs';
import { CommandExecutor, classifyCommand } from '../src/lib/commandExecutor.mjs';
import { RollbackManager } from '../src/lib/rollbackManager.mjs';
import { createAgentRuntime } from '../src/runtime/agentRuntime.mjs';
import { DemoRuntime } from '../src/runtime/adapters/DemoRuntime.mjs';
import { OpenAICompatibleRuntime } from '../src/runtime/adapters/OpenAICompatibleRuntime.mjs';

test('McpProtocol builds valid JSON-RPC 2.0 request', () => {
  const protocol = new McpProtocol();
  const req = protocol.buildRequest('tools/list', { foo: 'bar' });
  assert.equal(req.jsonrpc, '2.0');
  assert.equal(req.method, 'tools/list');
  assert.equal(req.params.foo, 'bar');
  assert.ok(req.id);
});

test('McpProtocol parses valid response', () => {
  const protocol = new McpProtocol();
  const parsed = protocol.parseMessage({ jsonrpc: '2.0', id: 'abc', result: { tools: [] } });
  assert.equal(parsed.type, 'response');
  assert.equal(parsed.id, 'abc');
  assert.deepEqual(parsed.result, { tools: [] });
});

test('McpProtocol createInitializeRequest includes required fields', () => {
  const protocol = new McpProtocol();
  const req = protocol.createInitializeRequest({ name: 'TestClient', version: '1.0.0' });
  assert.equal(req.method, 'initialize');
  assert.equal(req.params.protocolVersion, '2024-11-05');
  assert.equal(req.params.clientInfo.name, 'TestClient');
});

test('SqliteStore creates sessions and persists messages', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aia-sqlite-'));
  const store = new SqliteStore(path.join(tempDir, 'store.db'));

  const session = store.createSession({ title: 'SQLite测试' });
  assert.equal(session.title, 'SQLite测试');

  const message = store.addMessage({ sessionId: session.id, role: 'user', content: '测试消息' });
  assert.equal(store.listMessages(session.id)[0].content, '测试消息');
});

test('SqliteStore supports memories with vector embeddings', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aia-sqlite-vec-'));
  const store = new SqliteStore(path.join(tempDir, 'store.db'));

  const memory = store.createMemory({ title: '项目架构', content: '使用微服务架构', tags: ['architecture'] });
  assert.equal(memory.title, '项目架构');

  // Create mock embedding (1536 dimensions for typical embedding models)
  const mockEmbedding = new Float32Array(1536).fill(0.1);
  store.createMemoryEmbedding(memory.id, mockEmbedding);

  const result = store.searchMemoriesByVector(mockEmbedding, 5);
  assert.equal(result.length > 0, true);
  assert.equal(result[0].id, memory.id);
});

test('SqliteStore search works correctly', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aia-sqlite-search-'));
  const store = new SqliteStore(path.join(tempDir, 'store.db'));

  store.createMemory({ title: '长期偏好', content: '默认中文优先', tags: ['preference'] });
  const result = store.search('中文');
  assert.equal(result.memories.length > 0, true);
  assert.equal(result.memories[0].title, '长期偏好');
});

test('CommandExecutor classifies write vs read commands', () => {
  assert.equal(classifyCommand('ls -la').type, 'read');
  assert.equal(classifyCommand('mkdir test').type, 'write');
  assert.equal(classifyCommand('rm file.txt').type, 'write');
  assert.equal(classifyCommand('touch new.txt').type, 'write');
  assert.equal(classifyCommand('echo hello').type, 'read');
});

test('CommandExecutor blocks shell meta characters', () => {
  const result = classifyCommand('cat file | grep foo');
  assert.equal(result.type, 'blocked');
  assert.ok(result.reason.includes('Shell meta'));
});

test('DemoRuntime adapter emits trace and done events', async () => {
  const runtime = new DemoRuntime({
    settings: { workspaceRoot: os.tmpdir() },
    skills: [],
    memories: []
  });

  const events = [];
  for await (const event of runtime.runTurn('测试任务', {
    session: { id: 'test' },
    history: [],
    settings: { workspaceRoot: os.tmpdir() },
    skills: [],
    connectors: [],
    memories: []
  })) {
    events.push(event);
  }

  assert.equal(events.some(e => e.type === 'trace'), true);
  assert.equal(events.some(e => e.type === 'done'), true);
});

test('OpenAICompatibleRuntime reports missing credentials', async () => {
  const runtime = new OpenAICompatibleRuntime({
    settings: { baseUrl: '', apiKeyEnv: 'FAKE_KEY', model: 'test' },
    skills: [],
    memories: []
  });

  const connection = await runtime.testConnection();
  assert.equal(connection.ok, false);
  assert.equal(connection.status, 'no_credentials');
});

test('createAgentRuntime selects correct adapter for demo mode', () => {
  const runtime = createAgentRuntime({ runtimeMode: 'demo' }, { skills: [], memories: [] });
  assert.equal(runtime instanceof DemoRuntime, true);
});

test('RollbackManager snapshots and records operations', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aia-rollback-'));
  const store = new SqliteStore(path.join(tempDir, 'store.db'));
  const manager = new RollbackManager({ store, workspaceRoot: tempDir });

  // Create a test file
  fs.writeFileSync(path.join(tempDir, 'test.txt'), 'original content');

  const snapshotId = await manager.snapshot(path.join(tempDir, 'test.txt'));
  assert.ok(snapshotId);

  const operation = manager.record('file_write', path.join(tempDir, 'test.txt'), snapshotId);
  assert.ok(operation.id);
  assert.equal(operation.type, 'file_write');
});

test('createAgentRuntime selects OpenAI adapter for remote mode', () => {
  const runtime = createAgentRuntime({ runtimeMode: 'remote', baseUrl: 'https://api.example.com', apiKeyEnv: 'KEY' }, { skills: [], memories: [] });
  assert.equal(runtime instanceof OpenAICompatibleRuntime, true);
});
