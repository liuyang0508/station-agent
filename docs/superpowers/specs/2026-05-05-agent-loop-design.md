# Agent Loop Design

**Date:** 2026-05-05
**Status:** Draft

## Overview

实现 Agent 的自动循环执行机制：自动继续任务直到完成，检测死循环并终止，必要时压缩上下文保持连续性。

---

## 1. Core Capabilities

| Capability | Trigger | Action |
|------------|---------|--------|
| **Auto-Continue** | Step completes without user input | Automatically start next step |
| **Loop Detection** | Same output N times | Stop and report |
| **Context Compression** | Context near full | Compact history, keep key decisions |

## 2. Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Agent Runtime                          │
│                                                          │
│  ┌──────────────┐         ┌──────────────┐             │
│  │  Loop       │ ──────► │  Context    │             │
│  │  Controller │  检测    │  Compactor  │             │
│  └──────────────┘         └──────────────┘             │
│         │                                                 │
│         ▼                                                 │
│  ┌──────────────┐         ┌──────────────┐             │
│  │  Decision   │         │  Safety     │             │
│  │  Boundary   │         │  Guardrails │             │
│  └──────────────┘         └──────────────┘             │
└─────────────────────────────────────────────────────────┘
```

## 3. Loop Controller

### 3.1 State Machine

```
IDLE → RUNNING → WAITING → RUNNING → ... → DONE
                  ↓
               LOOP_DETECTED → STOPPED
              (same output N times)
```

### 3.2 Configuration

```javascript
const loopConfig = {
  maxIterations: 100,        // 最大循环次数
  loopThreshold: 3,         // 相同输出次数阈值
  idleWaitMs: 100,          // 等待用户输入时间
  autoContinue: true,        // 是否自动继续
  contextThreshold: 0.8      // 上下文压缩阈值 (80%)
};
```

## 4. Loop Detection

### 4.1 Pattern Matching

```javascript
function detectLoop(history) {
  const outputs = history.map(h => h.output);
  const lastN = outputs.slice(-loopThreshold);

  // 检测完全相同
  if (allEqual(lastN)) {
    return { type: 'exact_match', count: lastN.length };
  }

  // 检测语义相似
  if (semanticSimilarity(lastN) > 0.9) {
    return { type: 'semantic_match', similarity: 0.9 };
  }

  return null;
}

function allEqual(arr) {
  return arr.every(v => v === arr[0]);
}
```

### 4.2 Termination Criteria

| Type | Condition | Action |
|------|-----------|--------|
| `exact_match` | 输出完全相同 3 次 | 停止 |
| `semantic_match` | 相似度 > 90% | 停止 |
| `max_iterations` | 达到最大次数 | 停止 |
| `user_interrupt` | 用户取消 | 停止 |

## 5. Context Compactor Integration

### 5.1 Trigger

```javascript
function shouldCompact(context) {
  const usage = estimateContextUsage(context);
  return usage > loopConfig.contextThreshold;
}
```

### 5.2 Compaction Strategy

- 保留系统提示和当前任务
- 压缩对话历史为摘要
- 保留关键决策点（用 `**决策:** 标记）
- 保留最近的 N 条完整消息

## 6. API Extensions

| Endpoint | 说明 |
|----------|------|
| `POST /api/agent/loop/start` | 启动自动循环 |
| `POST /api/agent/loop/stop` | 停止循环 |
| `GET /api/agent/loop/status` | 获取循环状态 |
| `POST /api/agent/loop/pause` | 暂停循环 |

## 7. Safety Bounds

```javascript
const safetyBounds = {
  maxLoopIterations: 100,
  maxContextTokens: 60000,
  maxStepDurationMs: 120000,
  requireCheckpointEvery: 10  // 每 10 步强制检查点
};
```

## 8. User Control

| Mode | Behavior |
|------|----------|
| `auto` | 自动循环直到完成或检测到问题 |
| `step` | 每步等待用户确认 |
| `batch` | 自动执行 N 步后停止 |

## 9. Checkpoint System

```javascript
class Checkpoint {
  constructor() {
    this.checkpoints = [];
  }

  save(state) {
    this.checkpoints.push({
      id: randomUUID(),
      state: deepClone(state),
      timestamp: Date.now()
    });
  }

  restore(checkpointId) {
    const cp = this.checkpoints.find(c => c.id === checkpointId);
    if (cp) {
      return deepClone(cp.state);
    }
    return null;
  }
}
```