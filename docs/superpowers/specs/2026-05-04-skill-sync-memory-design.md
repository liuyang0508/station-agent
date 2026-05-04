# Skill Sync & Memory Auto-Write Design

**Date:** 2026-05-04
**Status:** Approved

## Overview

将三个外部 skill 仓库（forrestchang/andrej-karpathy-skills、mattpocock/skills、skill-creator）嵌入 station-agent，支持启动时自动同步、描述型 skill 注入、以及对话内容的自动记忆沉淀。

---

## 1. 整体架构

```
station-agent
├── data/
│   ├── store.db                    # SqliteStore 持久化
│   ├── external-skills/            # 本地 skill 缓存
│   │   ├── forrestchang-andrej-karpathy-skills/
│   │   │   ├── skills/
│   │   │   │   ├── karpathy-guidelines/
│   │   │   │   └── SKILL.md
│   │   │   └── README.md
│   │   └── mattpocock-skills/
│   │       ├── skills/
│   │       │   ├── tdd/
│   │       │   ├── grill-me/
│   │       │   ├── skill-creator/
│   │       │   └── ... (全部 skill)
│   │       └── README.md
│   ├── backups/                    # 本地修改备份
│   │   └── YYYY-MM-DD/
│   └── skills-index.json          # 索引文件（含版本、更新时间）
```

**核心组件**：
- `SkillSyncManager` — 负责从 GitHub 拉取并同步 skill
- `SkillRegistry` — 内存索引，支持快速查询
- 扩展 `SqliteStore.installSkill()` — 支持从文件解析安装

---

## 2. Skill 同步流程

### 启动时 SyncWorkflow

1. 读取 `data/skills-index.json`（索引）
2. 遍历配置的 GitHub URL
3. 对每个仓库：
   - 获取文件列表（通过 GitHub API）
   - 扫描所有 `SKILL.md` / `SOUL.md` / `AGENT.md`
   - 解析 frontmatter + body
   - 检查本地是否已有该 skill（按 `source` + `name` 匹配）
   - 若存在且已修改 → 备份到 `data/external-skills/backups/YYYY-MM-DD/skill-name/`
   - 写入/更新 SqliteStore（skills 表）
   - 复制文件到 `data/external-skills/{repo}/{skill-path}/`
4. 更新 `skills-index.json`（version、lastSync）

### 备份格式

```
data/external-skills/backups/2026-05-04/karpathy-guidelines/SKILL.md
data/external-skills/backups/2026-05-04/karpathy-guidelines/.metadata.json  # 修改时间、来源
```

### 索引文件格式

```json
{
  "lastFullSync": "2026-05-04T10:30:00Z",
  "sources": [
    {
      "url": "https://github.com/forrestchang/andrej-karpathy-skills",
      "branch": "main",
      "lastCommit": "abc123"
    },
    {
      "url": "https://github.com/mattpocock/skills",
      "branch": "main",
      "lastCommit": "def456"
    }
  ]
}
```

### 配置的 GitHub 源

| 仓库 | 默认分支 | 扫描路径 |
|------|---------|---------|
| forrestchang/andrej-karpathy-skills | main | skills/*/SKILL.md, CLAUDE.md |
| mattpocock/skills | main | skills/*/SKILL.md |

---

## 3. Skill 解析与存储

### 支持的格式

| 格式 | 文件 | 解析器 |
|------|------|--------|
| SKILL.md | 独立 skill | `parseSkillMarkdown()`（已有） |
| CLAUDE.md | 行为准则 | 解析为 `SOUL.md` 格式 |
| SOUL.md | 灵魂技能 | `parseSoulMarkdown()`（已有） |
| AGENT.md | Agent 技能 | `parseAgentMarkdown()`（已有） |

### 存入 SqliteStore.skills 表

```javascript
{
  id: randomUUID(),
  name: frontmatter.name || file.stem,
  description: frontmatter.description || body.slice(0, 200),
  source: 'external:github/{repo}',
  entrypoint: '',
  command: '',
  args: [],
  metadata: {
    format: 'SKILL.md',
    repo: 'forrestchang/andrej-karpathy-skills',
    repoPath: 'skills/karpathy-guidelines',
    body: body,
    frontmatter: frontmatter,
    syncedAt: now()
  },
  enabled: true,
  installedAt: now(),
  updatedAt: now()
}
```

### 关键点

这些是**纯描述型 skill**，不执行脚本，只在运行时注入到 system prompt 或工具描述中。

---

## 4. Memory 自动写入机制

### 触发条件（满足任一）

- 用户说"记住..."、"save to memory"、"沉淀到记忆"
- Agent 完成重要决策（如架构选型、方案确认）
- 对话中出现 `source: 'memory'` 的 skill 被调用

### 处理流程

```
1. 拦截 addMessage() 或 runSkill() 的返回值
2. 检测是否包含待沉淀内容（带 trigger 标记）
3. 调用 store.createMemory({
     title: extractedTitle,
     content: extractedContent,
     tags: ['auto', 'skill-name'],
     source: 'auto:{skill-name}'
   })
4. 同时调用 store.createMemoryEmbedding()（如果 embedding 可用）
```

### Memory Skill 关联

当 `memory-loop` skill 被触发时，`searchMemoriesByVector` 结果作为上下文传给 runtime。

---

## 5. API 扩展

### Skill Sync

- `POST /api/skills/sync` — 手动触发全量同步
- `GET /api/skills/sync/status` — 获取同步状态
- `POST /api/skills/sync/source` — 添加/更新同步源

### Memory

- `POST /api/memories/auto` — 设置自动写入策略
- `GET /api/memories` — 已有记忆列表

---

## 6. 实现计划

### Phase 1: Skill Registry 基础设施
- 创建 `src/lib/skillRegistry.mjs`
- 实现 GitHub 文件拉取逻辑
- 实现 skill 解析和安装

### Phase 2: Sync Manager
- 创建 `src/lib/skillSyncManager.mjs`
- 实现备份逻辑
- 实现索引文件管理

### Phase 3: Memory Auto-Write
- 修改 `server.mjs` 中的消息处理
- 实现触发检测逻辑

### Phase 4: API 集成
- 添加同步相关 API
- 添加 memory 策略配置 API