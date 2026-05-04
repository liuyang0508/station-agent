# Progressive Skill Loading Design

**Date:** 2026-05-05
**Status:** Draft

## Overview

实现 Skill 的渐进式加载：启动时快速加载全量缓存（SQLite），运行时按需加载到内存（Memory Cache）。

---

## 1. Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Skill System                          │
│                                                          │
│  ┌──────────────┐         ┌──────────────┐             │
│  │  SQLite      │ ──────► │  Memory      │             │
│  │  Cache       │  按需    │  Cache       │             │
│  │  (全量持久化) │  加载    │  (热点 LRU)  │             │
│  └──────────────┘         └──────────────┘             │
│         ▲                        │                      │
│         │                        ▼                      │
│  ┌──────────────┐         ┌──────────────┐             │
│  │  Skill Sync  │         │  Skill       │             │
│  │  Manager     │         │  Execution   │             │
│  └──────────────┘         └──────────────┘             │
└─────────────────────────────────────────────────────────┘
```

## 2. Two-Tier Cache

### 2.1 SQLite Cache (Tier 1 - 持久化层)

| 表/字段 | 说明 |
|---------|------|
| `skill_cache` | skill 全量元数据缓存 |
| `skill_content` | skill 内容（SOUL.md/AGENT.md 等） |
| `cache_meta` | 缓存元信息（版本、更新时间） |

```sql
CREATE TABLE skill_cache (
  id TEXT PRIMARY KEY,
  name TEXT,
  description TEXT,
  source TEXT,
  entrypoint TEXT,
  enabled INTEGER DEFAULT 1,
  cached_at TEXT,
  last_accessed_at TEXT,
  access_count INTEGER DEFAULT 0
);

CREATE TABLE skill_content (
  skill_id TEXT PRIMARY KEY,
  content TEXT,
  format TEXT,
  FOREIGN KEY (skill_id) REFERENCES skill_cache(id)
);
```

### 2.2 Memory Cache (Tier 2 - 热点层)

| 字段 | 说明 |
|------|------|
| 类型 | LRU Cache (Map + 双向链表) |
| 最大容量 | 20 个 skill |
| TTL | 30 分钟（无访问） |

```javascript
class MemoryCache {
  constructor(maxSize = 20) {
    this.maxSize = maxSize;
    this.cache = new Map();
  }

  get(skillId) {
    const entry = this.cache.get(skillId);
    if (entry) {
      entry.lastAccessed = Date.now();
      this._moveToEnd(skillId);
      return entry.data;
    }
    return null;
  }

  set(skillId, data) {
    if (this.cache.has(skillId)) {
      this.cache.get(skillId).data = data;
      this._moveToEnd(skillId);
    } else {
      if (this.cache.size >= this.maxSize) {
        // LRU: 删除最老的
        const oldest = this.cache.keys().next().value;
        this.cache.delete(oldest);
      }
      this.cache.set(skillId, { data, lastAccessed: Date.now() });
    }
  }
}
```

## 3. Loading Flow

### 3.1 Startup Flow

```
server.start()
    │
    ▼
loadSkillCacheFromSQLite() ──► 加载全量 skill 元数据
    │
    ▼
initializeMemoryCache() ────► 清空内存缓存（保留热点）
    │
    ▼
ready.forRequests()
```

### 3.2 Runtime Loading Flow

```
getSkill(skillId)
    │
    ├──► MemoryCache.hit? ──► 返回缓存数据
    │
    └──► MemoryCache.miss
            │
            ▼
        SQLiteCache.hit? ──► 加载到 MemoryCache
            │                   │
            │                   ▼
            │               返回 skill
            │
            └──► SQLiteCache.miss
                    │
                    ▼
                installSkillFromDir() ──► 重新安装
```

## 4. API Extensions

| Endpoint | 说明 |
|----------|------|
| `GET /api/skills/cache/status` | 获取缓存状态 |
| `POST /api/skills/cache/warm` | 预热指定 skill |
| `POST /api/skills/cache/clear` | 清空内存缓存 |
| `GET /api/skills/:id/content` | 获取 skill 完整内容 |

## 5. Sync Integration

```javascript
// SkillSyncManager.syncAll() 后更新缓存
async function onSkillSyncComplete(result) {
  for (const skill of result.installed) {
    await cacheSkillToSQLite(skill);
  }
  // 通知 MemoryCache 失效
  memoryCache.invalidate(skill.id);
}
```

## 6. Implementation

### 6.1 New Module: `src/lib/skillCache.mjs`

```javascript
export class SkillCache {
  constructor(store, options = {}) {
    this.store = store;
    this.maxMemorySize = options.maxMemorySize || 20;
    this.memoryCache = new Map();
    this.accessOrder = [];
  }

  // SQLite -> Memory
  async loadToMemory(skillId) {
    const cached = await this.store.getSkillFromCache(skillId);
    if (cached) {
      this.setToMemory(skillId, cached);
      await this.store.updateSkillAccessTime(skillId);
    }
    return cached;
  }

  // Memory Cache LRU
  setToMemory(skillId, data) {
    if (this.memoryCache.has(skillId)) {
      this._moveToEnd(skillId);
      this.memoryCache.get(skillId).data = data;
      return;
    }

    if (this.memoryCache.size >= this.maxMemorySize) {
      const oldest = this.memoryCache.keys().next().value;
      this.memoryCache.delete(oldest);
    }

    this.memoryCache.set(skillId, { data, lastAccessed: Date.now() });
    this.accessOrder.push(skillId);
  }

  // 获取 skill（优先 Memory）
  async getSkill(skillId) {
    // 1. 查内存
    if (this.memoryCache.has(skillId)) {
      const entry = this.memoryCache.get(skillId);
      entry.lastAccessed = Date.now();
      return entry.data;
    }

    // 2. 查 SQLite
    const cached = await this.loadToMemory(skillId);
    return cached;
  }

  getCacheStatus() {
    return {
      memoryCacheSize: this.memoryCache.size,
      maxMemorySize: this.maxMemorySize,
      skillsInSQLite: this.store.getSkillCacheCount()
    };
  }
}
```

### 6.2 SQLite Store Extensions

```javascript
// store.mjs / sqliteStore.mjs
getSkillFromCache(skillId) {
  // 从 skill_cache 表获取
}

cacheSkill(skill) {
  // 写入 skill_cache 和 skill_content
}

updateSkillAccessTime(skillId) {
  // 更新 last_accessed_at 和 access_count
}

getSkillCacheCount() {
  // 获取缓存数量
}
```

## 7. Key Constraints

1. **启动时即缓存** — 服务启动后所有 skill 已缓存到 SQLite
2. **运行时按需加载** — 只有用到的 skill 才加载到内存
3. **LRU 淘汰** — 内存缓存满时自动淘汰冷数据
4. **无感知** — 调用方无需知道缓存层级
5. **同步透明** — skill sync 后自动更新缓存