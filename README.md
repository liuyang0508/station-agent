# Station Agent

本地优先 AI Agent 客户端，融合 OpenCowork / OpenClaw / Hermes Agent 架构经验。

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

**启动客户端**：
```bash
open "dist/macos/AIAgent Client.app"
```

或双击 Finder 中的 `AIAgent-Client-0.1.0-mac-arm64.dmg` 安装

### 5. Windows 客户端

Windows 原生客户端开发中，目前可通过以下方式使用：

**方式一：Web 服务（推荐）**

```bash
# Windows PowerShell
npm start
```

浏览器打开 **http://127.0.0.1:47891**

**方式二：待发布 Tauri 客户端**

Tauri Windows 客户端正在构建中，完成后将生成：
- `AIAgent Client.exe`
- `AIAgent-Client-0.2.0-win-x64.msi`

---

## 功能模块

### 技能中心

上传安装技能，支持：

| 文件类型 | 说明 |
|---------|------|
| `.zip` | 打包技能包（自动解压） |
| `.json` | skill.json 元数据 |
| `.md` | SKILL.md 文档 |
| `.mjs` / `.js` / `.py` | 入口文件 |

拖放文件或点击选择，然后点**安装**。

### 运行模式

| 模式 | 说明 |
|------|------|
| `demo` | 本地演示，无需 API Key |
| `remote` | OpenAI-compatible / Anthropic API |
| `hermes` | Hermes CLI 集成 |
| `openclaw` | OpenClaw Gateway |
| `opencowork` | WSL2 / Lima / Docker 沙箱 |

### MCP 服务

支持本地 MCP stdio 协议服务登记和管理。

### 工作区

文件浏览、安全预览、路径边界校验。

### 命令审批

写命令需审批通过后再执行，配套文件快照回滚。

---

## 目录结构

```
├── public/              # Web UI (HTML/CSS/JS)
├── src/
│   ├── server.mjs       # HTTP 控制面
│   ├── runtime/         # 运行时适配器
│   └── lib/             # 核心库
├── macos/               # macOS 原生壳
├── scripts/             # 构建脚本
└── docs/                # 架构文档
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
curl http://127.0.0.1:47891/api/health
```

查看运行时配置和健康状态。

---

## 测试

```bash
npm test
```
