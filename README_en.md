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
  <strong>Local-first AI Agent Desktop Client</strong>
</p>

<p align="center">
  Self-developed architecture with multi-runtime support, MCP protocol extension, Python Agent Core, vector memory, and skill evolution
</p>

<p align="center">
  <a href="#-quick-start">Quick Start</a> ·
  <a href="#-core-features">Features</a> ·
  <a href="#-architecture">Architecture</a> ·
  <a href="#-api-reference">API</a> ·
  <a href="#-development">Development</a>
</p>

---

## ✨ Core Features

### 🤖 Multi-Runtime Adapters

| Mode | Description | API Dependency |
|------|-------------|----------------|
| `demo` | Local demo, zero config | None |
| `remote` | OpenAI-compatible API | API Key |
| `minimax` | MiniMax API + tool loop | API Key |
| `hermes` | Hermes CLI proxy | Hermes service |
| `opencowork` | OpenCowork sandbox | OpenCowork |
| `openclaw` | OpenClaw gateway | OpenClaw |

### 🛡️ Security System

```
┌─────────────────────────────────────────────────────────┐
│                    Security Layers                       │
├─────────────────────────────────────────────────────────┤
│  SSRF Protection    │ validateUrl · safeFetch          │
│  MCP Param Validation│ DANGEROUS_FLAGS · path traversal│
│  Harness Protection  │ HARD/SOFT constraints · approval│
│  Command Allowlist   │ validateReadOnlyCommand         │
│  Workspace Boundary  │ validateWorkspacePath           │
└─────────────────────────────────────────────────────────┘
```

### 🔌 MCP Protocol Support

- Complete Model Context Protocol stdio implementation
- Built-in Filesystem MCP (14 tools)
- Auto tool discovery + 5-minute periodic refresh
- JSON-RPC 2.0 + Content-Length framing

### 🧠 Memory & Evolution

| Component | Function |
|-----------|----------|
| **Vector Memory** | TF-IDF embeddings · cosine similarity search |
| **Skill Evolution** | AST code modification · retry on failure · success augmentation |
| **Snapshot Rollback** | Multi-version backup · point-in-time recovery |

### 📡 Multi-Channel Integration

| Channel | Status |
|---------|--------|
| Slack | ✅ Webhook/Bot |
| Discord | ✅ Webhook |
| Telegram | ✅ Bot Polling |
| Webhook | ✅ Generic |

### 🔄 Remote Control

Session migration across devices — generate migration tickets and restore work state on any device.

---

## 🚀 Quick Start

### Requirements

- **Node.js** ≥ 18
- **Python** 3.10+ (for Python Agent Core)
- **macOS / Linux / Windows**

### Installation

```bash
# Clone the project
git clone https://github.com/liuyang0508/station-agent.git
cd station-agent

# Install dependencies
npm install

# Build macOS client (optional)
npm run build:mac
```

### Startup

```bash
# Start web UI by default
npm start

# Open browser
open http://127.0.0.1:47891
```

### Configure Model

```bash
# Set API Key
export AIAGENT_API_KEY="your-api-key"

# Start service
npm start
```

Or configure runtime mode, Base URL, and Model directly in the client settings page.

### CLI Pipe Mode

```bash
# Single task
echo "Write a hello world for me" | station-agent --cli

# Specify prompt
station-agent --cli -p "Analyze this log"

# Interactive mode
station-agent --cli -i
```

---

## 📐 Architecture

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

### Directory Structure

```
station-agent/
├── public/                     # Web UI (HTML/CSS/JS)
├── src/
│   ├── server.mjs             # HTTP API server
│   ├── runtime/
│   │   ├── agentLoop.mjs      # Loop controller
│   │   ├── harness.mjs        # Runtime protection
│   │   ├── sandboxExecutor.mjs # Sandbox executor
│   │   └── adapters/          # Runtime adapters
│   │       ├── BaseRuntime.mjs
│   │       ├── BaseRemoteAdapter.mjs
│   │       ├── MiniMaxRuntime.mjs
│   │       ├── OpenAICompatibleRuntime.mjs
│   │       └── ...
│   └── lib/
│       ├── mcpManager.mjs      # MCP service management
│       ├── mcpProtocol.mjs     # MCP protocol
│       ├── skillEvolution.mjs  # Skill evolution engine
│       ├── ssrfValidator.mjs    # SSRF protection
│       ├── circuitBreaker.mjs   # Circuit breaker
│       ├── retry.mjs           # Retry logic
│       ├── logger.mjs          # Structured logging
│       ├── remoteControl.mjs   # Session migration
│       ├── channels.mjs        # Multi-channel integration
│       ├── agentSdk.mjs        # Agent SDK
│       └── routines.mjs         # Cloud scheduled tasks
├── python/agent_core/          # Python Agent Core
│   ├── agent.py
│   ├── memory.py
│   ├── tools.py
│   └── skills/
├── macos/                      # macOS native shell
├── tests/                      # Tests
└── docs/                       # Architecture docs
```

---

## 🔌 API Reference

### Agent Control

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/runs` | POST | Create task |
| `/api/runs/:id/events` | GET | SSE event stream |
| `/api/runs/:id/cancel` | POST | Cancel task |

### Security

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/security/validate-url` | POST | URL SSRF detection |
| `/api/mcp/:id/validate` | POST | MCP param validation |

### Scheduled Tasks

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/routines` | GET/POST | Routine CRUD |
| `/api/routines/:id/trigger` | POST | Trigger execution |

### Remote Control

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/teleport/ticket` | POST | Create migration ticket |
| `/api/teleport/tickets` | GET | List tickets |
| `/api/teleport/redeem` | POST | Restore with ticket |

---

## 🧪 Development

```bash
# Development mode (hot reload)
npm run dev

# Run tests
npm test

# Lint
npm run lint

# Build macOS
npm run build:mac
```

### Testing

```bash
# Core component tests
node --test tests/core.test.mjs

# Enhancement tests
node --test tests/enhancements.test.mjs
```

---

## 📊 Routine Cadence

| Format | Description | Example |
|--------|-------------|---------|
| `daily HH:MM` | Daily at specific time | `daily 09:00` |
| `weekday HH:MM` | Weekdays at specific time | `weekday 18:30` |
| `weekly DAY HH:MM` | Weekly at specific time | `weekly mon 09:00` |
| `monthly DD HH:MM` | Monthly at specific time | `monthly 1 09:00` |
| `every N min` | Interval execution | `every 30 min` |

---

## ❓ FAQ

**Q: API Key not working**
A: Make sure `export AIAGENT_API_KEY="..."` is executed before `npm start`, or fill in the settings page directly.

**Q: Model returns demo mode responses**
A: Check if Base URL is correct (MiniMax uses `https://api.minimax.io/v1`), restart the service and refresh the page.

**Q: Service startup error EADDRINUSE**
A: Port 47891 is in use. Run `lsof -ti:47891 | xargs kill -9` then retry.

---

## 📄 License

MIT License · Copyright © 2024

<p align="center">
  <sub>If this project helps you, feel free to ⭐ Star</sub>
</p>