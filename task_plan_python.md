# Task Plan: Python Agent Core 渐进迁移

## Goal

将 Station Agent 的 Agent Runtime 从 Node.js 迁移到 Python，为 Agent 自进化能力扫清技术障碍。采用渐进迁移策略，保留 Node.js 桌面壳，Python Agent Core 作为 sidecar 逐步接管。

## Migration Strategy: 渐进替换

```
阶段 1 (现在)                         阶段 2
┌────────────────────────────┐     ┌────────────────────────────┐
│  Node.js server.mjs         │     │  Node.js server.mjs          │
│         ↓ IPC               │     │         ↓ IPC               │
│  Python Agent Core sidecar  │ ← ← ←│  Python Agent Core sidecar  │
│  (独立进程，skillManager)    │     │  (接管更多模块)              │
└────────────────────────────┘     └────────────────────────────┘

阶段 3
┌────────────────────────────┐
│  Tauri Shell (Rust)         │
│         ↓ IPC               │
│  Python Agent Core          │
│  (完整接管)                  │
└────────────────────────────┘
```

## Current Phase

Phase 2: Python Agent Core 基础设施 + skillManager 迁移

## Phases

### Phase 1: 架构设计 ✓
- [x] 分析当前 Node.js 架构对 Agent 自进化的障碍
- [x] 确定渐进迁移策略
- [x] 设计 Tauri Shell ↔ Python Backend 通信协议
- [x] 输出 architecture_v2.md
- **Status:** complete

### Phase 2: Python Agent Core 基础设施 ✓
- [x] `python/agent_core/` 目录结构
- [x] JSON-RPC IPC 层（stdin/stdout）
- [x] skillManager Python 版
- [x] Memory 系统（SQLite + 向量）
- [x] Execution Engine（受控 subprocess）
- [x] sidecar.py（Node.js 进程管理器）
- [x] 验证：skill.load / list / run / reload
- [x] 验证：memory.store / list
- [x] 验证：exec.run
- [x] 验证：Node.js 进程调用 Python sidecar
- [x] 修复 Python 3.14 `importlib.util` 延迟导入问题
- **Status:** complete

### Phase 3: Node.js 集成 Python sidecar
- [ ] `pythonSidecar.mjs` — Node.js 模块封装 sidecar.py
- [ ] `server.mjs` 启动时自动拉起 Python sidecar
- [ ] 注册 /api/python/* 路由转发到 Python
- [ ] 修复 server.mjs ESM bug（Node.js v25.9.0 兼容性）
- [ ] 验证：Node.js HTTP 请求 → Python sidecar → JSON-RPC → response
- **Status:** in_progress

### Phase 3: memorySystem 迁移
- [ ] SQLite + 向量检索 Python 版
- [ ] 迁移现有数据
- [ ] Node.js 调用 Python memorySystem
- **Status:** pending

### Phase 4: toolGenerator 迁移
- [ ] LLM → Python 代码生成
- [ ] exec() 受控执行环境
- [ ] 自进化验证
- **Status:** pending

### Phase 5: MCP client 重写
- [ ] Python MCP stdio 客户端
- [ ] 工具发现/调用
- **Status:** pending

### Phase 6: Tauri Shell（可选）
- [ ] Tauri 项目初始化
- [ ] IPC 协议迁移
- [ ] Python Backend 完整接入
- **Status:** pending

## 技术决策

| Decision | Rationale |
|----------|-----------|
| 渐进迁移 | 保留 Node.js 桌面壳，Python sidecar 逐步接管 |
| Sidecar IPC | stdin/stdout JSON-RPC，简单解耦 |
| skillManager 先迁 | 自进化核心需要先落地 |
| `importlib` + `exec()` | Python Skill 动态加载，不走子进程 |

## Phase 2 详细任务

### 2.1 目录结构
```
python/
└── agent_core/
    ├── __init__.py       # 包入口
    ├── main.py           # sidecar 入口（stdin/stdout JSON-RPC）
    ├── skill_manager.py  # Skill 动态加载/卸载/重载
    ├── memory.py         # SQLite + 向量存储
    ├── tool_generator.py # LLM → Python 代码
    ├── execution_engine.py # 受控执行
    ├── mcp_client.py    # MCP stdio 客户端
    ├── runtime.py       # 运行时适配器
    └── protocol.py      # JSON-RPC 2.0 协议处理器
```

### 2.2 JSON-RPC IPC

```python
# python/agent_core/main.py
import sys
import json
from protocol import JSONRPCProtocol

def main():
    protocol = JSONRPCProtocol()
    for line in sys.stdin:
        request = json.loads(line)
        response = protocol.handle(request)
        if response:
            print(json.dumps(response), flush=True)

if __name__ == "__main__":
    main()
```

### 2.3 skillManager 接口

```python
# skillManager API over JSON-RPC
# Method: skill.load
# Params: { "path": "skills/web_search.py" }
# Result: { "name": "web_search", "description": "...", "tools": [...] }

# Method: skill.list
# Result: [{ "name": "...", "description": "...", "path": "..." }, ...]

# Method: skill.unload
# Params: { "name": "web_search" }
# Result: { "success": true }

# Method: skill.reload
# Params: { "name": "web_search" }
# Result: { "name": "...", "description": "...", "tools": [...] }
```

### 2.4 Node.js 集成

```javascript
// src/lib/pythonSidecar.mjs
// 启动 Python sidecar 进程，通过 stdin/stdout JSON-RPC 调用
// skillManager → Python Agent Core
```

## Errors Encountered

| Error | Attempt | Resolution |
|-------|---------|------------|
|       |         |            |
