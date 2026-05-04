# Findings & Decisions

## Requirements
- MCP stdio 协议握手、工具发现和工具调用回放
- 多运行时适配器架构
- SQLite 存储、文件索引和向量检索
- 可写命令/文件变更的细粒度审批与回滚记录
- Windows WSL2、macOS Lima、Linux 容器化执行器
- Agent 循环控制与运行时保护
- 渐进式技能加载与技能进化
- Python Agent Core

---

## Implementation Summary

### 已实现

#### 1. MCP 协议层
- **mcpProtocol.mjs**: JSON-RPC 2.0 核心，支持 initialize/tools.list/tools/call
- **mcpTransport.mjs**: stdio 双向通信，支持 Content-Length 帧和 JSON-Lines 格式（兼容 spawn 模式）
- **mcpManager.mjs**: 服务生命周期管理，自动启动已配置的 MCP 服务器

**问题修复**：
- MCP 服务器在 spawn 模式下输出到 stderr，且使用 JSON-Lines 格式
- 修复：发送改为 JSON-Lines 格式，接收同时支持两种格式

#### 2. Python Agent Core
- **python/agent_core/main.py**: JSON-RPC over stdio 服务端
- **skill_manager.py**: 动态加载技能，支持 .py 入口
- **memory.py**: TF-IDF 向量存储，SQLite 持久化
- **execution_engine.py**: Python 代码执行引擎

**问题修复**：
- `skillList()` 是 async，但 `createToolRegistry` 同步调用
- 修复：添加 `_syncLoadedSkills()` 和 `_getLoadedSkillNames()` 缓存方法

#### 3. Agent Loop
- **agentLoop.mjs**: 状态机循环控制器
- **checkpoint.mjs**: 检查点系统，用于跟踪验证
- 检测：相同输出3次 / 语义相似度90% / 最大100次迭代

#### 4. Harness 运行时保护
- **harness.mjs**: 运行时保护主模块
- **decisionValidator.mjs**: 决策验证，检测重复/矛盾决策
- **constraintEnforcer.mjs**: 约束执行，HARD 直接拦截，SOFT 创建审批
- **rollbackManager.mjs**: 基于文件系统快照的回滚

#### 5. 渐进式技能加载
- **skillCache.mjs**: 两层缓存（Memory LRU + SQLite）
- **skillEvolution.mjs**: 技能进化逻辑
- 进化触发：失败2次 / 成功5次 / 用户纠正 / 超时后成功

#### 6. 向量检索
- **embedding.mjs**: TF-IDF 嵌入生成
- SQLite 存储：`createMemoryEmbedding()` / `searchMemoriesByVector()`
- 自动检测"记住..."触发词创建记忆

---

## Technical Decisions

| Decision | Rationale |
|----------|-----------|
| MCP 传输兼容双格式 | spawn 模式输出 JSON-Lines，需同时支持 Content-Length |
| Python Skills 缓存同步 | skillList() async 但需要同步调用，用缓存解决 |
| TF-IDF 而非深度嵌入 | 轻量，无需外部模型依赖，适合本地运行 |
| 两层技能缓存 | Memory LRU 热点 + SQLite 持久化，平衡速度与容量 |

---

## Issues Encountered

| Issue | Resolution |
|-------|-----------|
| MCP 服务器 spawn 后无输出 | 发现输出在 stderr 且需要 JSON-Lines 格式 |
| MCP 工具调用参数 undefined | JSON-Lines 格式发送，Content-Length 帧接收 |
| Python skillList async 调用 | 添加 _syncLoadedSkills() 在启动时同步 |
| SkillCache store 类型不匹配 | JsonStore 新增 cacheSkill/getSkillFromCache 等方法 |
| GitHub rate limit 阻塞技能同步 | 非关键，降级处理，等待冷却 |

---

## Architecture Notes

### MCP 协议版本
- 使用 `@modelcontextprotocol/sdk` v1.25.2+
- MCP 服务器使用 `@modelcontextprotocol/server-filesystem` v2026.1.14
- Filesystem MCP 支持 14 个工具

### Python 版本
- 默认 `python3`，可在构造函数覆盖
- Python 技能支持动态 import
- TF-IDF 使用 numpy（如可用）

### 缓存配置
- Memory LRU: 最大 20 个条目，30 分钟 TTL
- SQLite: 持久化全量缓存

---

## Architecture

所有架构设计为自研。
