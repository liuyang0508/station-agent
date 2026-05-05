import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'path';
import { AgentLoop, LoopState } from '../src/runtime/agentLoop.mjs';
import { WorkflowEngine, parseAgentWorkflow } from '../src/runtime/workflowEngine.mjs';
import { TaskScheduler } from '../src/lib/taskScheduler.mjs';
import { validateUrl, safeFetch } from '../src/lib/ssrfValidator.mjs';
import { validateMcpConfig } from '../src/lib/mcpManager.mjs';

test('AgentLoop detects exact output loops', () => {
  const loop = new AgentLoop({ loopThreshold: 3, maxIterations: 10 });

  loop.start();
  loop.recordStep({ output: 'same output' });
  loop.recordStep({ output: 'same output' });
  const result = loop.recordStep({ output: 'same output' });

  assert.equal(result.stopped, true);
  assert.equal(result.reason, 'loop');
  assert.equal(loop.state, LoopState.LOOP_DETECTED);
});

test('AgentLoop detects normalized output loops (timestamps removed)', () => {
  const loop = new AgentLoop({ loopThreshold: 3, maxIterations: 10 });

  loop.start();
  loop.recordStep({ output: 'Result at 2024-01-01T12:00:00Z and id aaaaaaaa-1234-1234-1234-123456789abc' });
  loop.recordStep({ output: 'Result at 2025-06-15T08:30:00Z and id bbbbbbbb-1234-1234-1234-123456789abc' });
  loop.recordStep({ output: 'Result at 2026-01-01T00:00:00Z and id cccccccc-1234-1234-1234-123456789abc' });

  const result = loop.recordStep({ output: 'Result at 2027-01-01T00:00:00Z and id dddddddd-1234-1234-1234-123456789abc' });

  assert.equal(result.stopped, true);
  assert.equal(result.reason, 'loop');
});

test('AgentLoop allows different outputs', () => {
  const loop = new AgentLoop({ loopThreshold: 3, maxIterations: 10 });

  loop.start();
  loop.recordStep({ output: 'first result' });
  loop.recordStep({ output: 'second result' });
  const result = loop.recordStep({ output: 'third result' });

  assert.equal(result.stopped, false);
  assert.equal(loop.state, LoopState.RUNNING);
});

test('AgentLoop stops at max iterations', () => {
  const loop = new AgentLoop({ loopThreshold: 3, maxIterations: 5 });

  loop.start();
  for (let i = 0; i < 5; i++) {
    loop.recordStep({ output: `output ${i}` });
  }

  assert.equal(loop.state, LoopState.STOPPED);
  assert.equal(loop.iteration, 5);
});

test('AgentLoop detects token-based similarity', () => {
  const loop = new AgentLoop({ loopThreshold: 2, maxIterations: 10 });

  loop.start();
  loop.recordStep({ output: 'The quick brown fox jumps over the lazy dog. Sequence: 1' });
  loop.recordStep({ output: 'The quick brown fox jumps over the lazy dog. Sequence: 2' });
  loop.recordStep({ output: 'The quick brown fox jumps over the lazy dog. Sequence: 3' });

  assert.equal(loop.state, LoopState.LOOP_DETECTED);
});

test('validateUrl blocks private IP ranges', () => {
  const blocked = [
    'http://10.0.0.1/api',
    'http://172.16.0.1/api',
    'http://192.168.1.1/api',
    'http://127.0.0.1/api',
    'http://169.254.169.254/latest/meta-data',
    'https://localhost/api',
    'http://0.0.0.0/api'
  ];

  for (const url of blocked) {
    const result = validateUrl(url);
    assert.equal(result.allowed, false, `Should block ${url}`);
    assert.ok(result.reason.includes('private IP') || result.reason.includes('Hostname resolves to private'), url);
  }
});

test('validateUrl allows public URLs', () => {
  const allowed = [
    'https://api.openai.com/v1/models',
    'https://api.minimax.io/v1/models',
    'https://www.google.com'
  ];

  for (const url of allowed) {
    const result = validateUrl(url);
    assert.equal(result.allowed, true, `Should allow ${url}`);
  }
});

test('validateUrl blocks dangerous patterns', () => {
  const dangerous = [
    'https://example.com/?q=%%30',  // Octal bypass
    'https://example.com/?q=%00',   // Null byte
    'https://user:pass@example.com@192.168.1.1/'  // @ sign abuse
  ];

  for (const url of dangerous) {
    const result = validateUrl(url);
    assert.equal(result.allowed, false, `Should block ${url}`);
  }
});

test('validateMcpConfig blocks dangerous Python flags in args', () => {
  const root = os.tmpdir();
  const result = validateMcpConfig(
    { command: 'python', args: ['-c', 'import os; os.system("rm -rf /")'], cwd: root },
    root
  );
  assert.equal(result.allowed, false);
  assert.ok(result.reason.includes('dangerous flag'));
});

test('validateMcpConfig blocks Node eval flags in args', () => {
  const root = os.tmpdir();
  const result = validateMcpConfig(
    { command: 'node', args: ['-e', 'console.log("hacked")'], cwd: root },
    root
  );
  assert.equal(result.allowed, false);
  assert.ok(result.reason.includes('dangerous flag'));
});

test('validateMcpConfig blocks path traversal in args', () => {
  const root = os.tmpdir();
  const result = validateMcpConfig(
    { command: 'python', args: ['--config', '../../../etc/passwd'], cwd: root },
    root
  );
  assert.equal(result.allowed, false);
  assert.ok(result.reason.includes('suspicious characters'));
});

test('validateMcpConfig allows safe args', () => {
  const root = os.tmpdir();
  const result = validateMcpConfig(
    { command: 'node', args: ['--help', '--version', 'server.js', '8080'], cwd: root },
    root
  );
  assert.equal(result.allowed, true);
});

test('TaskScheduler can start and stop', async () => {
  const mockStore = {
    listTasks: () => [],
    getTask: (id) => null,
    markTaskRun: () => {}
  };

  const scheduler = new TaskScheduler({ store: mockStore });
  scheduler.start();
  assert.ok(scheduler.interval !== null);

  scheduler.stop();
  assert.equal(scheduler.interval, null);
});

test('WorkflowEngine parseAgentWorkflow parses agent definition', () => {
  const agentDef = {
    name: 'test-agent',
    description: 'Test agent',
    capabilities: [
      { name: 'step1', description: 'First step', inputs: {}, outputs: [] },
      { name: 'step2', description: 'Second step', inputs: {}, outputs: [] }
    ],
    inputs: [],
    outputs: []
  };

  const workflow = parseAgentWorkflow(agentDef);
  assert.equal(workflow.name, 'test-agent');
  assert.equal(workflow.capabilities.length, 2);
  assert.equal(workflow.capabilities[0].name, 'step1');
  assert.equal(workflow.capabilities[1].name, 'step2');
});

test('safeFetch throws on private IP', async () => {
  try {
    await safeFetch('http://192.168.1.1/api', {}, {});
    assert.fail('Should have thrown');
  } catch (err) {
    assert.ok(err.message.includes('SSRF validation failed'));
  }
});
