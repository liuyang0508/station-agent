# Harness Engineering 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 Harness Engineering 机制：轨道检查点、决策验证器、约束执行器和回滚管理器，保障 Agent 不偏离轨道。

**Architecture:** Harness 作为运行时保护层，与 AgentLoop 共享基础设施。核心组件：DecisionValidator + ConstraintEnforcer + RollbackManager。

**Tech Stack:** Node.js ESM, State Machine

---

## File Structure

```
src/runtime/
├── harness.mjs               # 新建: Harness 主模块
├── decisionValidator.mjs     # 新建: 决策验证器
├── constraintEnforcer.mjs    # 新建: 约束执行器
├── rollbackManager.mjs       # 新建: 回滚管理器
src/runtime/agentRuntime.mjs  # 修改: 集成 harness
src/server.mjs               # 修改: 添加 harness API
```

---

## Task 1: 创建 decisionValidator.mjs 决策验证器

**Files:**
- Create: `src/runtime/decisionValidator.mjs`

- [ ] **Step 1: 创建 decisionValidator.mjs**

```javascript
/**
 * DecisionValidator - 验证 Agent 决策是否合理
 */

export class DecisionValidator {
  constructor() {
    this.rules = [
      // 范围蔓延检测
      {
        type: 'scope_creep',
        severity: 'warn',
        check: (decision, context) => {
          // 检测是否超出原定任务范围
          if (context.goal && decision.content) {
            const goalKeywords = this._extractKeywords(context.goal);
            const decisionKeywords = this._extractKeywords(decision.content);
            const overlap = goalKeywords.filter(k => decisionKeywords.includes(k));
            return overlap.length > 0;
          }
          return true;
        }
      },
      // 决策一致性检测
      {
        type: 'consistency',
        severity: 'block',
        check: (decision, context) => {
          if (!context.history || context.history.length < 2) return true;

          const recent = context.history.slice(-3);
          // 检测是否推翻了近期决策
          for (const h of recent) {
            if (h.role === 'assistant' && h.content !== decision.content) {
              // 检查是否有明显的逆转
              if (this._isReversal(decision.content, h.content)) {
                return false;
              }
            }
          }
          return true;
        }
      },
      // 置信度匹配检测
      {
        type: 'confidence_mismatch',
        severity: 'warn',
        check: (decision) => {
          // 如果决策很重要，置信度不能太低
          const importance = decision.importance || 'medium';
          const confidence = decision.confidence || 0.5;

          const thresholds = {
            high: 0.7,
            medium: 0.5,
            low: 0.3
          };

          return confidence >= thresholds[importance];
        }
      }
    ];
  }

  /**
   * 验证决策
   */
  validate(decision, context = {}) {
    const issues = [];

    for (const rule of this.rules) {
      if (!rule.check(decision, context)) {
        issues.push({
          type: rule.type,
          severity: rule.severity,
          message: this._getMessage(rule.type)
        });
      }
    }

    return {
      valid: issues.filter(i => i.severity === 'block').length === 0,
      issues
    };
  }

  /**
   * 添加自定义规则
   */
  addRule(rule) {
    this.rules.push(rule);
  }

  _extractKeywords(text) {
    if (!text) return [];
    return text.toLowerCase().split(/\W+/).filter(w => w.length > 3);
  }

  _isReversal(newContent, oldContent) {
    const reversalPatterns = [
      /不对/, /错/, /取消/, /不是这样/, /重新/,
      /actually no/, /wait/, /actually,/
    ];
    const hasReversal = reversalPatterns.some(p => newContent.match(p));
    return hasReversal && this._similarity(newContent, oldContent) > 0.3;
  }

  _similarity(a, b) {
    const setA = new Set(this._extractKeywords(a));
    const setB = new Set(this._extractKeywords(b));
    const intersection = [...setA].filter(x => setB.has(x));
    const union = new Set([...setA, ...setB]);
    return intersection.length / union.size;
  }

  _getMessage(type) {
    const messages = {
      scope_creep: '检测到可能的范围蔓延',
      consistency: '决策与历史不一致，可能推翻了之前的结论',
      confidence_mismatch: '置信度与决策重要性不匹配'
    };
    return messages[type] || '未知问题';
  }
}
```

- [ ] **Step 2: 提交**

```bash
git add src/runtime/decisionValidator.mjs
git commit -m "feat(runtime): add DecisionValidator for agent decisions"
```

---

## Task 2: 创建 constraintEnforcer.mjs 约束执行器

**Files:**
- Create: `src/runtime/constraintEnforcer.mjs`

- [ ] **Step 1: 创建 constraintEnforcer.mjs**

```javascript
/**
 * ConstraintEnforcer - 执行操作约束
 */

export const ConstraintType = {
  HARD: 'hard',      // 绝对不能违反
  SOFT: 'soft',      // 尽量不要违反
  OPTIMIZATION: 'optimization'  // 优化目标
};

export class ConstraintEnforcer {
  constructor() {
    this.constraints = this._defaultConstraints();
  }

  /**
   * 默认约束
   */
  _defaultConstraints() {
    return [
      {
        id: 'no_destructive',
        type: ConstraintType.HARD,
        rule: (action) => {
          const destructivePatterns = [
            /rm\s+-rf/, /del\s+\/s\/q/i, /format/i,
            /drop\s+table/i, /delete\s+from\s+\*/i
          ];
          const cmd = action.command || action.content || '';
          return !destructivePatterns.some(p => cmd.match(p));
        },
        message: '禁止执行破坏性操作'
      },
      {
        id: 'workspace_boundary',
        type: ConstraintType.HARD,
        rule: (action, context) => {
          // 检查操作是否在工作区内
          if (!context.workspaceRoot) return true;
          const cmd = action.command || '';
          // 简单检查，实际需要更复杂的路径验证
          return !cmd.match(/^\.\.\//);  // 不允许父目录访问
        },
        message: '操作必须在工作区内'
      },
      {
        id: 'approval_required',
        type: ConstraintType.SOFT,
        rule: (action) => {
          const highRiskPatterns = [
            /sudo/, /chmod\s+777/, /kill\s+-9/,
            /curl\s+http/, /wget\s+http/
          ];
          const cmd = action.command || '';
          return !highRiskPatterns.some(p => cmd.match(p));
        },
        message: '高风险操作需要额外确认'
      }
    ];
  }

  /**
   * 检查操作是否满足约束
   */
  check(action, context = {}) {
    const results = {
      allowed: true,
      hardViolations: [],
      softViolations: [],
      warnings: []
    };

    for (const constraint of this.constraints) {
      const passed = constraint.rule(action, context);

      if (!passed) {
        if (constraint.type === ConstraintType.HARD) {
          results.allowed = false;
          results.hardViolations.push({
            id: constraint.id,
            message: constraint.message
          });
        } else if (constraint.type === ConstraintType.SOFT) {
          results.softViolations.push({
            id: constraint.id,
            message: constraint.message
          });
        }
      }
    }

    return results;
  }

  /**
   * 添加自定义约束
   */
  addConstraint(constraint) {
    this.constraints.push(constraint);
  }

  /**
   * 移除约束
   */
  removeConstraint(id) {
    this.constraints = this.constraints.filter(c => c.id !== id);
  }

  /**
   * 获取所有约束
   */
  list() {
    return this.constraints.map(c => ({
      id: c.id,
      type: c.type,
      message: c.message
    }));
  }
}
```

- [ ] **Step 2: 提交**

```bash
git add src/runtime/constraintEnforcer.mjs
git commit -m "feat(runtime): add ConstraintEnforcer for operation safety"
```

---

## Task 3: 创建 rollbackManager.mjs 回滚管理器

**Files:**
- Create: `src/runtime/rollbackManager.mjs`

- [ ] **Step 1: 创建 rollbackManager.mjs**

```javascript
/**
 * RollbackManager - 状态快照和回滚
 */

import { randomUUID } from 'node:crypto';

export class RollbackManager {
  constructor(maxSnapshots = 10) {
    this.maxSnapshots = maxSnapshots;
    this.snapshots = [];
  }

  /**
   * 创建快照
   */
  snapshot(state, metadata = {}) {
    const snapshot = {
      id: randomUUID(),
      timestamp: Date.now(),
      state: this._deepClone(state),
      metadata
    };

    this.snapshots.push(snapshot);

    // 保持最大快照数
    while (this.snapshots.length > this.maxSnapshots) {
      this.snapshots.shift();
    }

    return snapshot.id;
  }

  /**
   * 回滚到快照
   */
  rollback(snapshotId) {
    const snapshot = this.snapshots.find(s => s.id === snapshotId);
    if (snapshot) {
      return this._deepClone(snapshot.state);
    }
    return null;
  }

  /**
   * 回滚到最新快照
   */
  rollbackLast() {
    if (this.snapshots.length > 0) {
      const last = this.snapshots[this.snapshots.length - 1];
      return this._deepClone(last.state);
    }
    return null;
  }

  /**
   * 获取快照列表
   */
  list() {
    return this.snapshots.map(s => ({
      id: s.id,
      timestamp: s.timestamp,
      metadata: s.metadata
    }));
  }

  /**
   * 清空快照
   */
  clear() {
    this.snapshots = [];
  }

  /**
   * 深度克隆
   */
  _deepClone(obj) {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this._deepClone(item));
    }

    const clone = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        clone[key] = this._deepClone(obj[key]);
      }
    }
    return clone;
  }
}
```

- [ ] **Step 2: 提交**

```bash
git add src/runtime/rollbackManager.mjs
git commit -m "feat(runtime): add RollbackManager for state recovery"
```

---

## Task 4: 创建 harness.mjs Harness 主模块

**Files:**
- Create: `src/runtime/harness.mjs`

- [ ] **Step 1: 创建 harness.mjs**

```javascript
/**
 * Harness - Agent 运行时保护层
 *
 * 整合 DecisionValidator, ConstraintEnforcer, RollbackManager
 */

import { DecisionValidator } from './decisionValidator.mjs';
import { ConstraintEnforcer } from './constraintEnforcer.mjs';
import { RollbackManager } from './rollbackManager.mjs';

export class Harness {
  constructor(options = {}) {
    this.validator = new DecisionValidator();
    this.enforcer = new ConstraintEnforcer();
    this.rollback = new RollbackManager(options.maxSnapshots || 10);
    this.enabled = options.enabled !== false;
  }

  /**
   * 验证决策
   */
  validateDecision(decision, context = {}) {
    if (!this.enabled) return { valid: true, issues: [] };
    return this.validator.validate(decision, context);
  }

  /**
   * 检查操作约束
   */
  checkConstraint(action, context = {}) {
    if (!this.enabled) return { allowed: true };
    return this.enforcer.check(action, context);
  }

  /**
   * 保存检查点
   */
  saveCheckpoint(state, label = '', metadata = {}) {
    return this.rollback.snapshot(state, { label, ...metadata });
  }

  /**
   * 回滚
   */
  rollbackTo(checkpointId) {
    return this.rollback.rollback(checkpointId);
  }

  /**
   * 获取状态
   */
  getStatus() {
    return {
      enabled: this.enabled,
      snapshots: this.rollback.list().length,
      constraints: this.enforcer.list()
    };
  }

  /**
   * 启用/禁用
   */
  setEnabled(enabled) {
    this.enabled = enabled;
  }

  /**
   * 添加决策规则
   */
  addDecisionRule(rule) {
    this.validator.addRule(rule);
  }

  /**
   * 添加约束
   */
  addConstraint(constraint) {
    this.enforcer.addConstraint(constraint);
  }
}
```

- [ ] **Step 2: 提交**

```bash
git add src/runtime/harness.mjs
git commit -m "feat(runtime): add Harness main module integrating all protectors"
```

---

## Task 5: 集成 Harness 到 agentRuntime

**Files:**
- Modify: `src/runtime/agentRuntime.mjs`

- [ ] **Step 1: 集成 Harness**

在 agentRuntime.mjs 中添加：

```javascript
import { Harness } from './harness.mjs';

// 在 Runtime 初始化时创建 harness
const harness = new Harness({
  enabled: true,
  maxSnapshots: 10
});

// 在执行决策前验证
function validateWithHarness(decision, context) {
  const validation = harness.validateDecision(decision, context);
  if (!validation.valid) {
    throw new Error(`Decision blocked: ${validation.issues.map(i => i.message).join(', ')}`);
  }
  return validation;
}

// 在执行操作前检查约束
function checkWithHarness(action, context) {
  const result = harness.checkConstraint(action, context);
  if (!result.allowed) {
    throw new Error(`Action blocked: ${result.hardViolations.map(v => v.message).join(', ')}`);
  }
  return result;
}
```

- [ ] **Step 2: 提交**

```bash
git add src/runtime/agentRuntime.mjs
git commit -m "feat(runtime): integrate Harness into agent execution"
```

---

## Task 6: 添加 Harness API 端点

**Files:**
- Modify: `src/server.mjs`

- [ ] **Step 1: 添加 Harness API**

```javascript
// GET /api/harness/status - 获取 harness 状态
app.get('/api/harness/status', (req, res) => {
  try {
    const status = harness.getStatus();
    sendJson(res, 200, { success: true, ...status });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

// POST /api/harness/checkpoint - 创建检查点
app.post('/api/harness/checkpoint', (req, res) => {
  try {
    const { state, label, metadata } = req.body;
    const checkpointId = harness.saveCheckpoint(state, label, metadata);
    sendJson(res, 200, { success: true, checkpointId });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

// POST /api/harness/rollback - 回滚
app.post('/api/harness/rollback', (req, res) => {
  try {
    const { checkpointId } = req.body;
    const state = harness.rollbackTo(checkpointId);
    if (state) {
      sendJson(res, 200, { success: true, state });
    } else {
      sendJson(res, 404, { error: 'Checkpoint not found' });
    }
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

// GET /api/harness/constraints - 获取约束列表
app.get('/api/harness/constraints', (req, res) => {
  try {
    const constraints = harness.enforcer.list();
    sendJson(res, 200, { success: true, constraints });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});
```

- [ ] **Step 2: 提交**

```bash
git add src/server.mjs
git commit -m "feat(api): add harness management endpoints"
```

---

## Task 7: 验证 Harness

- [ ] **Step 1: 验证模块加载**

```bash
node -e "import('./src/runtime/harness.mjs').then(m => { console.log('Harness:', typeof m.Harness); })"
node -e "import('./src/runtime/decisionValidator.mjs').then(m => { console.log('DecisionValidator:', typeof m.DecisionValidator); })"
node -e "import('./src/runtime/constraintEnforcer.mjs').then(m => { console.log('ConstraintEnforcer:', typeof m.ConstraintEnforcer); })"
node -e "import('./src/runtime/rollbackManager.mjs').then(m => { console.log('RollbackManager:', typeof m.RollbackManager); })"
```

- [ ] **Step 2: 提交**

```bash
git add --all
git commit -m "test: verify harness engineering implementation"
```