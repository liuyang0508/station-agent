# CLAUDE.md

Station Agent is a local-first AI Agent desktop client with multi-platform GUI automation, MCP protocol, and vector memory.

## Project Overview

A cross-platform desktop application that serves as a local AI Agent client, with support for multiple runtimes (OpenAI-compatible API, Hermes, OpenClaw, OpenCowork sandbox) and MCP protocol for extensibility.

## Technology Stack

- **Language**: Node.js (ES Modules, `.mjs`)
- **UI**: Vanilla JS + HTML/CSS served from `public/`
- **Desktop Shell**: Swift (AppKit + WKWebView) for macOS
- **Storage**: SQLite (`better-sqlite3`) + JSON fallback
- **Vector Search**: `ml-distance` for embeddings

## Key Commands

```bash
npm start          # Start web server on http://127.0.0.1:47891
npm run dev        # Development mode
npm run build:mac  # Build macOS .app client
npm test           # Run tests
```

## Directory Structure

```
public/              # Web UI (HTML/CSS/JS)
src/
  ├── server.mjs     # HTTP control plane API
  ├── runtime/       # Agent runtime adapters (demo, remote, hermes, openclaw, opencowork)
  └── lib/           # Core libraries
macos/               # macOS native shell (Swift)
scripts/             # Build scripts
docs/                # Architecture and design docs
```

## Architecture

- `src/server.mjs` — HTTP API server (port 47891)
- `src/runtime/agentRuntime.mjs` — Runtime factory, selects adapter by `runtimeMode`
- `src/runtime/adapters/` — Per-runtime adapters (DemoRuntime, OpenAICompatibleRuntime, HermesRuntime, etc.)
- `src/lib/` — Core: MCP protocol, skill system, command execution, workspace, safety, storage
- `src/lib/sqliteStore.mjs` — SQLite storage with vector search
- `src/lib/mcpManager.mjs` — MCP server lifecycle
- `src/lib/skillManager.mjs` — Skill installation and execution

## Runtimes

| mode | adapter | description |
|------|---------|-------------|
| `demo` | DemoRuntime | Local demo, no API key |
| `remote` | OpenAICompatibleRuntime | OpenAI-compatible API |
| `hermes` | HermesRuntime | Hermes CLI |
| `openclaw` | OpenClawGatewayAdapter | OpenClaw Gateway |
| `opencowork` | OpenCoworkSandboxAdapter | WSL2/Lima/Docker sandbox |

## Key Conventions

- API endpoints return JSON, errors have `{ error: string }` shape
- File paths in workspace APIs are validated against realpath to prevent symlink escapes
- API keys are read from env vars or macOS Keychain, never written to store
- MCP servers are stdio-based JSON-RPC 2.0
- Skills support `.zip`, `.json`, `.md`, `.mjs`, `.js`, `.py` entry points
