# Findings: Python Agent Core 迁移

## 背景

用户核心需求确认：**Agent 自进化能力**。

- Agent 能自主生成、加载、改进 Skills
- 当前 Node.js 架构下 Python Skill 只能通过子进程调用
- 自进化需要 Agent 直接掌控 Python 代码执行

## 关键发现

### Node.js 架构对自进化的障碍

```
Agent 生成 Python 代码
    → Node.js spawn 写文件
    → python3 skill.py（每次新建进程）
    → 结果序列化返回
```

- **进程边界多**：至少 2 个（Node spawn → Python 进程）
- **无 Python 内存空间**：Agent 不能 import inspect 模块
- **迭代成本高**：每次改动要 fork/exec
- **AST 不可用**：Python AST、importlib、exec() 在 Node.js 侧无法原生调用

### Tauri vs Electron 对 Python Backend 的影响

| | Tauri | Electron |
|---|---|---|
| Python 集成 | PyO3（内存）或 Sidecar | 需要自己绕 |
| 体积 | ~10MB | ~150MB+ |
| Python 环境打包 | 可随 sidecar 一起打 | 需额外处理 |

### PyO3 vs Sidecar

| 方案 | 优点 | 缺点 |
|------|------|------|
| PyO3 | 内存集成，性能好 | 打包复杂，CI/CD 难度高 |
| Sidecar | 调试容易，独立演进，解耦好 | 进程间通信开销 |

**推荐 Sidecar**：Python Backend 可以 `python -m agent_core` 独立运行，Tauri 只负责启动/停止/通信。

### IPC 协议选择

| 方案 | 优点 | 缺点 |
|------|------|------|
| stdin/stdout JSON-RPC | 简单，调试友好，Rust/Python 都有库 | 只适合父子进程 |
| WebSocket | 双向通信，可独立连接 | 稍复杂 |
| gRPC | 序列化效率高 | 依赖多 |

**推荐 stdin/stdout JSON-RPC**：Agent 侧不需要高性能，调试友好是最大优势。

### Skill 接口设计

```python
from agent_core import Skill, register_skill

class WebSearchSkill(Skill):
    name = "web_search"
    description = "搜索网页"

    async def run(self, context: dict) -> dict:
        # 直接访问 Agent Core 的 memorySystem、workspace
        return { "result": "..." }
```

Agent 自进化循环：
```
LLM 生成代码 → exec() → importlib → register_skill()
                                    ↓
Agent 调用 → 结果 → memorySystem 向量更新
       ↑                                   
└──────────── 迭代直到效果好 ──────────────
```

### 当前已实现可迁移的模块

| Node.js 模块 | Python 等价实现 | 迁移成本 |
|-------------|----------------|---------|
| sqliteStore.mjs | `sqlite3` + `numpy` | 低 |
| skillManager.mjs | `importlib` | 中（接口要重新设计）|
| mcpManager.mjs | 用 Python 重写 MCP client | 高 |
| commandRunner.mjs | `subprocess` 受控执行 | 中 |
| workspace.mjs | `pathlib` + `realpath` | 低 |

### 技术栈选择

| 组件 | 选择 | 理由 |
|------|------|------|
| 桌面壳 | Tauri 2.x | 轻量，Python 支持成熟 |
| Python | 3.11+ | asyncio + typing |
| IPC | JSON-RPC 2.0 stdin/stdout | 简单 |
| 向量检索 | `numpy` + `ml-distance` | 已在用 |
| LLM | `openai` / `anthropic` Python SDK | 官方 |
| Skill 接口 | ABC + dataclass | 类型安全 |

## 待确认问题

1. **IPC 协议**：stdin/stdout JSON-RPC 还是 WebSocket？
2. **Skill 接口**： dataclass + ABC 还是 Protocols？
3. **向量检索**：继续用 `ml-distance` 还是切 `qdrant`/`chroma`？
4. **迁移策略**：一次性重写还是渐进迁移？

## Resources

- [Tauri Python 官方支持](https://tauri.app/develop/backend/python/)
- [PyO3 文档](https://pyo3.rs/)
- 当前架构: `docs/ARCHITECTURE.md`
- 新架构设计: `docs/ARCHITECTURE_PYTHON.md`
