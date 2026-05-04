# Skill Evolution Trigger Logic Design

**Date:** 2026-05-05
**Status:** Approved

## Overview

实现 Skill Evolution 的自动触发逻辑：当 skill 执行满足特定条件时，自动评估是否需要进化，并执行相应动作。

---

## 1. Architecture

```
skill.run() → recordSkillRun()
                    ↓
         evolution.evaluate(skillRun, context)
                    ↓
         [shouldEvolve = true]
                    ↓
         evolution.evolve(skillId, evolution)
                    ↓
         store.updateSkill() / createSkill() / toggleSkill()
```

## 2. Trigger Conditions

| Trigger | Threshold | Action |
|---------|-----------|--------|
| `repeated_failure` | 2 次失败 | PATCH - 添加错误处理 |
| `repeated_success` | 5 次成功 | EVOLVE - 增强描述 |
| `user_feedback` | 用户纠正 | PATCH - 应用修正 |
| `timeout_then_success` | 超时后成功 | EVOLVE - 优化超时 |
| `new_pattern` | 重复工作流 | CREATE - 新建 skill |

## 3. Evolution Actions

| Action | 描述 | 应用场景 |
|--------|------|---------|
| PATCH | 打补丁 | 失败后添加错误处理 |
| EVOLVE | 进化 | 成功后优化描述 |
| CREATE | 创建 | 检测到重复工作流 |
| ARCHIVE | 归档 | 长期失败后禁用 |

## 4. Implementation

### 4.1 Modify `src/lib/skillManager.mjs`

```javascript
// 在 runSkill() 中
const result = await runSkill({ store, settings, skillId, input });

// 记录执行并触发 evolution
const runRecord = store.recordSkillRun({
  skillId,
  status: result.ok ? 'completed' : 'failed',
  input,
  output: result.stdout || '',
  error: result.stderr || ''
});

// 触发 evolution 评估（异步，不阻塞）
if (!result.ok || result.ok) {
  const evolution = skillEvolution.evaluate(runRecord, { context });
  if (evolution) {
    skillEvolution.evolve(skillId, evolution);
  }
}
```

### 4.2 Evolution Entry Storage

```javascript
// store.addEvolutionEntry() 已有
// 记录每次 evolution 评估和执行
{
  id, skillId, trigger, delta, result,
  applied: boolean, createdAt
}
```

### 4.3 Evolution Configuration in Skill

```javascript
{
  id: 'tdd',
  name: 'TDD Skill',
  metadata: {
    evolution: {
      enabled: true,
      triggers: [
        { type: 'repeated_failure', threshold: 2 },
        { type: 'repeated_success', threshold: 5 }
      ]
    }
  }
}
```

## 5. API Extensions

- `GET /api/skills/:id/evolution` — 获取 skill 进化历史
- `POST /api/skills/:id/evolution` — 手动触发进化
- `GET /api/skills/evolution/history` — 全局进化历史

## 6. External Skill Integration

外部 skill（如 mattpocock/skills）默认不开启 evolution。可通过 metadata 配置：

```javascript
{
  metadata: {
    format: 'SKILL.md',
    repo: 'mattpocock/skills/tdd',
    evolution: { enabled: false }  // 默认关闭
  }
}
```

## 7. Frontmatter Support

```yaml
---
name: tdd
description: Test-driven development skill
evolution:
  enabled: true
  triggers:
    - repeated_failure: 2
    - repeated_success: 5
---
```

## 8. Key Constraints

1. **非阻塞** — evolution 评估异步执行，不影响 skill 响应速度
2. **可回滚** — evolution entry 记录完整，可追溯
3. **用户可控** — 可通过设置关闭自动 evolution
4. **外部 skill 默认关闭** — 避免污染上游 skill