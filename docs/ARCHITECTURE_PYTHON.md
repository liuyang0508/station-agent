# Architecture v2: Python Agent Core

## 现状问题

当前 Node.js 架构对 Agent 自进化有根本性障碍：

```
Agent 生成 Python Skill 代码
        ↓
Node.js 写文件到磁盘（spawn write）
        ↓
每次迭代调 python3 skill.py（spawn 新进程）
        ↓
结果序列化传回 Node.js
```

- Python 代码和 Node.js Agent Runtime 之间隔了至少 2 个进程边界
- Agent 无法直接 inspect 自己生成的 Python 模块（没有 Python 内存空间）
- 动态重载 Python Skill 需要反复 fork/exec，开销大
- Python AST、importlib、exec() 全部不可用

---

## 目标架构

```
┌─────────────────────────────────────────────────────────────┐
│                    Tauri Shell (Rust)                       │
│  ├── WebView (UI)                                           │
│  ├── IPC Handler                                            │
│  └── Process Manager (启动/停止 Python Backend)               │
└─────────────────────┬───────────────────────────────────────┘
                      │  stdin/stdout JSON-RPC 或 WebSocket
                      ▼
┌─────────────────────────────────────────────────────────────┐
│              Python Agent Core                               │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ skillManager │  │ memorySystem │  │ toolGenerator│      │
│  │              │  │              │  │              │      │
│  │ importlib    │  │ SQLite       │  │ LLM → Python │      │
│  │ exec()       │  │ + 向量检索   │  │ 代码生成     │      │
│  │ reload()     │  │              │  │              │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │executionEngine│ │modelRuntime │  │ workspace    │      │
│  │              │  │              │  │              │      │
│  │ subprocess   │  │ OpenAI/      │  │ realpath     │      │
│  │ 受控执行     │  │ Anthropic    │  │ 边界校验     │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│                    Skills (Python)                          │
│                                                              │
│  skill_a.py     skill_b.py     generated_skill.py           │
│  ┌─────────┐   ┌─────────┐   ┌─────────────────┐            │
│  │def run():│   │def act():│   │def execute():   │            │
│  │  ...    │   │  ...    │   │  agent-generated│            │
│  └─────────┘   └─────────┘   └─────────────────┘            │
│                                                              │
│  Agent 可以直接 import、直接 inspect、动态 reload             │
└─────────────────────────────────────────────────────────────┘
```

---

## 模块职责

### Python Agent Core

| 模块 | 职责 | 关键 API |
|------|------|----------|
| `skillManager` | Skill 加载/卸载/重载/热更新 | `load_skill()`, `unload_skill()`, `reload_skill()`, `list_skills()` |
| `memorySystem` | 长期记忆 + 向量检索 | `store_memory()`, `search_by_vector()`, `embed()` |
| `toolGenerator` | LLM 生成 Python 工具代码 | `generate_tool(prompt) → Python code`, `validate_syntax()` |
| `executionEngine` | 受控的 Python/Script 执行 | `execute_code()`, `execute_skill()`, `kill(pid)` |
| `modelRuntime` | LLM 调用（OpenAI/Anthropic/MiniMax） | `chat()`, `embed()`, `stream()` |
| `workspace` | 工作区文件访问 + 安全边界 | `list_dir()`, `read_file()`, `validate_path()` |

### Tauri Shell

| 职责 | 说明 |
|------|------|
| UI 展示 | WebView 加载 React/Vue/HTML 页面 |
| IPC 转发 | 把 UI 请求转发给 Python Backend，结果返回 |
| 进程管理 | 启动/停止 Python 进程，处理 crash |
| 安全边界 | Rust 侧做路径验证，防止 Workspace 逃逸 |

---

## IPC 协议

### 方案 A: stdin/stdout JSON-RPC (Sidecar 模式)

```
Tauri Shell                    Python Backend
     │                               │
     │──── {"jsonrpc": "2.0", ...}──▶│
     │◀─── {"jsonrpc": "2.0", ...}────│
     │                               │
```

- 简单，调试友好
- Python 进程由 Tauri spawn，stdin/stdout 直接用

### 方案 B: WebSocket (PyO3 内存集成)

```
Tauri (Rust)  ◀── IPC ──▶  Python (embedded via PyO3)
```

- 可以暴露 Rust 对象给 Python 调用
- 但打包复杂（需要把 Python 环境和 Tauri 一起打）

**推荐方案 A（Sidecar）**，原因：
1. 调试容易（直接 `python -m agent_core` 跑起来看日志）
2. 打包简单（pip freeze + venv 打包，或 Docker）
3. 独立演进，Python Backend 可以独立更新
4. Tauri 侧无需理解 Python 内部细节

---

## Skill 接口格式

```python
# skill_xxx.py
from agent_core import Skill

class MySkill(Skill):
    name: str = "my_skill"
    description: str = "做什么的"

    def run(self, context: dict) -> dict:
        """
        Agent 调用入口
        context = { "task": "...", "memory": [...], "workspace": {...} }
        """
        return { "result": "...", "memory_updates": [...] }
```

Skill 通过 `agent_core.skillManager` 注册，Agent 可以：

```python
# 动态加载 Agent 自己生成的新 Skill
import importlib

new_skill_code = agent.generate_skill("一个自动搜索网页的工具")
exec(new_skill_code, globals())
skill_instance = globals()["GeneratedSkill"]()
skillManager.register(skill_instance)
```

---

## 数据流：Agent 自进化循环

```
1. Agent 分析任务
        ↓
2. 判断需要新工具 → toolGenerator 生成 Python 代码
        ↓
3. validate_syntax() 检查语法
        ↓
4. exec() 在内存中执行，动态加载为模块
        ↓
5. skillManager.register() 挂载到可用技能池
        ↓
6. Agent 直接调用 skill.run(context)
        ↓
7. 结果写回 memorySystem（向量更新）
        ↓
8. 如果效果不好 → 回到 step 2 迭代改进
```

整个循环全是**内存操作**，无进程创建开销。

---

## 迁移路径：渐进替换

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

**不是重写，是重新组织目录结构：**
- 保留现有架构设计和模块划分经验
- Python Agent Core 作为独立进程，通过 JSON-RPC 与 Node.js 通信
- Node.js 桌面壳逐步退位，但不是现在

---

## 技术栈

| 组件 | 选择 | 理由 |
|------|------|------|
| 桌面壳 | Tauri 2.x | 轻量，官方 Python 支持 |
| Python | 3.11+ | asyncio 支持，typing 成熟 |
| IPC | JSON-RPC 2.0 over stdin/stdout | 简单，调试友好 |
| 向量检索 | `numpy` + `ml-distance` (余弦) | 已在用，迁移成本低 |
| LLM 调用 | `openai` / `anthropic` Python SDK | 官方库，稳定 |
| Skill 接口 | ABC + dataclass | 类型安全，易inspect |
| 沙箱执行 | `subprocess` + `ResourceTracker` | 细粒度控制 |
