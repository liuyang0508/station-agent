# Skill Evolution 触发逻辑实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 skill 执行后的自动评估和进化逻辑，当满足特定条件时自动触发 PATCH/EVOLVE/CREATE/ARCHIVE 动作。

**Architecture:** Skill Evolution 逻辑已在 src/lib/skillEvolution.mjs 实现。主要工作是将 runSkill() 的执行结果与 evolution.evaluate() 集成，并添加 API 端点。

**Tech Stack:** Node.js ESM, SQLite store

---

## File Structure

```
src/lib/skillEvolution.mjs    # 已存在: 核心 evolution 引擎
src/lib/skillManager.mjs     # 修改: 集成 evolution 评估调用
src/server.mjs                # 修改: 添加 evolution API 端点
```

---

## Task 1: 确认 skillEvolution.mjs 完整性

**Files:**
- Read: `src/lib/skillEvolution.mjs`
- Test: `src/lib/__tests__/skillEvolution.test.mjs` (新建)

- [ ] **Step 1: 确认 evaluate() 方法存在且正确**

检查 evaluate 方法签名：
```javascript
evaluate(skillRun, context = {}) {
  // skillRun: { skillId, status, durationMs, error, input, output }
  // context: { userFeedback, newWorkflow, session }
  // returns: Evolution suggestion or null
}
```

- [ ] **Step 2: 确认 evolve() 方法存在且正确**

检查 evolve 方法签名：
```javascript
async evolve(skillId, evolution) {
  // 应用 PATCH/EVOLVE/CREATE/ARCHIVE 动作
  // 返回 evolution entry
}
```

- [ ] **Step 3: 确认 store 有 addEvolutionEntry 方法**

SQLite store 已实现 `addEvolutionEntry` 和 `listEvolutionEntries`。

- [ ] **Step 4: 提交**

```bash
git add --all
git commit -m "test: verify skillEvolution module exists and has required methods"
```

---

## Task 2: 修改 skillManager.mjs 集成 evolution 评估

**Files:**
- Modify: `src/lib/skillManager.mjs`

- [ ] **Step 1: 在 runSkill() 末尾添加 evolution 评估调用**

找到 `runSkill` 函数（约第 268 行），在返回 `recordSkillRun` 之后添加：

```javascript
// 触发 evolution 评估（异步，不阻塞 skill 返回）
const evolution = skillEvolution.evaluate(runRecord, {
  context: {
    session: null, // 可传入当前 session context
    userFeedback: null
  }
});

if (evolution) {
  // 异步执行 evolution，不阻塞响应
  skillEvolution.evolve(skillId, evolution).catch(err => {
    console.error('Evolution failed:', err);
  });
}
```

需要在文件顶部添加 import：
```javascript
import { createSkillEvolution } from './skillEvolution.mjs';
```

在 runSkill 函数开头添加初始化：
```javascript
const skillEvolution = createSkillEvolution(store);
```

- [ ] **Step 2: 提交**

```bash
git add src/lib/skillManager.mjs
git commit -m "feat(skillManager): integrate evolution evaluation after skill run"
```

---

## Task 3: 添加 Evolution API 端点

**Files:**
- Modify: `src/server.mjs`

- [ ] **Step 1: 添加 Evolution 相关 API 端点**

```javascript
// GET /api/skills/:id/evolution - 获取 skill 进化历史
app.get('/api/skills/:id/evolution', (req, res) => {
  try {
    const entries = store.listEvolutionEntries(req.params.id);
    res.json({ success: true, entries });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/skills/:id/evolution - 手动触发进化
app.post('/api/skills/:id/evolution', async (req, res) => {
  try {
    const { action, trigger, delta } = req.body;
    const evolution = {
      action,
      trigger,
      delta,
      reason: 'Manual trigger'
    };
    const entry = await skillEvolution.evolve(req.params.id, evolution);
    res.json({ success: true, entry });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/skills/evolution/history - 全局进化历史
app.get('/api/skills/evolution/history', (req, res) => {
  try {
    const entries = store.listEvolutionEntries();
    res.json({ success: true, entries });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

- [ ] **Step 2: 提交**

```bash
git add src/server.mjs
git commit -m "feat(api): add evolution endpoints for skill history and manual trigger"
```

---

## Task 4: 添加 Evolution 配置到 Skill Metadata

**Files:**
- Modify: `src/lib/skillManager.mjs`
- Test: `src/lib/__tests__/skillEvolution.test.mjs`

- [ ] **Step 1: 确认 skill 安装时默认包含 evolution 配置**

在 installSkillFromWorkspace 中（约第 257 行）确认有：

```javascript
metadata: {
  // ...
  evolution: {
    enabled: true,
    triggers: [
      { type: 'repeated_failure', threshold: 2 },
      { type: 'repeated_success', threshold: 5 }
    ]
  }
}
```

- [ ] **Step 2: 提交**

```bash
git add src/lib/skillManager.mjs
git commit -m "feat(skillManager): ensure evolution config is set on skill install"
```

---

## Task 5: 验证 Evolution 流程

- [ ] **Step 1: 测试 evolution 评估逻辑**

```javascript
// 测试代码
const testRun = {
  skillId: 'test-skill',
  status: 'failed',
  error: 'ENOENT: file not found',
  durationMs: 5000
};

const evolution = skillEvolution.evaluate(testRun, {});
console.log('Evolution result:', evolution);
```

- [ ] **Step 2: 提交**

```bash
git add --all
git commit -m "test: add evolution evaluation tests"
```