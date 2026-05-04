# Harness Engineering Design

**Date:** 2026-05-05
**Status:** Draft

## Overview

Harness Engineering 是 OpenAI 提出的理念：**让 Agent 不偏离轨道，同时保持强大稳健的决策能力**。通过轨道检查点、决策边界和异常恢复机制实现。

---

## 1. Core Principles

| Principle | Description |
|-----------|-------------|
| **Stay on Track** | Agent 始终朝向目标努力 |
| **Robust Decisions** | 决策有充分依据，不过度自信 |
| **Safe Recovery** | 偏离时能自动恢复到正确状态 |

## 2. Harness Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Agent + Harness                       │
│                                                          │
│  ┌──────────────┐         ┌──────────────┐             │
│  │  Track       │ ──────► │  Decision   │             │
│  │  Checkpoints │  验证    │  Validator  │             │
│  └──────────────┘         └──────────────┘             │
│         │                        │                        │
│         ▼                        ▼                        │
│  ┌──────────────┐         ┌──────────────┐             │
│  │  Rollback   │         │  Constraint  │             │
│  │  Manager    │         │  Enforcer    │             │
│  └──────────────┘         └──────────────┘             │
└─────────────────────────────────────────────────────────┘
```

## 3. Track Checkpoints

### 3.1 Definition

Checkpoint 是任务执行过程中的"里程牌"，用于验证 Agent 是否在正确方向上。

```javascript
class TrackCheckpoint {
  constructor({ goal, expected_outcomes, validation_fn }) {
    this.goal = goal;
    this.expected_outcomes = expected_outcomes;  // 预期结果
    this.validation_fn = validation_fn;            // 验证函数
    this.status = 'pending';
  }

  validate(agent_state) {
    return this.validation_fn(agent_state, this.expected_outcomes);
  }
}
```

### 3.2 Default Checkpoints

| Checkpoint | Timing | Validation |
|------------|--------|------------|
| `goal_confirmed` | 开始前 | 目标是否清晰可衡量 |
| `approach_validated` | 第一步后 | 方法是否合理 |
| `mid_point_review` | 50% 进度 | 是否仍朝向目标 |
| `completion_validated` | 完成后 | 结果是否满足目标 |

## 4. Decision Validator

### 4.1 Validation Rules

```javascript
const decisionRules = [
  {
    type: 'scope_creep',
    check: (decision) => {
      // 检测是否超出原定范围
      return !decision.addsNewRequirements();
    },
    on_fail: 'warn'  // warn | block | rollback
  },
  {
    type: 'reversal',
    check: (decision, history) => {
      // 检测是否推翻了之前的决策
      return !history.recentlyReversed(decision);
    },
    on_fail: 'block'
  },
  {
    type: 'confidence_mismatch',
    check: (decision) => {
      // 检测置信度是否与决策重要性匹配
      return decision.confidence >= decision.importance;
    },
    on_fail: 'warn'
  }
];
```

### 4.2 Confidence Scoring

```javascript
function scoreConfidence(decision) {
  const factors = {
    evidence: decision.evidence?.length || 0,      // 证据数量
    consensus: decision.agreedBy?.length || 0,       // 共识程度
    reversions: decision.reversionCount || 0,        // 是否被回滚过
    time_spent: decision.analysisTime || 0           // 分析时间
  };

  return {
    evidenceWeight: 0.4,
    consensusWeight: 0.2,
    stabilityWeight: 0.3,
    deliberationWeight: 0.1
  };
}
```

## 5. Constraint Enforcer

### 5.1 Constraint Types

| Type | Description | Enforcement |
|------|-------------|--------------|
| `hard` | 绝对不能违反 | 阻止执行 |
| `soft` | 尽量不要违反 | 警告 + 记录 |
| `optimization` | 优化目标 | 评分影响 |

### 5.2 Default Constraints

```javascript
const defaultConstraints = [
  {
    id: 'no_destructive',
    type: 'hard',
    rule: (action) => !action.isDestructive(),
    message: '禁止执行破坏性操作'
  },
  {
    id: 'workspace_boundary',
    type: 'hard',
    rule: (action) => action.isWithinWorkspace(),
    message: '操作必须在工作区内'
  },
  {
    id: 'approval_required',
    type: 'soft',
    rule: (action) => !action.requiresApproval(),
    message: '高风险操作需要审批'
  }
];
```

## 6. Rollback Manager

### 6.1 State Snapshots

```javascript
class RollbackManager {
  constructor(maxSnapshots = 10) {
    this.maxSnapshots = maxSnapshots;
    this.snapshots = [];
  }

  snapshot(state, metadata = {}) {
    const snapshot = {
      id: randomUUID(),
      timestamp: Date.now(),
      state: deepClone(state),
      metadata
    };
    this.snapshots.push(snapshot);
    if (this.snapshots.length > this.maxSnapshots) {
      this.snapshots.shift();
    }
    return snapshot.id;
  }

  rollback(snapshotId) {
    const snapshot = this.snapshots.find(s => s.id === snapshotId);
    if (snapshot) {
      return deepClone(snapshot.state);
    }
    return null;
  }
}
```

### 6.2 Rollback Triggers

| Trigger | Condition | Action |
|---------|-----------|--------|
| `constraint_violation` | 硬约束被违反 | 自动回滚 |
| `confidence_low` | 置信度过低 | 建议回滚 |
| `user_request` | 用户要求 | 立即回滚 |
| `loop_detected` | 检测到循环 | 回滚到检查点 |

## 7. API Extensions

| Endpoint | 说明 |
|----------|------|
| `GET /api/harness/status` | 获取 harness 状态 |
| `POST /api/harness/checkpoint` | 创建检查点 |
| `POST /api/harness/rollback` | 回滚到检查点 |
| `GET /api/harness/constraints` | 获取约束列表 |
| `POST /api/harness/constraints` | 添加自定义约束 |

## 8. Integration with Agent Loop

Harness 与 Agent Loop 共享同一个运行时保护基础设施：

```
Agent Loop                    Harness
    │                           │
    ├─► Loop Detection ────────┼─► Decision Validator
    │                           │
    ├─► Context Compaction ────┼─► Checkpoint System
    │                           │
    └─► Safety Bounds ─────────┼─► Rollback Manager
```