# 架构设计

## 分层

```
AIAgent Client
├── public/                  # Web UI (HTML/CSS/JS)
├── macos/                   # macOS 原生 AppKit/WKWebView 客户端壳
├── scripts/                 # 构建脚本
├── src/
│   ├── server.mjs           # HTTP 控制面 API (port 47891)
│   ├── runtime/             # Agent Runtime
│   │   ├── agentRuntime.mjs      # 运行时工厂
│   │   ├── agentLoop.mjs        # 循环控制器
│   │   ├── checkpoint.mjs       # 检查点系统
│   │   ├── harness.mjs           # 运行时保护层
│   │   ├── decisionValidator.mjs # 决策验证
│   │   ├── constraintEnforcer.mjs # 约束执行
│   │   ├── rollbackManager.mjs   # 状态回滚
│   │   ├── skillCache.mjs        # 两层技能缓存
│   │   ├── toolRegistry.mjs      # 工具注册
│   │   ├── pythonBridge.mjs      # JS-Python IPC
│   │   └── adapters/            # 运行时适配器
│   └── lib/                   # 核心库
│       ├── store.mjs             # JSON 持久化
│       ├── sqliteStore.mjs       # SQLite + 向量检索
│       ├── mcpManager.mjs        # MCP 服务管理
│       ├── mcpProtocol.mjs        # MCP 协议
│       ├── mcpTransport.mjs       # MCP 传输层
│       ├── skillManager.mjs       # 技能管理
│       ├── skillEvolution.mjs    # 技能进化
│       ├── skillCache.mjs         # 两层缓存
│       ├── embedding.mjs          # 向量生成
│       ├── pythonSidecar.mjs     # Python 桥接
│       ├── safety.mjs            # 工作区安全边界
│       └── commandRunner.mjs      # 只读命令执行器
├── python/agent_core/        # Python Agent Core
│   ├── main.py               # JSON-RPC over stdio 入口
│   ├── skill_manager.py      # 技能管理
│   ├── memory.py            # TF-IDF 向量存储
│   ├── execution_engine.py  # 代码执行
│   ├── protocol.py          # JSON-RPC 协议
│   └── skills/              # Python 技能
└── docs/                    # 架构文档
```

## 核心对象

- **Session**：一个工作区内的连续 Agent 会话。
- **Message**：用户和 Agent 的消息，支持 Trace 附着。
- **Skill**：可启停的能力单元，支持 .zip/.json/.md/.mjs/.py 格式。
- **Connector**：远程通道、设备节点、MCP 服务的统一抽象。
- **MCP Server**：可登记、启动、停止的本地 MCP 进程，支持 stdio JSON-RPC 2.0 协议。
- **Task**：定时、实时、手动触发的自动化任务。
- **Approval**：命令、文件、远程发送等敏感动作的审批策略。
- **Memory**：长期稳定的偏好、项目知识和运行约束，支持向量检索。

---

## Agent 循环控制

`src/runtime/agentLoop.mjs` 实现状态机循环执行：

| 状态 | 说明 |
|------|------|
| `idle` | 空闲，等待启动 |
| `running` | 执行中 |
| `waiting` | 等待用户确认 |
| `paused` | 暂停 |

**检测机制**：
- 相同输出连续3次 → 停止
- 语义相似度 > 90% → 停止
- 最大迭代次数 100

**API**：
- `GET /api/agent/loop/status`
- `POST /api/agent/loop/start`
- `POST /api/agent/loop/stop`
- `POST /api/agent/loop/pause`

---

## Harness 运行时保护

`src/runtime/harness.mjs` 实现多层运行时保护：

| 约束类型 | 说明 |
|----------|------|
| `HARD` | 禁止破坏性操作，立即拦截 |
| `SOFT` | 高风险操作，需用户确认 |
| `OPTIMIZATION` | 优化建议 |

**内置约束**：
- `no_destructive` - 禁止删除、覆盖等破坏性操作
- `workspace_boundary` - 操作必须在工作区内
- `approval_required` - 高风险操作需审批

**API**：
- `GET /api/harness/status`
- `POST /api/harness/checkpoint`
- `POST /api/harness/rollback`
- `GET /api/harness/constraints`

**决策验证** `decisionValidator.mjs`：
- 检测重复决策
- 检测矛盾决策
- 语义相似度分析

**约束执行** `constraintEnforcer.mjs`：
- HARD 约束：直接拦截
- SOFT 约束：创建审批请求

---

## MCP 协议层

完整的 MCP stdio 协议实现（`@modelcontextprotocol/sdk` 兼容）：

| 文件 | 功能 |
|------|------|
| `mcpProtocol.mjs` | JSON-RPC 2.0 核心处理器 |
| `mcpTransport.mjs` | stdio 双向通信，支持 Content-Length 帧和 JSON-Lines |
| `mcpManager.mjs` | 服务生命周期、工具发现、工具调用 |

**MCP 服务管理 API**：

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/mcp` | GET | 列出所有 MCP 服务器 |
| `/api/mcp` | POST | 创建 MCP 服务器 |
| `/api/mcp/:id/start` | POST | 启动并握手 |
| `/api/mcp/:id/stop` | POST | 停止 |
| `/api/mcp/:id/tools` | GET | 列出已发现工具 |
| `/api/mcp/:id/call` | POST | 调用工具 |
| `/api/mcp/:id/discover` | POST | 重新发现工具 |

**内置 Filesystem MCP**：14 个工具
- read_file, read_text_file, read_media_file, read_multiple_files
- write_file, edit_file, create_directory
- list_directory, list_directory_with_sizes, directory_tree
- move_file, search_files, get_file_info, list_allowed_directories

---

## Python Agent Core

独立的 Python 运行时，通过 JSON-RPC over stdio 通信：

```
python/agent_core/
├── main.py              # JSON-RPC 服务端入口
├── skill_manager.py     # 技能加载/列表/运行
├── memory.py           # TF-IDF 向量存储
├── execution_engine.py  # 代码执行引擎
├── protocol.py        # JSON-RPC 协议
└── skills/            # Python 技能
    ├── demo_skill.py
    ├── web_search_skill.py
    ├── url_fetch_skill.py
    ├── code_analysis_skill.py
    └── memory_summary_skill.py
```

**Python 技能 API**：

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/python/skills` | GET | 列出 Python 技能 |
| `/api/python/skills/run` | POST | 运行技能 |
| `/api/python/memories` | GET/POST | 记忆管理 |
| `/api/python/exec` | POST | 执行 Python 代码 |

---

## 技能中心

两层缓存架构：

| 层 | 存储 | 策略 |
|---|------|------|
| Tier 1 | SQLite | 持久化全量 |
| Tier 2 | Memory LRU | 热点 20 个，30min TTL |

**技能进化** `skillEvolution.mjs`：
- 失败2次 → 自动评估
- 成功5次 → 优化建议
- 用户纠正 → 记录
- 超时后成功 → 新工作流模式

**API**：

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/skills` | GET | 列出所有技能 |
| `/api/skills/cache/status` | GET | 缓存状态 |
| `/api/skills/cache/warm` | POST | 预热 |
| `/api/skills/cache/clear` | POST | 清空内存 |
| `/api/skills/:id/evolution` | GET/POST | 进化历史 |
| `/api/skills/evolution/history` | GET | 全局进化历史 |

---

## 记忆系统

**向量检索**：`embedding.mjs`
- TF-IDF 嵌入生成
- 余弦相似度计算
- 自动检测"记住..."触发词

**SQLite 存储**：`sqliteStore.mjs`
- `createMemoryEmbedding()` - 存储向量
- `searchMemoriesByVector()` - 向量检索

**API**：

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/memories` | GET | 列出记忆 |
| `/api/memories` | POST | 创建记忆 |
| `/api/memories/search` | POST | 向量检索 |

---

## 连接器（Channels）

| 连接器 | 通道 | 状态 |
|--------|------|------|
| 微信/企微 | mobile | planned |
| 钉钉 | mobile | planned |
| Slack | remote | planned |
| 飞书 | remote | planned |
| 本地浏览器 | mcp | scaffolded |

---

## 运行时适配器

`src/runtime/agentRuntime.mjs` 作为工厂：

| runtimeMode | 适配器 | 说明 |
|------------|--------|------|
| `demo` | DemoRuntime | 本地演示模式 |
| `remote` / `openai` / `anthropic` | OpenAICompatibleRuntime | OpenAI-compatible API |
| `minimax` | MiniMaxRuntime | MiniMax API |
| `hermes` | HermesRuntime | Hermes CLI 运行时 |
| `gateway` | GatewayAdapter | 多通道消息网关 |
| `sandbox` | SandboxAdapter | WSL2/Lima/Docker 沙箱 |

---

## 存储层

| 文件 | 功能 |
|------|------|
| `store.mjs` | JSON 文件持久化（默认） |
| `sqliteStore.mjs` | SQLite + 向量检索，兼容 JsonStore 接口 |

---

## 执行器

`src/lib/executors/` 提供跨平台命令执行：

| 执行器 | 平台 | 依赖 |
|--------|------|------|
| Wsl2Executor | Windows WSL2 | wsl.exe |
| LimaExecutor | macOS Lima | limactl |
| DockerExecutor | Linux/macOS Docker | docker |

---

## 安全边界

- 静态文件服务禁止越过 `public/`。
- 工作区路径使用 realpath 校验，防止符号链接逃逸。
- 只读命令执行器不经过 shell，不支持管道、重定向和 shell 元字符。
- 命令执行必须先创建审批，审批通过后才能消费一次。
- MCP 服务启动器限制为 `node`、`npx`、`uvx`、`python`、`python3`，工作目录必须在工作区内。
- API Key 优先从环境变量读取，也可保存到 macOS Keychain；不会写入 JSON store。

---

## 客户端形态

- **macOS `.app`**：真正的桌面客户端，启动后自动拉起本地 Agent 服务。
- **macOS `.dmg` / `.zip`**：可分发构建产物。
- **本地 Web 调试入口**：开发时直接访问 `http://127.0.0.1:47891`。

`macos/AIAgentClient.swift` 负责：
- 创建原生 macOS 窗口并加载 WKWebView
- 优先使用 Bundle 内置 Node runtime，兜底查找系统 Node.js
- 等待 `/api/health` 就绪后加载客户端
- 限制 WebView 导航范围，只允许访问本地客户端服务

---

## 密钥管理

模型 API Key 不写入 `store.json`。读取顺序：

1. 环境变量，例如 `AIAGENT_API_KEY`
2. macOS Keychain，service 为 `AIAgent Client`

---

## API 诊断

```bash
# 健康检查
curl http://127.0.0.1:47891/api/health

# Agent Loop 状态
curl http://127.0.0.1:47891/api/agent/loop/status

# Harness 状态
curl http://127.0.0.1:47891/api/harness/status

# MCP 服务器
curl http://127.0.0.1:47891/api/mcp

# Python 技能
curl http://127.0.0.1:47891/api/python/skills

# 技能缓存
curl http://127.0.0.1:47891/api/skills/cache/status
```
