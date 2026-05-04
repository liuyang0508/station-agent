# Memory Embedding 自动生成实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 当用户触发"记住"或 Agent 产生关键内容时，自动生成向量并存入 SQLite，支持向量检索。

**Architecture:** 在 src/lib/ 下新增 embedding.mjs 模块，提供 generateEmbedding() 和 textToVector() 函数。在 server.mjs 中集成 detectMemoryTrigger() 和异步 embedding 生成。

**Tech Stack:** ml-distance (cosine similarity), better-sqlite3, Node.js ESM

---

## File Structure

```
src/lib/embedding.mjs          # 新建: 向量生成模块
src/lib/sqliteStore.mjs        # 修改: 添加 searchMemoriesByVector
src/server.mjs                 # 修改: 集成 memory trigger 和异步 embedding
```

---

## Task 1: 创建 embedding.mjs 模块

**Files:**
- Create: `src/lib/embedding.mjs`

- [ ] **Step 1: 创建 embedding.mjs 文件**

```javascript
/**
 * 轻量级 embedding 生成模块
 * 使用词频统计生成伪向量，支持 cosine 相似度计算
 */

import { cosine } from 'ml-distance';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DIM = 128; // 向量维度

/**
 * 将文本转换为特征向量
 * 使用词频哈希方法生成确定性向量
 */
export function textToVector(text) {
  const words = text.toLowerCase().split(/\s+/);
  const vector = new Float32Array(DIM);

  for (const word of words) {
    if (word.length < 2) continue;
    // 使用词哈希生成伪随机种子
    let hash = 0;
    for (let i = 0; i < word.length; i++) {
      hash = ((hash << 5) - hash) + word.charCodeAt(i);
      hash = hash & hash;
    }
    // 使用 hash 种子生成随机向量分量
    const seed = Math.abs(hash);
    const rng = seedRandom(seed);
    for (let j = 0; j < DIM; j++) {
      vector[j] += rng();
    }
  }

  // L2 归一化
  let norm = 0;
  for (let i = 0; i < DIM; i++) {
    norm += vector[i] * vector[i];
  }
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < DIM; i++) {
      vector[i] /= norm;
    }
  }

  return vector;
}

/**
 * 生成文本的 embedding 向量
 */
export async function generateEmbedding(text) {
  return textToVector(text);
}

/**
 * 计算两个向量的 cosine 相似度
 */
export function computeSimilarity(vec1, vec2) {
  return cosine(vec1, vec2);
}

/**
 * 简单的伪随机数生成器（确定性）
 */
function seedRandom(seed) {
  let s = seed;
  return function() {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return (s / 0x7fffffff);
  };
}
```

- [ ] **Step 2: 提交**

```bash
git add src/lib/embedding.mjs
git commit -m "feat: add embedding module with textToVector and generateEmbedding"
```

---

## Task 2: 修改 sqliteStore.mjs 添加向量检索

**Files:**
- Modify: `src/lib/sqliteStore.mjs`
- Test: `src/lib/__tests__/embedding.test.mjs` (新建)

- [ ] **Step 1: 修改 sqliteStore.mjs 的 createMemoryEmbedding 方法**

找到 `createMemoryEmbedding` 方法（约第 498 行），确认实现为：

```javascript
createMemoryEmbedding(memoryId, embeddingVector) {
  const embedding = Buffer.from(new Float32Array(embeddingVector).buffer);
  this.db.prepare('UPDATE memories SET embedding = ? WHERE id = ?').run(embedding, memoryId);
}
```

确认 `searchMemoriesByVector` 方法（约第 503 行）存在：

```javascript
searchMemoriesByVector(queryEmbedding, limit = 5) {
  const memories = this.listMemories().filter(m => m.embedding);
  if (memories.length === 0) return [];
  const queryVec = new Float32Array(queryEmbedding);
  const scored = memories.map(m => {
    const emb = new Float32Array(m.embedding.buffer);
    const similarity = cosine(queryVec, emb);
    return { ...m, similarity };
  });
  return scored.sort((a, b) => b.similarity - a.similarity).slice(0, limit);
}
```

- [ ] **Step 2: 提交**

```bash
git add src/lib/sqliteStore.mjs
git commit -m "feat(sqliteStore): verify vector search methods exist"
```

---

## Task 3: 修改 server.mjs 集成 Memory Trigger

**Files:**
- Modify: `src/server.mjs`

- [ ] **Step 1: 添加 detectMemoryTrigger 函数到 server.mjs 顶部**

在 `import` 语句之后添加：

```javascript
/**
 * 检测文本中是否包含记忆触发词
 * @param {string} text - 输入文本
 * @param {string} role - 角色 ('user' | 'assistant')
 * @returns {string|null} - 触发则返回记忆内容，否则 null
 */
function detectMemoryTrigger(text, role) {
  if (!text || typeof text !== 'string') return null;

  // 用户明确说"记住..."
  const rememberPatterns = [
    /^记住(.+)/,
    /请记住(.+)/,
    /memory:\s*(.+)/i,
    /#remember\s+(.+)/
  ];

  for (const pattern of rememberPatterns) {
    const match = text.match(pattern);
    if (match) {
      return `用户要求记住: ${match[1].trim()}`;
    }
  }

  // Agent 决策检测（assistant 角色）
  if (role === 'assistant') {
    const decisionPatterns = [
      /决定(采用|使用|选择|构建|创建|添加)/i,
      /采用了(.+?)方案/i,
      /选择(.+?)作为/i
    ];
    for (const pattern of decisionPatterns) {
      const match = text.match(pattern);
      if (match) {
        return `Agent 决策: ${match[0].trim()}`;
      }
    }
  }

  return null;
}
```

- [ ] **Step 2: 在 addMessage 后添加自动记忆逻辑**

找到 `app.post('/api/messages')` 或 `addMessage` 调用处，在消息添加后添加：

```javascript
// 检测是否需要自动生成 memory embedding
const memoryTrigger = detectMemoryTrigger(content, role);
if (memoryTrigger) {
  const memory = store.createMemory({
    title: memoryTrigger.slice(0, 50),
    content: memoryTrigger,
    source: 'auto'
  });
  // 异步生成 embedding，不阻塞响应
  generateEmbedding(memoryTrigger).then(embedding => {
    if (store.createMemoryEmbedding) {
      store.createMemoryEmbedding(memory.id, Array.from(embedding));
    }
  }).catch(err => {
    console.error('Failed to generate embedding:', err);
  });
}
```

- [ ] **Step 3: 提交**

```bash
git add src/server.mjs
git commit -m "feat(server): integrate memory trigger detection and auto-embedding generation"
```

---

## Task 4: 添加 API 端点支持向量检索

**Files:**
- Modify: `src/server.mjs`

- [ ] **Step 1: 添加 /api/memories/search 向量检索端点**

```javascript
// POST /api/memories/search - 向量检索
app.post('/api/memories/search', async (req, res) => {
  try {
    const { query, limit = 5 } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'query required' });
    }

    const embedding = await generateEmbedding(query);
    const results = store.searchMemoriesByVector(Array.from(embedding), limit);

    res.json({
      success: true,
      query,
      results: results.map(r => ({
        id: r.id,
        title: r.title,
        content: r.content,
        similarity: r.similarity,
        createdAt: r.createdAt
      }))
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

- [ ] **Step 2: 提交**

```bash
git add src/server.mjs
git commit -m "feat(api): add POST /api/memories/search for vector search"
```

---

## Task 5: 验证完整流程

- [ ] **Step 1: 测试 trigger 检测**

```javascript
// 测试代码
const triggers = [
  { text: '记住我的项目叫 XYZ', role: 'user', expect: true },
  { text: '请记住明天开会', role: 'user', expect: true },
  { text: '决定采用 React 方案', role: 'assistant', expect: true },
  { text: '你好啊', role: 'user', expect: false }
];

for (const t of triggers) {
  const result = detectMemoryTrigger(t.text, t.role);
  const pass = (result !== null) === t.expect;
  console.log(`${pass ? '✅' : '❌'} "${t.text}" -> ${result}`);
}
```

- [ ] **Step 2: 提交**

```bash
git add --all
git commit -m "test: add memory trigger detection tests"
```