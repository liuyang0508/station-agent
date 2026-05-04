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