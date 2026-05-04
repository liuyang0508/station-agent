# Station Agent

本地优先 AI Agent 客户端，自研架构，支持多运行时、MCP 协议扩展和 Python Agent Core。

---

## 快速启动

### 1. 安装依赖

```bash
npm install
```

### 2. 启动 Web 服务

```bash
npm start
```

浏览器打开 **http://127.0.0.1:47891**

### 3. 配置模型（可选）

```bash
export AIAGENT_API_KEY="your-api-key"
npm start
```

或在客户端设置页填写：
- **运行模式**: `remote`
- **Base URL**: `https://api.minimax.io/v1`（MiniMax 示例）
- **Model**: `MiniMax-M2.7`
- **API Key Env**: `AIAGENT_API_KEY`

### 4. 构建 macOS 客户端

```bash
npm run build:mac
```

生成 `dist/macos/AIAgent Client.app`

---

## 核心能力

### 1. Agent 循环控制

支持自动循环执行任务，状态机控制：

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/agent/loop/status` | GET | 获取循环状态 |
| `/api/agent/loop/start` | POST | 启动循环 |
| `/api/agent/loop/stop` | POST | 停止循环 |
| `/api/agent/loop/pause` | POST | 暂停循环 |

**检测机制**：相同输出3次 / 语义相似度90% / 最大100次迭代

---

### 2. Harness 运行时保护

运行时保护层，防止破坏性操作：

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/harness/status` | GET | 获取保护状态 |
| `/api/harness/checkpoint` | POST | 创建检查点 |
| `/api/harness/rollback` | POST | 回滚到检查点 |
| `/api/harness/constraints` | GET | 获取约束列表 |

**约束类型**：
- `no_destructive` (HARD) - 禁止破坏性操作
- `workspace_boundary` (HARD) - 操作必须在工作区内
- `approval_required` (SOFT) - 高风险操作需审批

---

### 3. MCP 协议与工具

完整的 MCP stdio 协议实现，支持工具发现和调用：

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/mcp` | GET | 列出所有 MCP 服务器 |
| `/api/mcp` | POST | 创建 MCP 服务器 |
| `/api/mcp/:id/tools` | GET | 列出已发现工具 |
| `/api/mcp/:id/call` | POST | 调用工具 |
| `/api/mcp/:id/discover` | POST | 重新发现工具 |
| `/api/mcp/:id/start` | POST | 启动服务器 |
| `/api/mcp/:id/stop` | POST | 停止服务器 |

**内置 Filesystem MCP**：14 个工具（read_file, write_file, edit_file, list_directory, move_file, search_files 等）

---

### 4. Python Agent Core

独立的 Python Agent 运行时，通过 JSON-RPC over stdio 与 Node.js 通信：

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/python/skills` | GET | 列出 Python 技能 |
| `/api/python/skills/run` | POST | 运行技能 |
| `/api/python/memories` | GET/POST | 记忆管理 |
| `/api/python/exec` | POST | 执行 Python 代码 |

**内置 Python 技能**：

| 技能 | 功能 |
|------|------|
| `demo` | 返回问候语 |
| `web_search` | DuckDuckGo 网页搜索 |
| `url_fetch` | 提取 URL 内容 |
| `code_analysis` | 代码分析（行数/函数/复杂度） |
| `memory_summary` | 记忆摘要与检索 |

---

### 5. 技能中心

渐进式技能加载，两层缓存架构：

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/skills` | GET | 列出所有技能 |
| `/api/skills/cache/status` | GET | 缓存状态 |
| `/api/skills/cache/warm` | POST | 预热技能 |
| `/api/skills/cache/clear` | POST | 清空内存缓存 |
| `/api/skills/:id/evolution` | GET/POST | 进化历史/触发 |
| `/api/skills/evolution/history` | GET | 全局进化历史 |

**缓存架构**：Memory LRU (20个/30min TTL) + SQLite 持久化

**进化触发**：失败2次 / 成功5次 / 用户纠正 / 超时后成功

---

### 6. 记忆系统

长期记忆存储，支持向量检索：

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/memories` | GET | 列出记忆 |
| `/api/memories/search` | POST | 向量检索 |
| `/api/memories` | POST | 创建记忆 |

**向量检索**：TF-IDF 嵌入 + 余弦相似度，触发词"记住..."自动创建

---

### 7. 连接器（Channels）

多通道消息接入：

| 连接器 | 通道 | 状态 |
|--------|------|------|
| 微信/企微 | mobile | planned |
| 钉钉 | mobile | planned |
| Slack | remote | planned |
| 飞书 | remote | planned |
| 本地浏览器 | mcp | scaffolded |

---

### 8. 命令执行与审批

写命令需审批通过后再执行：

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/approvals` | GET | 列出审批 |
| `/api/approvals` | POST | 创建审批 |
| `/api/approvals/:id/approve` | POST | 批准 |
| `/api/approvals/:id/reject` | POST | 拒绝 |
| `/api/approvals/:id/consume` | POST | 消费审批 |

---

## 技能上传

上传安装技能，支持：

| 文件类型 | 说明 |
|---------|------|
| `.zip` | 打包技能包（自动解压） |
| `.json` | skill.json 元数据 |
| `.md` | SKILL.md 文档 |
| `.mjs` / `.js` / `.py` | 入口文件 |

拖放文件或点击选择，然后点**安装**。

---

## 运行模式

| 模式 | 说明 |
|------|------|
| `demo` | 本地演示，无需 API Key |
| `remote` | OpenAI-compatible / Anthropic API |
| `hermes` | Hermes CLI 集成 |
| `gateway` | 多通道消息网关 |
| `sandbox` | WSL2 / Lima / Docker 沙箱 |

---

## 目录结构

```
public/              # Web UI (HTML/CSS/JS)
src/
│   ├── server.mjs       # HTTP 控制面
│   ├── runtime/         # 运行时
│   │   ├── agentLoop.mjs       # 循环控制器
│   │   ├── checkpoint.mjs       # 检查点
│   │   ├── harness.mjs          # 运行时保护
│   │   ├── decisionValidator.mjs # 决策验证
│   │   ├── constraintEnforcer.mjs # 约束执行
│   │   ├── rollbackManager.mjs   # 状态回滚
│   │   ├── skillCache.mjs        # 两层技能缓存
│   │   ├── toolRegistry.mjs      # 工具注册
│   │   ├── pythonBridge.mjs     # JS-Python IPC
│   │   └── adapters/            # 运行时适配器
│   └── lib/             # 核心库
│       ├── mcpManager.mjs       # MCP 服务管理
│       ├── mcpProtocol.mjs      # MCP 协议
│       ├── mcpTransport.mjs     # MCP 传输层
│       ├── embedding.mjs         # 向量生成
│       ├── skillEvolution.mjs   # 技能进化
│       ├── pythonSidecar.mjs    # Python 桥接
│       └── store.mjs            # JSON 存储
python/agent_core/     # Python Agent Core
│   ├── main.py            # JSON-RPC 入口
│   ├── skill_manager.py   # 技能管理
│   ├── memory.py         # 记忆系统
│   ├── execution_engine.py # 代码执行
│   └── skills/           # Python 技能
macos/               # macOS 原生壳
scripts/             # 构建脚本
docs/                # 架构文档
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

---

## 测试

```bash
npm test
```
