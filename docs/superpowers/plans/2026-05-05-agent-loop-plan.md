# Agent Loop 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 Agent 自动循环执行机制：自动继续任务、检测死循环并终止、必要时压缩上下文。

**Architecture:** Loop Controller 状态机 + Context Compactor + Safety Bounds，三者协作实现自动循环保护。

**Tech Stack:** Node.js ESM, State Machine, ContextCompactor (已有)

---

## File Structure

```
src/runtime/
├── agentLoop.mjs            # 新建: 循环控制器
├── checkpoint.mjs           # 新建: 检查点系统
src/runtime/agentRuntime.mjs # 修改: 集成 loop controller
src/server.mjs               # 修改: 添加 loop API
```

---

## Task 1: 创建 agentLoop.mjs 循环控制器

**Files:**
- Create: `src/runtime/agentLoop.mjs`

- [ ] **Step 1: 创建 agentLoop.mjs**

```javascript
/**
 * AgentLoop - 自动循环执行控制器
 *
 * 状态机: IDLE → RUNNING → WAITING → RUNNING → DONE
 *                    ↓
 *                 LOOP_DETECTED → STOPPED
 */

export const LoopState = {
  IDLE: 'idle',
  RUNNING: 'running',
  WAITING: 'waiting',
  LOOP_DETECTED: 'loop_detected',
  STOPPED: 'stopped',
  DONE: 'done'
};

export class AgentLoop {
  constructor(options = {}) {
    this.maxIterations = options.maxIterations || 100;
    this.loopThreshold = options.loopThreshold || 3;
    this.autoContinue = options.autoContinue !== false;
    this.contextThreshold = options.contextThreshold || 0.8;

    this.state = LoopState.IDLE;
    this.iteration = 0;
    this.history = [];
    this.checkpoints = [];
  }

  /**
   * 开始循环
   */
  start() {
    if (this.state === LoopState.RUNNING) return;
    this.state = LoopState.RUNNING;
    this.iteration = 0;
    this.history = [];
  }

  /**
   * 记录一步执行
   */
  recordStep(step) {
    this.history.push(step);
    this.iteration++;

    // 检查是否应停止
    const stopReason = this.shouldStop();
    if (stopReason) {
      this.state = stopReason === 'loop' ? LoopState.LOOP_DETECTED : LoopState.STOPPED;
      return { stopped: true, reason: stopReason };
    }

    return { stopped: false };
  }

  /**
   * 检测是否应停止
   */
  shouldStop() {
    // 达到最大迭代次数
    if (this.iteration >= this.maxIterations) {
      return 'max_iterations';
    }

    // 检测死循环
    if (this.detectLoop()) {
      return 'loop';
    }

    return null;
  }

  /**
   * 检测循环模式
   */
  detectLoop() {
    if (this.history.length < this.loopThreshold) return false;

    const recent = this.history.slice(-this.loopThreshold);
    const outputs = recent.map(h => h.output);

    // 检测完全相同
    if (outputs.every(o => o === outputs[0])) {
      return true;
    }

    // 检测相似模式 (简化版)
    const hashes = outputs.map(o => this._simpleHash(o));
    if (hashes.every(h => h === hashes[0])) {
      return true;
    }

    return false;
  }

  _simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash = hash & hash;
    }
    return hash;
  }

  /**
   * 暂停等待用户输入
   */
  pause() {
    this.state = LoopState.WAITING;
  }

  /**
   * 恢复执行
   */
  resume() {
    if (this.state === LoopState.WAITING) {
      this.state = LoopState.RUNNING;
    }
  }

  /**
   * 停止循环
   */
  stop() {
    this.state = LoopState.STOPPED;
  }

  /**
   * 完成
   */
  complete() {
    this.state = LoopState.DONE;
  }

  /**
   * 获取状态
   */
  getStatus() {
    return {
      state: this.state,
      iteration: this.iteration,
      maxIterations: this.maxIterations,
      autoContinue: this.autoContinue,
      historyLength: this.history.length
    };
  }

  /**
   * 保存检查点
   */
  saveCheckpoint(label = '') {
    const checkpoint = {
      id: crypto.randomUUID(),
      iteration: this.iteration,
      history: [...this.history],
      state: this.state,
      label,
      timestamp: Date.now()
    };
    this.checkpoints.push(checkpoint);
    return checkpoint.id;
  }

  /**
   * 恢复到检查点
   */
  restoreCheckpoint(checkpointId) {
    const cp = this.checkpoints.find(c => c.id === checkpointId);
    if (cp) {
      this.iteration = cp.iteration;
      this.history = [...cp.history];
      this.state = LoopState.RUNNING;
      return true;
    }
    return false;
  }
}
```

- [ ] **Step 2: 提交**

```bash
git add src/runtime/agentLoop.mjs
git commit -m "feat(runtime): add AgentLoop controller with state machine"
```

---

## Task 2: 创建 checkpoint.mjs 检查点系统

**Files:**
- Create: `src/runtime/checkpoint.mjs`

- [ ] **Step 1: 创建 checkpoint.mjs**

```javascript
/**
 * Checkpoint System - 用于验证 Agent 是否在正确方向上
 */

import { randomUUID } from 'node:crypto';

export class Checkpoint {
  constructor({ goal, expected_outcomes = [], validation_fn = null }) {
    this.id = randomUUID();
    this.goal = goal;
    this.expected_outcomes = expected_outcomes;
    this.validation_fn = validation_fn;
    this.status = 'pending';
    this.created_at = new Date().toISOString();
    this.validated_at = null;
  }

  validate(agent_state) {
    if (this.validation_fn) {
      const result = this.validation_fn(agent_state, this.expected_outcomes);
      this.status = result ? 'passed' : 'failed';
    } else {
      // 默认验证：检查是否有输出
      this.status = agent_state?.output ? 'passed' : 'pending';
    }
    this.validated_at = new Date().toISOString();
    return this.status === 'passed';
  }
}

export class CheckpointManager {
  constructor() {
    this.checkpoints = [];
  }

  /**
   * 创建检查点
   */
  create({ goal, expected_outcomes, validation_fn, metadata = {} }) {
    const checkpoint = new Checkpoint({ goal, expected_outcomes, validation_fn });
    checkpoint.metadata = metadata;
    this.checkpoints.push(checkpoint);
    return checkpoint;
  }

  /**
   * 验证所有检查点
   */
  validateAll(agent_state) {
    const results = [];
    for (const cp of this.checkpoints) {
      if (cp.status === 'pending') {
        cp.validate(agent_state);
      }
      results.push({ id: cp.id, goal: cp.goal, status: cp.status });
    }
    return results;
  }

  /**
   * 获取待验证的检查点
   */
  getPending() {
    return this.checkpoints.filter(cp => cp.status === 'pending');
  }

  /**
   * 获取失败的检查点
   */
  getFailed() {
    return this.checkpoints.filter(cp => cp.status === 'failed');
  }

  /**
   * 获取检查点列表
   */
  list() {
    return this.checkpoints.map(cp => ({
      id: cp.id,
      goal: cp.goal,
      status: cp.status,
      created_at: cp.created_at,
      validated_at: cp.validated_at
    }));
  }
}
```

- [ ] **Step 2: 提交**

```bash
git add src/runtime/checkpoint.mjs
git commit -m "feat(runtime): add checkpoint system for track validation"
```

---

## Task 3: 集成 AgentLoop 到 agentRuntime

**Files:**
- Modify: `src/runtime/agentRuntime.mjs`

- [ ] **Step 1: 添加 AgentLoop 导入和初始化**

在 agentRuntime.mjs 中找到运行时初始化部分，添加：

```javascript
import { AgentLoop } from './agentLoop.mjs';

// 在 Runtime 初始化时创建 loop
const agentLoop = new AgentLoop({
  maxIterations: 100,
  loopThreshold: 3,
  autoContinue: true,
  contextThreshold: 0.8
});
```

- [ ] **Step 2: 修改 runAgentTurn 集成 loop**

找到 `runAgentTurn` 函数，在执行后添加：

```javascript
// 记录循环步骤
const loopResult = agentLoop.recordStep({
  output: result.response,
  timestamp: Date.now()
});

if (loopResult.stopped) {
  return {
    ...result,
    loopStopped: true,
    stopReason: loopResult.reason
  };
}
```

- [ ] **Step 3: 提交**

```bash
git add src/runtime/agentRuntime.mjs
git commit -m "feat(runtime): integrate AgentLoop into agent execution"
```

---

## Task 4: 添加 Loop API 端点

**Files:**
- Modify: `src/server.mjs`

- [ ] **Step 1: 添加 loop API**

```javascript
// GET /api/agent/loop/status - 获取循环状态
app.get('/api/agent/loop/status', (req, res) => {
  try {
    const status = agentLoop.getStatus();
    sendJson(res, 200, { success: true, ...status });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

// POST /api/agent/loop/start - 启动循环
app.post('/api/agent/loop/start', (req, res) => {
  try {
    agentLoop.start();
    sendJson(res, 200, { success: true, state: agentLoop.state });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

// POST /api/agent/loop/stop - 停止循环
app.post('/api/agent/loop/stop', (req, res) => {
  try {
    agentLoop.stop();
    sendJson(res, 200, { success: true, state: agentLoop.state });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

// POST /api/agent/loop/pause - 暂停循环
app.post('/api/agent/loop/pause', (req, res) => {
  try {
    agentLoop.pause();
    sendJson(res, 200, { success: true, state: agentLoop.state });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});
```

- [ ] **Step 2: 提交**

```bash
git add src/server.mjs
git commit -m "feat(api): add agent loop control endpoints"
```

---

## Task 5: 验证 Agent Loop

- [ ] **Step 1: 验证模块加载**

```bash
node -e "import('./src/runtime/agentLoop.mjs').then(m => { console.log('AgentLoop:', typeof m.AgentLoop); console.log('LoopState:', typeof m.LoopState); })"
```

- [ ] **Step 2: 验证 checkpoint 模块**

```bash
node -e "import('./src/runtime/checkpoint.mjs').then(m => { console.log('Checkpoint:', typeof m.Checkpoint); console.log('CheckpointManager:', typeof m.CheckpointManager); })"
```

- [ ] **Step 3: 提交**

```bash
git add --all
git commit -m "test: verify agent loop implementation"
```