# Memory Embedding Auto-Generation Design

**Date:** 2026-05-05
**Status:** Approved

## Overview

实现 Memory 的自动 embedding 生成，当用户触发"记住"或 Agent 产生关键内容时，自动生成向量并存入 SQLite，支持向量检索。

---

## 1. Architecture

```
User Input / Agent Output
         ↓
  detectMemoryTrigger()
         ↓
  createMemory() → store.createMemory()
         ↓
  async: generateEmbedding()
         ↓
  store.createMemoryEmbedding(memoryId, embeddingVector)
```

## 2. Embedding Generation

**方案：使用轻量模型生成 embedding**

```javascript
// 使用 fetch 调用 embedding API（如果有配置）
// 或使用本地 ml-distance 计算文本特征

async function generateEmbedding(text) {
  // 方案A: 调用外部 embedding API（如 OpenAI、Cohere）
  if (settings.embeddingEndpoint) {
    const response = await fetch(settings.embeddingEndpoint, {
      method: 'POST',
      body: JSON.stringify({ input: text.slice(0, 512) })
    });
    return response.json().data[0].embedding;
  }
  
  // 方案B: 本地 TF-IDF 或词频统计（无外部依赖）
  return localTfIdfEmbedding(text);
}
```

**备选方案：使用关键词提取代替完整向量**
```javascript
function extractKeywords(text) {
  // 提取高频词作为"伪向量"
  const words = text.toLowerCase().split(/\s+/);
  const freq = {};
  for (const w of words) {
    if (w.length > 3) freq[w] = (freq[w] || 0) + 1;
  }
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50)
    .map(([w]) => w);
}
```

## 3. Trigger Conditions

| 触发条件 | 示例 | 生成 Embedding |
|---------|------|---------------|
| 用户说"记住..." | "记住我的项目叫 XYZ" | ✅ |
| Agent 决策 | "采用 React 方案" | ✅ |
| Skill 执行成功 | `status: completed` | ✅ |
| Memory Skill 被调用 | `memory-loop` skill | ✅ |

## 4. Implementation

### 4.1 New Module: `src/lib/embedding.mjs`

```javascript
export async function generateEmbedding(text) {
  // 使用 ml-distance 的 cosine 相似度
  // 生成基于词频的特征向量
}

export function textToVector(text) {
  // 简单词频向量化
}
```

### 4.2 Modify `server.mjs` Memory Trigger

```javascript
// 在 addMessage 后
const memoryTrigger = detectMemoryTrigger(prompt, 'user');
if (memoryTrigger) {
  const memory = store.createMemory(memoryTrigger);
  // 异步生成 embedding，不阻塞
  generateEmbedding(memory.content).then(embedding => {
    store.createMemoryEmbedding(memory.id, embedding);
  });
}
```

### 4.3 Memory Search Integration

```javascript
// GET /api/memories/search
if (queryEmbedding) {
  const results = store.searchMemoriesByVector(queryEmbedding, limit);
  return results;
}
```

## 5. API Extensions

- `POST /api/memories` — 创建 memory（已有）
- `GET /api/memories` — 列出 memories（已有）
- `POST /api/memories/search` — 向量检索
- `POST /api/memories/auto` — 配置自动写入策略

## 6. Settings

```javascript
{
  embeddingEndpoint: '',      // 可选的外部 embedding API
  embeddingModel: 'local',   // 'local' | 'openai' | 'cohere'
  autoMemoryEnabled: true,   // 是否自动生成 embedding
  memoryTopK: 5              // 检索返回数量
}
```

## 7. Dependencies

- `ml-distance`（已有）- 用于 cosine 相似度计算
- 无需新增外部依赖