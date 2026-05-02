# 实现计划：增强 AIAgent Client 下一阶段功能

## Context

AIAgent Client v0.1 骨架已实现基础功能（会话管理、只读命令执行、MCP 进程管理、技能中心、长期记忆），但 README 中的"下一阶段"功能尚未实现：
- MCP stdio 协议（工具发现、工具调用回放）
- Hermes CLI / OpenClaw Gateway / OpenCowork Sandbox 深度适配器
- SQLite 存储 + 向量检索
- 可写命令细粒度审批与回滚
- Windows WSL2 / macOS Lima / Linux 容器化执行器

用户确认需要**全部**实现这些功能，SQLite 需要向量检索能力。

---

## Phase 3: 实现 MCP stdio 协议

### 3.1 新建 `src/lib/mcpProtocol.mjs` - JSON-RPC 2.0 核心

MCP JSON-RPC 2.0 协议处理器，实现协议方法 `initialize`、`initialized`、`tools/list`、`tools/call`。

### 3.2 新建 `src/lib/mcpTransport.mjs` - stdio 双向通信

stdio 双流通信管理，处理消息帧解析（MCP 协议使用 content-length 头部）。

### 3.3 重构 `src/lib/mcpManager.mjs`

- 修改 stdio 配置：`['pipe', 'pipe', 'pipe']`
- 集成 McpProtocol + McpTransport
- 实现工具发现缓存（`GET /api/mcp/:id/tools`）
- 实现工具调用回放（`POST /api/mcp/:id/call`）

### 3.4 HTTP API 扩展

```
GET  /api/mcp/:id/tools       - 列出已发现工具
POST /api/mcp/:id/call        - 调用指定工具
POST /api/mcp/:id/discover    - 触发重新发现
```

---

## Phase 4: 实现深度适配器架构

### 4.1 新建 `src/runtime/adapters/BaseRuntime.mjs` - 适配器基类

定义 `AgentRuntimeAdapter` 接口：`runTurn()`、`testConnection()`、`getInfo()`。

### 4.2 新建运行时适配器

| 适配器 | 文件 | 说明 |
|--------|------|------|
| Demo | `DemoRuntime.mjs` | 复用当前 `buildDemoAnswer()` |
| OpenAI Compatible | `OpenAICompatibleRuntime.mjs` | 移动 `callOpenAICompatible()` |
| Hermes | `HermesRuntime.mjs` | 通过 Unix Socket 连接 Hermes CLI |
| OpenClaw | `OpenClawGatewayAdapter.mjs` | 连接 OpenClaw Gateway 多通道消息路由 |
| OpenCowork | `OpenCoworkSandboxAdapter.mjs` | 操作 WSL2/Lima/Linux 容器 |

### 4.3 重构 `src/runtime/agentRuntime.mjs` 为工厂函数

`createAgentRuntime(settings, ...)` 根据 `runtimeMode` 选择适配器。

---

## Phase 5: 实现 SQLite 存储

### 5.1 依赖

```bash
npm install better-sqlite3@^11.0.0
npm install sqlite-vector  # 向量检索
```

### 5.2 新建 `src/lib/sqliteStore.mjs`

保持与 `JsonStore` 相同接口（`getSettings()`、`listSessions()`、`createMemory()` 等），内部替换为 SQLite。

数据库 Schema：
- `settings` - key/value 配置
- `sessions` / `messages` - 会话和消息
- `skills` / `skill_runs` - 技能系统
- `mcp_servers` - MCP 服务器
- `approvals` - 审批队列
- `memories` - 长期记忆（新增 `embedding BLOB` 向量字段）

### 5.3 向量检索

- 用户创建 memory 时，异步计算 embedding
- 搜索时先做向量搜索，再做标题/内容 LIKE 过滤
- 使用 `sqlite-vector` 或内存向量实现

### 5.4 数据迁移

构造函数检测 `data/store.json`，如果存在则迁移到 SQLite 并备份原文件。

---

## Phase 6: 实现审批与回滚

### 6.1 新建 `src/lib/commandExecutor.mjs` - 可写命令执行器

- `execute(command, cwd)` - 执行写命令（自动创建审批）
- `executeApproved(approvalId)` - 审批后执行
- `rollback(operationId)` - 回滚操作

### 6.2 新建 `src/lib/rollbackManager.mjs` - 回滚管理

- `snapshot(path)` - 拍摄文件快照
- `record(operationType, target, snapshotId)` - 记录操作
- `rollback(operationId)` - 恢复快照

### 6.3 HTTP API

```
POST /api/commands/run           - 执行命令（自动创建审批）
POST /api/commands/approve/:id   - 批准并执行
POST /api/commands/reject/:id    - 拒绝
POST /api/commands/rollback/:id  - 回滚操作
GET  /api/commands/operations    - 列出可回滚操作
```

---

## Phase 7: 实现跨平台执行器

### 7.1 执行器类型

| 执行器 | 文件 | 依赖 |
|--------|------|------|
| WSL2 | `wsl2Executor.mjs` | WSL2 发行版 |
| Lima | `limaExecutor.mjs` | limactl |
| Docker | `dockerExecutor.mjs` | Docker daemon |

### 7.2 新建 `src/lib/executorManager.mjs`

- `selectExecutor(platform)` - 选择执行器
- `start/stop(executorId)` - 生命周期管理
- `executeInExecutor(executorId, command, cwd)` - 执行命令
- `healthCheck(executorId)` - 健康检查

---

## 实施顺序

1. **Phase 3 (MCP)** - 最独立，先做
2. **Phase 5 (SQLite)** - 存储层独立，不影响其他模块
3. **Phase 4 (适配器)** - 依赖存储层
4. **Phase 6 (审批回滚)** - 依赖 MCP 和存储
5. **Phase 7 (跨平台执行器)** - 最复杂，放在最后
6. **Phase 8 (测试)** - 贯穿全程

---

## 关键文件清单

**新建文件 (20个):**
- `src/lib/mcpProtocol.mjs`
- `src/lib/mcpTransport.mjs`
- `src/runtime/adapters/BaseRuntime.mjs`
- `src/runtime/adapters/DemoRuntime.mjs`
- `src/runtime/adapters/OpenAICompatibleRuntime.mjs`
- `src/runtime/adapters/HermesRuntime.mjs`
- `src/runtime/adapters/OpenClawGatewayAdapter.mjs`
- `src/runtime/adapters/OpenCoworkSandboxAdapter.mjs`
- `src/lib/sqliteStore.mjs`
- `src/lib/commandExecutor.mjs`
- `src/lib/rollbackManager.mjs`
- `src/lib/executors/baseExecutor.mjs`
- `src/lib/executors/wsl2Executor.mjs`
- `src/lib/executors/limaExecutor.mjs`
- `src/lib/executors/dockerExecutor.mjs`
- `src/lib/executorManager.mjs`

**修改文件 (4个):**
- `src/lib/mcpManager.mjs` - 集成协议处理器
- `src/runtime/agentRuntime.mjs` - 改为适配器工厂
- `src/server.mjs` - 添加新 API 端点
- `docs/ARCHITECTURE.md` - 更新架构文档

---

## 验证标准

- [ ] MCP stdio 协议握手成功
- [ ] 工具发现返回正确工具列表
- [ ] 工具调用回放正常工作
- [ ] SQLite 数据库正确创建和数据迁移
- [ ] 向量检索返回相关记忆
- [ ] 可写命令创建审批请求
- [ ] 审批通过后命令正确执行
- [ ] 回滚操作正确恢复文件
- [ ] WSL2/Lima/Docker 执行器健康检查通过
- [ ] 所有现有测试通过
