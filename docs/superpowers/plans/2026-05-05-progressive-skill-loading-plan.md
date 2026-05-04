# Progressive Skill Loading 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 Skill 渐进式加载：启动时从 SQLite 加载全量缓存，运行时按需加载到内存（LRU）。

**Architecture:** 两层缓存架构：SQLite 持久化全量 skill 元数据 + Memory LRU 缓存热点 skill。

**Tech Stack:** Node.js ESM, better-sqlite3, LRU Map

---

## File Structure

```
src/lib/skillCache.mjs      # 新建: 两层缓存管理
src/lib/sqliteStore.mjs     # 修改: 添加缓存表和方法
src/lib/skillManager.mjs    # 修改: 集成 SkillCache
src/server.mjs              # 修改: 添加缓存 API
```

---

## Task 1: 创建 skillCache.mjs 模块

**Files:**
- Create: `src/lib/skillCache.mjs`

- [ ] **Step 1: 创建 skillCache.mjs**

```javascript
/**
 * SkillCache - 两层缓存管理
 * Tier 1: SQLite (持久化全量)
 * Tier 2: Memory LRU (热点)
 */

export class SkillCache {
  constructor(store, options = {}) {
    this.store = store;
    this.maxMemorySize = options.maxMemorySize || 20;
    this.memoryCache = new Map();
    this.ttlMs = options.ttlMs || 30 * 60 * 1000; // 30 min
  }

  /**
   * 获取 skill（优先 Memory → SQLite）
   */
  async getSkill(skillId) {
    // 1. 查内存
    if (this.memoryCache.has(skillId)) {
      const entry = this.memoryCache.get(skillId);
      // 检查 TTL
      if (Date.now() - entry.cachedAt < this.ttlMs) {
        entry.lastAccessed = Date.now();
        return entry.data;
      } else {
        // TTL 过期，删除
        this.memoryCache.delete(skillId);
      }
    }

    // 2. 查 SQLite
    const cached = await this.store.getSkillFromCache(skillId);
    if (cached) {
      this.setToMemory(skillId, cached);
      await this.store.updateSkillAccessTime(skillId);
      return cached;
    }

    return null;
  }

  /**
   * 写入内存缓存（LRU 淘汰）
   */
  setToMemory(skillId, data) {
    if (this.memoryCache.has(skillId)) {
      this.memoryCache.get(skillId).data = data;
      this.memoryCache.get(skillId).lastAccessed = Date.now();
      return;
    }

    if (this.memoryCache.size >= this.maxMemorySize) {
      // LRU: 找到最老的条目删除
      let oldestId = null;
      let oldestTime = Infinity;
      for (const [id, entry] of this.memoryCache) {
        if (entry.lastAccessed < oldestTime) {
          oldestTime = entry.lastAccessed;
          oldestId = id;
        }
      }
      if (oldestId) {
        this.memoryCache.delete(oldestId);
      }
    }

    this.memoryCache.set(skillId, {
      data,
      cachedAt: Date.now(),
      lastAccessed: Date.now()
    });
  }

  /**
   * 预热：加载 skill 到缓存
   */
  async warmSkill(skillId) {
    const skill = await this.getSkill(skillId);
    return skill;
  }

  /**
   * 批量预热
   */
  async warmAll() {
    const skills = this.store.listSkills();
    for (const skill of skills) {
      await this.store.cacheSkill(skill);
    }
    return { warmed: skills.length };
  }

  /**
   * 清空内存缓存
   */
  clearMemoryCache() {
    this.memoryCache.clear();
    return { cleared: true };
  }

  /**
   * 失效指定 skill
   */
  invalidate(skillId) {
    this.memoryCache.delete(skillId);
  }

  /**
   * 获取缓存状态
   */
  getStatus() {
    return {
      memoryCacheSize: this.memoryCache.size,
      maxMemorySize: this.maxMemorySize,
      skillsInSQLite: this.store.getSkillCacheCount(),
      ttlMs: this.ttlMs
    };
  }
}
```

- [ ] **Step 2: 提交**

```bash
git add src/lib/skillCache.mjs
git commit -m "feat: add SkillCache module with two-tier LRU cache"
```

---

## Task 2: 添加 SQLite 缓存表和方法

**Files:**
- Modify: `src/lib/sqliteStore.mjs`

- [ ] **Step 1: 在 _initDb() 方法中添加缓存表**

在 sqliteStore.mjs 的 `_initDb()` 方法中（约第 26 行），在 `evolution_entries` 表创建之后添加：

```javascript
// Skill cache tables
db.exec(`
  CREATE TABLE IF NOT EXISTS skill_cache (
    id TEXT PRIMARY KEY,
    name TEXT,
    description TEXT,
    source TEXT,
    entrypoint TEXT,
    command TEXT,
    args TEXT,
    metadata TEXT,
    enabled INTEGER DEFAULT 1,
    cached_at TEXT,
    last_accessed_at TEXT,
    access_count INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS skill_content (
    skill_id TEXT PRIMARY KEY,
    content TEXT,
    format TEXT,
    FOREIGN KEY (skill_id) REFERENCES skill_cache(id)
  );
`);
```

- [ ] **Step 2: 添加缓存方法到 sqliteStore.mjs**

在文件末尾（`search` 方法之后）添加：

```javascript
// Skill Cache Methods
cacheSkill(skill) {
  const now = new Date().toISOString();
  this.db.prepare(`
    INSERT OR REPLACE INTO skill_cache (id, name, description, source, entrypoint, command, args, metadata, enabled, cached_at, last_accessed_at, access_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    skill.id, skill.name, skill.description, skill.source || '',
    skill.entrypoint || '', skill.command || '',
    JSON.stringify(skill.args || []),
    JSON.stringify(skill.metadata || {}),
    skill.enabled ? 1 : 0,
    now, now, 0
  );

  if (skill.metadata?.body) {
    this.db.prepare(`
      INSERT OR REPLACE INTO skill_content (skill_id, content, format)
      VALUES (?, ?, ?)
    `).run(skill.id, skill.metadata.body, skill.metadata?.format || 'unknown');
  }
}

getSkillFromCache(skillId) {
  const row = this.db.prepare('SELECT * FROM skill_cache WHERE id = ?').get(skillId);
  if (!row) return null;

  const contentRow = this.db.prepare('SELECT * FROM skill_content WHERE skill_id = ?').get(skillId);
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    source: row.source,
    entrypoint: row.entrypoint,
    command: row.command,
    args: row.args ? JSON.parse(row.args) : [],
    metadata: row.metadata ? JSON.parse(row.metadata) : {},
    enabled: Boolean(row.enabled),
    cachedAt: row.cached_at,
    lastAccessedAt: row.last_accessed_at,
    accessCount: row.access_count,
    content: contentRow?.content,
    format: contentRow?.format
  };
}

updateSkillAccessTime(skillId) {
  const now = new Date().toISOString();
  this.db.prepare(`
    UPDATE skill_cache SET last_accessed_at = ?, access_count = access_count + 1 WHERE id = ?
  `).run(now, skillId);
}

getSkillCacheCount() {
  const row = this.db.prepare('SELECT COUNT(*) as c FROM skill_cache').get();
  return row?.c || 0;
}

getAllSkillMetadata() {
  return this.db.prepare('SELECT id, name, description, source, enabled, cached_at, last_accessed_at, access_count FROM skill_cache ORDER BY access_count DESC').all();
}
```

- [ ] **Step 3: 提交**

```bash
git add src/lib/sqliteStore.mjs
git commit -m "feat(sqliteStore): add skill cache tables and methods"
```

---

## Task 3: 集成 SkillCache 到 skillManager

**Files:**
- Modify: `src/lib/skillManager.mjs`

- [ ] **Step 1: 添加 SkillCache 导入和初始化**

在 skillManager.mjs 顶部添加 import：
```javascript
import { SkillCache } from './skillCache.mjs';
```

创建全局 SkillCache 实例（在 store 初始化之后）：
```javascript
const skillCache = new SkillCache(store);
```

- [ ] **Step 2: 修改 runSkill 使用缓存**

找到 `runSkill` 函数（约第 268 行），在函数开头添加：
```javascript
// 确保 skill 已缓存
await skillCache.getSkill(skillId);
```

- [ ] **Step 3: 修改 installSkill 函数缓存新安装的 skill**

在 `installSkillFromFile` 和 `installSkillFromDir` 成功安装后添加：
```javascript
// 缓存到 SQLite
store.cacheSkill(skill);
```

- [ ] **Step 4: 提交**

```bash
git add src/lib/skillManager.mjs
git commit -m "feat(skillManager): integrate SkillCache for progressive loading"
```

---

## Task 4: 添加缓存 API 端点

**Files:**
- Modify: `src/server.mjs`

- [ ] **Step 1: 添加缓存相关 API**

在 server.mjs 中找到其他 API 路由定义位置，添加：

```javascript
// GET /api/skills/cache/status - 获取缓存状态
app.get('/api/skills/cache/status', (req, res) => {
  try {
    const status = skillCache.getStatus();
    sendJson(res, 200, { success: true, ...status });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

// POST /api/skills/cache/warm - 预热 skill
app.post('/api/skills/cache/warm', async (req, res) => {
  try {
    const { skillId } = req.body;
    if (skillId) {
      await skillCache.warmSkill(skillId);
      sendJson(res, 200, { success: true, warmed: skillId });
    } else {
      const result = await skillCache.warmAll();
      sendJson(res, 200, { success: true, ...result });
    }
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

// POST /api/skills/cache/clear - 清空内存缓存
app.post('/api/skills/cache/clear', (req, res) => {
  try {
    const result = skillCache.clearMemoryCache();
    sendJson(res, 200, { success: true, ...result });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

// GET /api/skills/:id/content - 获取 skill 完整内容
app.get('/api/skills/:id/content', async (req, res) => {
  try {
    const skill = await skillCache.getSkill(req.params.id);
    if (!skill) {
      sendJson(res, 404, { error: 'Skill not found' });
      return;
    }
    sendJson(res, 200, {
      success: true,
      skill: {
        id: skill.id,
        name: skill.name,
        content: skill.content,
        format: skill.format
      }
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});
```

- [ ] **Step 2: 提交**

```bash
git add src/server.mjs
git commit -m "feat(api): add skill cache management endpoints"
```

---

## Task 5: 验证缓存流程

- [ ] **Step 1: 验证 skillCache 模块加载**

```bash
node -e "import('./src/lib/skillCache.mjs').then(m => { console.log('SkillCache:', typeof m.SkillCache); })"
```

- [ ] **Step 2: 验证 SQLite 缓存方法**

```bash
grep -n "cacheSkill\|getSkillFromCache\|getSkillCacheCount" /Users/liuyang/Desktop/AIAgent/station-agent/src/lib/sqliteStore.mjs
```

- [ ] **Step 3: 验证 API 端点**

```bash
grep -n "/api/skills/cache" /Users/liuyang/Desktop/AIAgent/station-agent/src/server.mjs
```

- [ ] **Step 4: 提交**

```bash
git add --all
git commit -m "test: verify progressive skill loading implementation"
```