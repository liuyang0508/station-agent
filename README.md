# Station Agent

<!-- Badge Row -->
![Version](https://img.shields.io/badge/version-0.1.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Node](https://img.shields.io/badge/node-%3E%3D18-orange)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-purple)

**本地优先 AI Agent 客户端** — 自研架构，支持多运行时、MCP 协议扩展和 Python Agent Core。

---

## 功能特性

### 🤖 Agent 循环控制
状态机驱动的自主执行循环，支持：
- **检测机制**：相同输出3次 / 语义相似度90% / 最大100次迭代
- **控制端点**：启动 / 停止 / 暂停 / 恢复

### 🛡️ Harness 运行时保护
多层运行时保护，防止破坏性操作：
- **HARD 约束**：禁止删除、覆盖等破坏性操作
- **SOFT 约束**：高风险操作创建审批请求
- **快照回滚**：基于文件系统快照的状态恢复

### 🔌 MCP 协议支持
完整的 Model Context Protocol stdio 实现：
- 内置 Filesystem MCP（14 个工具）
- 支持任意 MCP 服务器接入
- JSON-RPC 2.0 + Content-Length 帧

### 🐍 Python Agent Core
独立的 Python 运行时，JS-Python 通过 stdio JSON-RPC 通信：
- 5 个内置技能（demo, web_search, url_fetch, code_analysis, memory_summary）
- TF-IDF 向量记忆系统
- 沙箱代码执行引擎

### ⚡ 渐进式技能加载
两层缓存架构：
- **Memory LRU**：20 个热点，30min TTL
- **SQLite**：持久化全量缓存
- **进化机制**：失败2次 / 成功5次 / 用户纠正 / 超时后成功

### 🧠 记忆系统
长期记忆 + 向量检索：
- TF-IDF 嵌入生成
- 余弦相似度搜索
- 触发词"记住..."自动创建

### 📡 多通道连接器
| 通道 | 连接器 | 状态 |
|------|--------|------|
| Mobile | 微信/企微、钉钉 | planned |
| Remote | Slack、飞书 | planned |
| Local | 本地浏览器 (MCP) | scaffolded |

---

## 快速开始

### 安装

```bash
git clone https://github.com/liuyang0508/station-agent.git
cd station-agent
npm install
```

### 启动 Web 服务

```bash
npm start
```

打开 **http://127.0.0.1:47891**

### 配置模型（可选）

```bash
export AIAGENT_API_KEY="your-api-key"
npm start
```

或在客户端设置页填写：
- **运行模式**：`remote` 或 `minimax`
- **Base URL**：例如 `https://api.minimax.io/v1`
- **Model**：`MiniMax-M2.7`

### 构建 macOS 客户端

```bash
npm run build:mac
```

生成 `dist/macos/AIAgent Client.app`

---

## 技术架构

```
┌─────────────────────────────────────────────────────┐
│                    Station Agent                     │
├─────────────────────────────────────────────────────┤
│  Web UI (public/)     │   HTTP API (port 47891)    │
├─────────────────────────────────────────────────────┤
│                 Agent Runtime Factory                │
│  ┌──────────┬──────────┬──────────┬──────────┐     │
│  │   Demo   │  Remote  │ MiniMax  │ Hermes   │     │
│  └──────────┴──────────┴──────────┴──────────┘     │
├─────────────────────────────────────────────────────┤
│  Agent Loop   │  Harness   │  Skill Cache          │
├─────────────────────────────────────────────────────┤
│  MCP Manager  │  Python Bridge  │  Tool Registry     │
├─────────────────────────────────────────────────────┤
│  SQLite Store  │  embedding.mjs  │  skillEvolution   │
└─────────────────────────────────────────────────────┘
```

### 目录结构

```
station-agent/
├── public/                  # Web UI
├── src/
│   ├── server.mjs          # HTTP API 服务器
│   ├── runtime/
│   │   ├── agentLoop.mjs   # 循环控制器
│   │   ├── harness.mjs     # 运行时保护
│   │   ├── pythonBridge.mjs # JS-Python IPC
│   │   └── adapters/       # 运行时适配器
│   └── lib/
│       ├── mcpProtocol.mjs  # MCP 协议
│       ├── mcpTransport.mjs # MCP 传输层
│       ├── embedding.mjs    # 向量生成
│       └── skillEvolution.mjs # 技能进化
├── python/agent_core/      # Python Agent Core
│   ├── agent.py
│   ├── memory.py
│   ├── tools.py
│   └── skills/
├── macos/                   # macOS 原生壳
├── scripts/                 # 构建脚本
└── docs/                    # 架构文档
```

---

## API 端点

### Agent 控制
| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/agent/loop/status` | GET | 获取循环状态 |
| `/api/agent/loop/start` | POST | 启动循环 |
| `/api/agent/loop/stop` | POST | 停止循环 |
| `/api/runs` | POST | 创建任务 |
| `/api/runs/:id/events` | GET | SSE 事件流 |

### Harness 保护
| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/harness/status` | GET | 保护状态 |
| `/api/harness/checkpoint` | POST | 创建检查点 |
| `/api/harness/rollback` | POST | 回滚 |
| `/api/harness/constraints` | GET | 约束列表 |

### MCP 协议
| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/mcp` | GET | 列出服务器 |
| `/api/mcp/:id/tools` | GET | 工具列表 |
| `/api/mcp/:id/call` | POST | 调用工具 |

### Python Agent
| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/python/skills` | GET | 技能列表 |
| `/api/python/skills/run` | POST | 运行技能 |
| `/api/python/memories` | GET/POST | 记忆管理 |
| `/api/agent/stream` | GET | SSE 流式响应 |

### 技能中心
| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/skills` | GET | 技能列表 |
| `/api/skills/cache/status` | GET | 缓存状态 |
| `/api/skills/:id/evolution` | GET/POST | 进化历史 |

### 记忆系统
| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/memories` | GET/POST | 记忆CRUD |
| `/api/memories/search` | POST | 向量检索 |

---

## 运行模式

| 模式 | 说明 | 依赖 |
|------|------|------|
| `demo` | 本地演示，无需 API | 无 |
| `remote` | OpenAI-compatible API | API Key |
| `minimax` | MiniMax API | API Key |
| `hermes` | Hermes CLI 集成 | hermes |
| `sandbox` | WSL2/Lima/Docker | 容器环境 |

---

## 诊断命令

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

---

## 常见问题

**Q: API Key 不生效**
A: 确保 `export AIAGENT_API_KEY="..."` 在 `npm start` 之前执行，或在客户端设置页直接填写。

**Q: 模型返回 demo 模式回复**
A: 检查 Base URL 是否正确（MiniMax 用 `https://api.minimax.io/v1`），确认重启服务后刷新页面。

**Q: 技能上传失败**
A: 确保上传的是 `.zip`/`.json`/`.md`/`.mjs` 等支持的文件格式，路径不含特殊字符。

**Q: 服务启动报错 EADDRINUSE**
A: 端口 47891 被占用，执行 `lsof -ti:47891 | xargs kill -9` 后重试。

---

## 开发

```bash
# 开发模式
npm run dev

# 测试
npm test

# 构建 macOS
npm run build:mac
```

---

## License

MIT