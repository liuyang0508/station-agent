# Findings & Decisions

## Requirements
<!-- 从用户请求和 README 中捕获的需求 -->
- MCP stdio 协议握手、工具发现和工具调用回放
- Hermes CLI/OpenClaw Gateway/OpenCowork sandbox 的深度适配器
- SQLite 存储、文件索引和向量检索
- 可写命令/文件变更的细粒度审批与回滚记录
- Windows WSL2、macOS Lima、Linux 容器化执行器

## Research Findings

### 当前项目架构
- **入口**: src/server.mjs (本地 HTTP 控制面 API)
- **运行时**: src/runtime/agentRuntime.mjs (唯一 Agent Runtime 入口)
- **当前支持模式**: demo (本地演示) / remote (OpenAI-compatible API)
- **核心模块**:
  - lib/store.mjs (JSON 持久化)
  - lib/safety.mjs (工作区和命令安全边界)
  - lib/commandRunner.mjs (只读命令审批执行器)
  - lib/mcpManager.mjs (本地 MCP 服务生命周期管理)
  - lib/skillManager.mjs (工作区技能安装和运行)
  - lib/workspace.mjs (工作区访问)
  - lib/secrets.mjs (密钥管理)
  - lib/sessionExport.mjs (会话导出)

### MCP 现状
- mcpManager.mjs 当前只管理进程生命周期（spawn/kill）
- 启动器限制: node/npx/uvx/python/python3
- 工作目录必须在工作区内
- **尚未实现**: stdio 协议握手、工具发现、工具调用回放
- stdio 连接方式: child.stdin/stdout 直接连接，未实现 JSON-RPC 协议解析

### 存储现状
- 当前使用 JSON 文件持久化 (store.json)
- 位于 ~/Library/Application Support/AIAgent Client
- README 提到"后续可替换 SQLite"
- **问题**: 无事务、无索引、无向量检索

### 命令执行器现状
- commandRunner.mjs 只支持只读命令 (pwd, ls, find, cat, head, tail, wc, rg, grep, git)
- git 只支持只读子命令 (status, log, diff, show, branch, rev-parse, ls-files, describe)
- 不支持管道、重定向、shell 元字符
- **问题**: 无写命令审批、无回滚机制

### 适配器现状
- agentRuntime.mjs 是唯一 Agent Runtime 入口
- 当前只支持 demo 和 remote 两种模式
- README 提到后续适配: Hermes CLI / OpenClaw Gateway / OpenCowork Sandbox
- **问题**: 无适配器接口抽象，无多运行时切换

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
| MCP stdio 分阶段实现 | 完整协议复杂，先实现核心功能 |
| SQLite 替代 JSON store | 支持事务、索引，适合复杂查询 |
| 适配器独立模块 | 便于切换和扩展不同运行时 |

## Issues Encountered
| Issue | Resolution |
|-------|------------|
|       |            |

## Resources
- 项目 README.md: /Users/liuyang/Desktop/AIAgent/aia-agent-client/README.md
- 架构文档: /Users/liuyang/Desktop/AIAgent/aia-agent-client/docs/ARCHITECTURE.md
- 核心源文件: src/server.mjs, src/runtime/agentRuntime.mjs
- 核心库文件: src/lib/*.mjs

## Visual/Browser Findings
<!-- 暂无可视化内容发现 -->
