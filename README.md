# Station Agent

<!-- Badge Row -->

<p align="center">
  <img src="https://img.shields.io/badge/version-0.2.0-blue?style=flat-square" alt="Version">
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License">
  <img src="https://img.shields.io/badge/node-%E2%89%A518-orange?style=flat-square" alt="Node">
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-purple?style=flat-square" alt="Platform">
  <img src="https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square" alt="PRs Welcome">
</p>

<p align="center">
  <strong>本地优先的 AI Agent 桌面客户端</strong>
</p>

<p align="center">
  自研架构，支持多运行时、MCP 协议扩展、Python Agent Core、向量记忆与技能进化
</p>

<p align="center">
  <a href="#-快速开始">快速开始</a> ·
  <a href="#-核心特性">核心特性</a> ·
  <a href="#-架构设计">架构设计</a> ·
  <a href="#-API-接口">API</a> ·
  <a href="#-开发">开发</a>
</p>

---

## ✨ 核心特性

### 🤖 多运行时适配器

| 模式 | 描述 | API 依赖 |
|------|------|---------|
| `demo` | 本地演示，零配置 | 无 |
| `remote` | OpenAI 兼容接口 | API Key |
| `minimax` | MiniMax API + 工具循环 | API Key |
| `hermes` | Hermes CLI 代理 | Hermes 服务 |
| `opencowork` | OpenCowork 沙箱 | OpenCowork |
| `openclaw` | OpenClaw 网关 | OpenClaw |

### 🛡️ 安全防护体系

```
┌─────────────────────────────────────────────────────────┐
│                    安全层级                               │
├─────────────────────────────────────────────────────────┤
│  SSRF 防护      │ validateUrl · safeFetch              │
│  MCP 参数验证   │ DANGEROUS_FLAGS · 路径遍历拦截        │
│  Harness 保护   │ HARD/SOFT 约束 · 审批流程            │
│  命令白名单     │ validateReadOnlyCommand               │
│  工作区边界     │ validateWorkspacePath                 │
└─────────────────────────────────────────────────────────┘
```

### 🔌 MCP 协议支持

- 完整的 Model Context Protocol stdio 实现
- 内置 Filesystem MCP（14 个工具）
- 工具自动发现 + 5 分钟定期刷新
- JSON-RPC 2.0 + Content-Length 帧

### 🧠 记忆与进化

| 组件 | 功能 |
|------|------|
| **向量记忆** | TF-IDF 嵌入 · 余弦相似度搜索 |
| **技能进化** | AST 代码修改 · 失败重试 · 成功增强 |
| **快照回滚** | 多版本备份 · 任意时间点恢复 |

### 📡 多渠道集成

| 渠道 | 状态 |
|------|------|
| Slack | ✅ Webhook/Bot |
| Discord | ✅ Webhook |
| Telegram | ✅ Bot Polling |
| Webhook | ✅ 通用 |

### 🔄 Remote Control

Session 跨设备迁移 — 生成迁移票据，在任意设备恢复工作状态。

---

## 🚀 快速开始

### 环境要求

- **Node.js** ≥ 18
- **Python** 3.10+（用于 Python Agent Core）
- **macOS / Linux / Windows**

### 安装

```bash
# 克隆项目
git clone https://github.com/liuyang0508/station-agent.git
cd station-agent

# 安装依赖
npm install

# 构建 macOS 客户端（可选）
npm run build:mac
```

### 启动

```bash
# 默认启动 Web UI
npm start

# 打开浏览器访问
open http://127.0.0.1:47891
```

### 配置模型

```bash
# 设置 API Key
export AIAGENT_API_KEY="your-api-key"

# 启动服务
npm start
```

或在客户端设置页填写运行模式、Base URL 和 Model。

### CLI 管道模式

```bash
# 单次任务
echo "帮我写一个 hello world" | station-agent --cli

# 指定 prompt
station-agent --cli -p "分析这个日志"

# 交互模式
station-agent --cli -i
```

---

## 📐 架构设计

```
┌────────────────────────────────────────────────────────────┐
│                         Station Agent                        │
├────────────────────────────────────────────────────────────┤
│   Web UI (Vanilla JS)  │  HTTP API (port 47891)           │
├────────────────────────────────────────────────────────────┤
│                    Runtime Factory                           │
│  ┌──────────┬──────────┬──────────┬──────────┬────────┐ │
│  │   Demo   │  Remote  │ MiniMax  │  Hermes  │ Open.. │ │
│  └──────────┴──────────┴──────────┴──────────┴────────┘ │
├────────────────────────────────────────────────────────────┤
│   AgentLoop   │   Harness   │   SkillCache   │  Context  │
├────────────────────────────────────────────────────────────┤
│   MCP Manager  │  PythonBridge  │  ToolRegistry           │
├────────────────────────────────────────────────────────────┤
│   SQLite Store  │  embedding.mjs  │  skillEvolution.mjs    │
└────────────────────────────────────────────────────────────┘
```

### 目录结构

```
station-agent/
├── public/                     # Web UI (HTML/CSS/JS)
├── src/
│   ├── server.mjs             # HTTP API 服务器
│   ├── runtime/
│   │   ├── agentLoop.mjs      # 循环控制器
│   │   ├── harness.mjs        # 运行时保护
│   │   ├── sandboxExecutor.mjs # 沙箱执行器
│   │   └── adapters/          # 运行时适配器
│   │       ├── BaseRuntime.mjs
│   │       ├── BaseRemoteAdapter.mjs
│   │       ├── MiniMaxRuntime.mjs
│   │       ├── OpenAICompatibleRuntime.mjs
│   │       └── ...
│   └── lib/
│       ├── mcpManager.mjs      # MCP 服务管理
│       ├── mcpProtocol.mjs     # MCP 协议
│       ├── skillEvolution.mjs  # 技能进化引擎
│       ├── ssrfValidator.mjs    # SSRF 防护
│       ├── circuitBreaker.mjs   # 熔断器
│       ├── retry.mjs           # 重试逻辑
│       ├── logger.mjs          # 结构化日志
│       ├── remoteControl.mjs   # Session 迁移
│       ├── channels.mjs        # 多渠道集成
│       ├── agentSdk.mjs        # Agent SDK
│       └── routines.mjs         # 云端定时任务
├── python/agent_core/          # Python Agent Core
│   ├── agent.py
│   ├── memory.py
│   ├── tools.py
│   └── skills/
├── macos/                      # macOS 原生壳
├── tests/                      # 测试
└── docs/                       # 架构文档
```

---

## 🔌 API 接口

### Agent 控制

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/runs` | POST | 创建任务 |
| `/api/runs/:id/events` | GET | SSE 事件流 |
| `/api/runs/:id/cancel` | POST | 取消任务 |

### 安全防护

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/security/validate-url` | POST | URL SSRF 检测 |
| `/api/mcp/:id/validate` | POST | MCP 参数验证 |

### 定时任务

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/routines` | GET/POST | Routine CRUD |
| `/api/routines/:id/trigger` | POST | 触发执行 |

### Remote Control

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/teleport/ticket` | POST | 创建迁移票据 |
| `/api/teleport/tickets` | GET | 列出票据 |
| `/api/teleport/redeem` | POST | 使用票据恢复 |

---

## 🧪 开发

```bash
# 开发模式（热重载）
npm run dev

# 运行测试
npm test

# 语法检查
npm run lint

# 构建 macOS
npm run build:mac
```

### 测试

```bash
# 核心组件测试
node --test tests/core.test.mjs

# 增强功能测试
node --test tests/enhancements.test.mjs
```

---

## 📊 定时任务 cadence

| 格式 | 说明 | 示例 |
|------|------|------|
| `daily HH:MM` | 每天定点 | `daily 09:00` |
| `weekday HH:MM` | 工作日定点 | `weekday 18:30` |
| `weekly DAY HH:MM` | 每周定点 | `weekly mon 09:00` |
| `monthly DD HH:MM` | 每月定点 | `monthly 1 09:00` |
| `every N min` | 间隔执行 | `every 30 min` |

---

## ❓ FAQ

**Q: API Key 不生效**
A: 确保 `export AIAGENT_API_KEY="..."` 在 `npm start` 之前执行，或在客户端设置页直接填写。

**Q: 模型返回 demo 模式回复**
A: 检查 Base URL 是否正确（MiniMax 用 `https://api.minimax.io/v1`），确认重启服务后刷新页面。

**Q: 服务启动报错 EADDRINUSE**
A: 端口 47891 被占用，执行 `lsof -ti:47891 | xargs kill -9` 后重试。

---

## 📄 License

MIT License · Copyright © 2024

<p align="center">
  <sub>如果这个项目对你有帮助，欢迎 ⭐ Star</sub>
</p>
