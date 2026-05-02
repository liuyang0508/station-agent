# 架构设计

## 分层

```text
AIAgent Client
├── public/                  # 客户端 UI
├── macos/                   # macOS 原生 AppKit/WKWebView 客户端壳
├── scripts/                 # 构建脚本
├── src/server.mjs           # 本地控制面 API
├── src/runtime/             # Agent Runtime 适配层
├── src/lib/store.mjs        # JSON 持久化，后续可替换 SQLite
├── src/lib/safety.mjs       # 工作区和命令安全边界
├── src/lib/commandRunner.mjs # 只读命令审批执行器
├── src/lib/mcpManager.mjs   # 本地 MCP 服务生命周期管理
├── src/lib/skillManager.mjs # 工作区技能安装和运行
└── docs/                    # 中文优先产品与工程文档
```

## 核心对象

- Session：一个工作区内的连续 Agent 会话。
- Message：用户和 Agent 的消息，支持 Trace 附着。
- Skill：可启停的能力单元，不直接写死在 Prompt 输入框里。
- Connector：远程通道、设备节点、MCP 服务的统一抽象。
- MCP Server：可登记、启动、停止的本地 MCP 进程，后续接入 stdio 工具发现。
- Task：定时、实时、手动触发的自动化任务。
- Approval：命令、文件、远程发送等敏感动作的审批策略。
- Memory：长期稳定的偏好、项目知识和运行约束。

## 运行时

`src/runtime/agentRuntime.mjs` 是 Agent Runtime 工厂，根据 `runtimeMode` 选择对应适配器。

当前支持两种本地模式：

- `demo`：无密钥、无网络也能运行，用于验证产品交互和本地状态。
- `remote`：调用 OpenAI-compatible `/chat/completions` 接口。

适配器按统一接口接入：

- `DemoRuntime`：本地演示模式，复用 `buildDemoAnswer()` 逻辑。
- `OpenAICompatibleRuntime`：OpenAI-compatible API，含 Anthropic 支持。
- `HermesRuntime`：通过 HTTP 连接 Hermes CLI。
- `OpenClawGatewayAdapter`：连接 OpenClaw Gateway 多通道消息路由。
- `OpenCoworkSandboxAdapter`：操作 WSL2/Lima/Linux 容器化执行器。

## MCP 协议层

完整的 MCP stdio 协议实现：

- `src/lib/mcpProtocol.mjs`：JSON-RPC 2.0 核心处理器。
- `src/lib/mcpTransport.mjs`：stdio 双向通信，带 content-length 帧解析。
- `src/lib/mcpManager.mjs`：集成协议和传输层，支持工具发现和工具调用回放。

## 存储层

- `src/lib/store.mjs`：JSON 文件持久化（v0.1 默认）。
- `src/lib/sqliteStore.mjs`：SQLite 存储实现（v0.2），兼容 JsonStore 接口，支持向量检索（`createMemoryEmbedding`/`searchMemoriesByVector`）。

## 安全边界

第一版先做最重要的本地边界：

- 静态文件服务禁止越过 `public/`。
- 工作区路径使用 realpath 校验，防止符号链接逃逸。
- 高风险命令模式默认拦截。
- 只读命令执行器不经过 shell，不支持管道、重定向和 shell 元字符。
- 命令执行必须先创建审批，审批通过后才能消费一次。
- MCP 服务启动器限制为 `node`、`npx`、`uvx`、`python`、`python3`，工作目录必须在工作区内。
- API Key 优先从环境变量读取，也可保存到 macOS Keychain；不会写入 JSON store。

## 客户端形态

当前交付两种入口：

- macOS `.app`：真正的桌面客户端，启动后自动拉起本地 Agent 服务。
- macOS `.dmg` / `.zip`：可分发构建产物，当前为 ad-hoc 签名。
- 本地 Web 调试入口：开发时直接访问 `http://127.0.0.1:47891`。

没有先引入 Electron，是为了避免第一版就背上庞大的依赖和打包链。macOS 壳使用 AppKit + WKWebView，后续可以继续补 Windows/Linux 壳，或在需要跨平台统一打包时切换到 Tauri/Electron。

## 桌面壳职责

`macos/AIAgentClient.swift` 负责：

- 创建原生 macOS 窗口并加载 WKWebView。
- 优先使用 Bundle 内置 Node runtime，兜底查找系统 Node.js，并启动 `src/server.mjs`。
- 等待 `/api/health` 就绪后加载客户端。
- 维护菜单栏诊断入口。
- 限制 WebView 导航范围，只允许访问本地客户端服务。

服务端状态由 `/api/health` 和 `/api/diagnostics` 暴露，包含 PID、Node 版本、App 根目录、数据文件路径、会话/技能/连接器数量等信息。

每次构建会写入 `build-info.json`。桌面壳只复用 buildId 相同的本地服务；如果旧版本服务占用默认端口，新版本会自动使用后续端口，避免误连旧运行时。

## 密钥管理

模型 API Key 不写入 `store.json`。读取顺序：

1. 环境变量，例如 `AIAGENT_API_KEY`。
2. macOS Keychain，service 为 `AIAgent Client`，account 为 `model-api-key`。

设置页提交的 API Key 会通过 `/api/secrets/model-key` 写入 Keychain。诊断接口只暴露来源和脱敏预览。

## 工作区访问

工作区接口：

- `GET /api/workspace/list?path=.`
- `GET /api/workspace/read?path=README.md`

所有目标路径先经过 `validateWorkspacePath()`，真实路径必须位于当前工作区内；符号链接逃逸会被拒绝。文件预览限制为 512KB，避免客户端误读大文件或二进制文件。

## 工具注册

`src/runtime/toolRegistry.mjs` 是后续 MCP/技能系统的内置工具入口。当前内置：

- `workspace.list`：列出工作区目录。
- `workspace.read`：读取工作区内的小型文本文件。

Agent runtime 会在每轮运行时加载工具注册表并把工具调用写入 Trace。后续 MCP server、技能脚本和命令执行器都应接入这层，而不是直接耦合 UI。

## MCP、技能、审批和记忆

新增控制面 API：

```text
# MCP 协议 (stdio JSON-RPC 2.0)
GET  /api/mcp                    # 列出所有 MCP 服务器
POST /api/mcp                    # 创建 MCP 服务器
POST /api/mcp/:id/start          # 启动并握手
POST /api/mcp/:id/stop           # 停止
GET  /api/mcp/:id/tools          # 列出已发现工具
POST /api/mcp/:id/call           # 调用工具
POST /api/mcp/:id/discover       # 重新发现工具

# 技能系统
POST /api/skills/install
POST /api/skills/:id/run
GET  /api/skills/runs

# 审批与回滚
POST /api/commands/run           # 执行命令（自动创建审批）
POST /api/commands/approve/:id   # 批准并执行
POST /api/commands/reject/:id   # 拒绝
POST /api/commands/rollback/:id  # 回滚操作
GET  /api/commands/operations    # 列出可回滚操作

# 跨平台执行器
POST /api/executors/start        # 启动执行器 (wsl2/lima/docker)
POST /api/executors/stop         # 停止执行器
POST /api/executors/execute     # 在执行器中执行命令
GET  /api/executors/health       # 健康检查

# 搜索与记忆
GET /api/search?q=...
GET /api/memories
POST /api/memories
POST /api/memories/search       # 向量检索
DELETE /api/memories/:id
```

## SQLite 存储

`src/lib/sqliteStore.mjs` 提供 SQLite 持久化存储，兼容 `JsonStore` 接口：

```javascript
import { SqliteStore } from './sqliteStore.mjs';
const store = new SqliteStore('/path/to/store.db');

// 标准接口
store.listSessions()
store.createSession()
store.listMemories()
store.createMemory()
store.searchMemoriesByVector(embedding, limit)

// 向量嵌入
store.createMemoryEmbedding(memoryId, embeddingVector)

// 数据迁移
store.migrateFromJsonStore(jsonStore)
```

## 适配器架构

`src/runtime/agentRuntime.mjs` 作为工厂，根据 `runtimeMode` 选择适配器：

| runtimeMode | 适配器 | 说明 |
|------------|--------|------|
| `demo` | DemoRuntime | 本地演示模式 |
| `remote` / `openai` / `anthropic` | OpenAICompatibleRuntime | OpenAI-compatible API |
| `hermes` | HermesRuntime | Hermes CLI 运行时 |
| `openclaw` | OpenClawGatewayAdapter | OpenClaw Gateway |
| `opencowork` | OpenCoworkSandboxAdapter | WSL2/Lima/Docker 沙箱 |

## 执行器

`src/lib/executors/` 提供跨平台命令执行：

| 执行器 | 平台 | 依赖 |
|--------|------|------|
| Wsl2Executor | Windows WSL2 | wsl.exe |
| LimaExecutor | macOS Lima | limactl |
| DockerExecutor | Linux/macOS Docker | docker |

`ExecutorManager` 负责生命周期管理，自动选择平台对应执行器。

## 回滚机制

`src/lib/rollbackManager.mjs` 基于文件系统快照实现回滚：

1. `snapshot(targetPath)` - 复制文件到快照目录
2. `record(operationType, target, snapshotId)` - 记录操作
3. `rollback(operationId)` - 恢复快照

快照存储在工作区 `.snapshots/` 目录下。

## 模型验证与导出

设置页的“测试模型”调用：

```text
POST /api/runtime/test-model
```

它会读取当前 Base URL、Model 和 API Key 来源，发送最小 OpenAI-compatible chat completions 请求，并返回可用性、延迟和错误摘要。

会话导出：

```text
GET /api/sessions/:id/export?format=markdown
GET /api/sessions/:id/export?format=json
```

Markdown 用于人工归档，JSON 用于后续迁移、同步和训练数据处理。

## 内置运行时

构建脚本会把本机 Node.js runtime 打进：

```text
AIAgent Client.app/Contents/Resources/runtime/
```

对于 Homebrew 动态链接 Node，脚本会递归复制 `libnode` 和依赖 dylib，并用 `install_name_tool` 改写为 Bundle 内相对路径。这样客户端启动不再依赖目标机器已经安装 Homebrew Node。
