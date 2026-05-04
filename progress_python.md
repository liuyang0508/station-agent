# Progress: Python Agent Core 迁移

## Session: 2026-05-04

### Phase 2: Python Agent Core 基础设施
- **Status:** complete
- **Date:** 2026-05-04

Actions taken:
- 创建 `python/agent_core/` 目录结构
- 实现 JSON-RPC protocol.py（stdin/stdout IPC）
- 实现 skill_manager.py（动态加载/卸载/重载，importlib）
- 实现 memory.py（SQLite + 向量检索）
- 实现 execution_engine.py（受控 subprocess 执行）
- 实现 main.py（sidecar 入口，聚合所有模块）
- 实现 sidecar.py（Node.js 调 Python 的进程管理器）
- 修复 Python 3.14 `importlib.util` 延迟导入问题（需显式 `import importlib.util`）
- 用 venv 隔离环境验证 Python Agent Core（Python 3.14.4）
- 验证：skill.load / list / run / reload ✓
- 验证：memory.store / list ✓
- 验证：exec.run ✓
- 验证：Node.js 进程调用 Python sidecar ✓

Files created:
- `python/agent_core/__init__.py`
- `python/agent_core/protocol.py` — JSON-RPC 2.0 处理器
- `python/agent_core/skill_manager.py` — Skill 生命周期管理
- `python/agent_core/memory.py` — SQLite + 向量存储
- `python/agent_core/execution_engine.py` — 受控代码执行
- `python/agent_core/main.py` — sidecar 入口
- `python/agent_core/sidecar.py` — Node.js 进程管理器
- `python/skills/demo_skill.py` — 示例 Skill
- `src/lib/pythonSidecar.mjs` — Node.js 封装层
- `docs/ARCHITECTURE_PYTHON.md` — 目标架构
- `findings_python.md` — 技术分析
- `task_plan_python.md` — 迁移计划
- `progress_python.md` — 进展记录

Next steps:
- Phase 3: 修复 server.mjs ESM 预存 bug（Node.js v25.9.0 兼容性问题）
- Phase 4: toolGenerator（LLM → Python 代码）
