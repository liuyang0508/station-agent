# Python Agent 生产级集成实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Python Agent 从原型提升到生产级，作为 station-agent 的核心推理引擎，支持流式输出、多模态输入、工具调用和长期记忆。

**Architecture:** 在 src/runtime/ 下新增 pythonBridge.mjs 作为 JS-Python IPC 桥接。Python 端扩展 python/agent_core/ 增加 JSON-RPC 协议处理、工具注册表和流式输出。

**Tech Stack:** Node.js child_process, JSON-RPC 2.0, Python subprocess, SSE

---

## File Structure

```
src/runtime/
├── pythonBridge.mjs           # 新建: JS-Python IPC 桥接
python/agent_core/
├── ipc.py                     # 新建: JSON-RPC 服务端
├── tools.py                   # 新建: 工具注册与执行
├── streaming.py               # 新建: 流式输出支持
├── state.py                   # 新建: Agent 状态管理
├── sandbox.py                 # 新建: 工具沙箱
src/server.mjs                 # 修改: 集成 Python Agent
```

---

## Task 1: 创建 Python IPC 服务端

**Files:**
- Create: `python/agent_core/ipc.py`

- [ ] **Step 1: 创建 ipc.py**

```python
"""JSON-RPC over stdin/stdout IPC server for Python Agent."""

import json
import sys
from typing import Any, Callable

class IPCServer:
    """Handles JSON-RPC requests from parent JS process."""

    def __init__(self, agent: Any):
        self.agent = agent
        self.handlers = {
            'run': self._handle_run,
            'run_streaming': self._handle_run_streaming,
            'tool_call': self._handle_tool_call,
            'memory_store': self._handle_memory_store,
            'memory_search': self._handle_memory_search,
        }

    def _handle_run(self, params: dict) -> dict:
        """Synchronous execution."""
        return self.agent.run(**params)

    def _handle_run_streaming(self, params: dict) -> dict:
        """Streaming execution - returns chunks."""
        chunks = list(self.agent.run_streaming(**params))
        return {'chunks': chunks}

    def _handle_tool_call(self, params: dict) -> dict:
        """Execute a tool call."""
        return self.agent.execute_tool(params.get('name'), params.get('args', {}))

    def _handle_memory_store(self, params: dict) -> dict:
        """Store a memory."""
        return self.agent.memory.store(params)

    def _handle_memory_search(self, params: dict) -> dict:
        """Search memories."""
        return self.agent.memory.search(params)

    def handle_request(self, request: dict) -> dict:
        """Process a single JSON-RPC request."""
        method = request.get('method')
        params = request.get('params', {})
        id = request.get('id')

        try:
            if method in self.handlers:
                result = self.handlers[method](params)
                return {'id': id, 'result': result}
            else:
                return {'id': id, 'error': f'Unknown method: {method}'}
        except Exception as e:
            return {'id': id, 'error': str(e)}

    def run_loop(self):
        """Main IPC loop - read JSON-RPC from stdin, write to stdout."""
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                request = json.loads(line)
                response = self.handle_request(request)
                print(json.dumps(response), flush=True)
            except json.JSONDecodeError as e:
                error = {'id': None, 'error': f'Invalid JSON: {e}'}
                print(json.dumps(error), flush=True)


if __name__ == '__main__':
    # Import and create agent
    from agent import Agent
    agent = Agent()
    ipc = IPCServer(agent)
    ipc.run_loop()
```

- [ ] **Step 2: 提交**

```bash
git add python/agent_core/ipc.py
git commit -m "feat(python): add JSON-RPC IPC server for JS-Python communication"
```

---

## Task 2: 创建 Python Agent 工具注册表

**Files:**
- Create: `python/agent_core/tools.py`

- [ ] **Step 1: 创建 tools.py**

```python
"""Tool registry and sandboxed execution for Python Agent."""

import time
from typing import Any, Callable

class ToolRegistry:
    """Registry for available agent tools."""

    def __init__(self):
        self._tools: dict[str, Callable] = {}

    def register(self, name: str, handler: Callable, description: str = ''):
        """Register a tool."""
        self._tools[name] = handler
        setattr(handler, '_tool_name', name)
        setattr(handler, '_tool_description', description)

    def list_tools(self) -> list[dict]:
        """List all registered tools."""
        return [
            {
                'name': name,
                'description': getattr(func, '_tool_description', '')
            }
            for name, func in self._tools.items()
        ]

    def execute(self, tool_call: dict) -> dict:
        """Execute a tool call."""
        tool_name = tool_call.get('name')
        args = tool_call.get('arguments', {})

        if tool_name not in self._tools:
            return {'success': False, 'error': f'Unknown tool: {tool_name}'}

        try:
            result = self._tools[tool_name](**args)
            return {'success': True, 'result': result}
        except Exception as e:
            return {'success': False, 'error': str(e)}


class SandboxedExecutor:
    """Executes Python code in a restricted environment."""

    def __init__(self, timeout_ms: int = 30000):
        self.timeout_ms = timeout_ms
        self._forbidden = [
            'import os', 'import sys', 'import subprocess',
            'import socket', 'eval', 'exec', '__import__',
            'open(', 'file(', 'input('
        ]

    def validate(self, code: str) -> tuple[bool, str]:
        """Validate code before execution."""
        for f in self._forbidden:
            if f in code:
                return False, f'Forbidden pattern: {f}'
        return True, ''

    def execute(self, code: str, context: dict = None) -> dict:
        """Execute code in sandbox."""
        valid, error = self.validate(code)
        if not valid:
            return {'success': False, 'error': error}

        context = context or {}
        try:
            # Setup safe globals
            safe_globals = {
                'print': lambda *args: None,  # Capture but don't print
                '__builtins__': {}
            }
            exec(code, safe_globals, context)
            return {'success': True, 'result': context.get('result')}
        except Exception as e:
            return {'success': False, 'error': str(e)}
```

- [ ] **Step 2: 提交**

```bash
git add python/agent_core/tools.py
git commit -m "feat(python): add tool registry and sandboxed executor"
```

---

## Task 3: 创建 Python Agent 状态管理

**Files:**
- Create: `python/agent_core/state.py`

- [ ] **Step 1: 创建 state.py**

```python
"""State management for Python Agent conversations."""

import time
from typing import Any

class AgentState:
    """Manages conversation state and context windows."""

    def __init__(self, max_tokens: int = 60000):
        self.max_tokens = max_tokens
        self.conversations: dict[str, list[dict]] = {}
        self.context_windows: dict[str, list[dict]] = {}

    def add_message(self, conversation_id: str, role: str, content: str, metadata: dict = None):
        """Add a message to a conversation."""
        if conversation_id not in self.conversations:
            self.conversations[conversation_id] = []

        message = {
            'role': role,
            'content': content,
            'timestamp': time.time(),
            'metadata': metadata or {}
        }
        self.conversations[conversation_id].append(message)

    def get_context(self, conversation_id: str, max_messages: int = 40) -> list[dict]:
        """Get trimmed context window for a conversation."""
        if conversation_id not in self.conversations:
            return []

        messages = self.conversations[conversation_id]

        # Simple token estimation (4 chars per token)
        total_tokens = sum(len(m['content']) / 4 for m in messages)

        if total_tokens <= self.max_tokens and len(messages) <= max_messages:
            return messages

        # Trim from oldest messages
        trimmed = messages[-max_messages:]
        while sum(len(m['content']) / 4 for m in trimmed) > self.max_tokens and len(trimmed) > 1:
            trimmed = trimmed[1:]

        return trimmed

    def list_conversations(self) -> list[str]:
        """List all conversation IDs."""
        return list(self.conversations.keys())

    def get_conversation_summary(self, conversation_id: str) -> dict:
        """Get summary of a conversation."""
        messages = self.conversations.get(conversation_id, [])
        return {
            'id': conversation_id,
            'message_count': len(messages),
            'first_message': messages[0] if messages else None,
            'last_message': messages[-1] if messages else None
        }
```

- [ ] **Step 2: 提交**

```bash
git add python/agent_core/state.py
git commit -m "feat(python): add agent state management module"
```

---

## Task 4: 创建 JS Python Bridge

**Files:**
- Create: `src/runtime/pythonBridge.mjs`

- [ ] **Step 1: 创建 pythonBridge.mjs**

```javascript
/**
 * Python Agent Bridge - IPC between JS and Python Agent
 */

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

export class PythonBridge {
  constructor({ pythonPath = 'python3', scriptPath = './python/agent_core/ipc.py', timeoutMs = 60000 } = {}) {
    this.pythonPath = pythonPath;
    this.scriptPath = scriptPath;
    this.timeoutMs = timeoutMs;
    this._process = null;
    this._pending = new Map();
    this._idCounter = 0;
  }

  _ensureProcess() {
    if (!this._process) {
      this._process = spawn(this.pythonPath, [this.scriptPath], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      this._process.stdout.on('data', (chunk) => {
        const lines = chunk.toString().split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            const response = JSON.parse(line);
            const pending = this._pending.get(response.id);
            if (pending) {
              this._pending.delete(response.id);
              if (response.error) {
                pending.reject(new Error(response.error));
              } else {
                pending.resolve(response.result);
              }
            }
          } catch (e) {
            // Ignore parse errors
          }
        }
      });

      this._process.stderr.on('data', (chunk) => {
        console.error('[PythonBridge stderr]', chunk.toString());
      });

      this._process.on('error', (err) => {
        console.error('[PythonBridge process error]', err);
        this._process = null;
      });

      this._process.on('close', (code) => {
        console.log('[PythonBridge exited with code]', code);
        this._process = null;
      });
    }
    return this._process;
  }

  async _send(method, params = {}) {
    const id = ++this._idCounter;
    const request = { jsonrpc: '2.0', id, method, params };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`Request ${method} timed out`));
      }, this.timeoutMs);

      this._pending.set(id, { resolve, reject, timeout });

      this._ensureProcess();
      this._process.stdin.write(JSON.stringify(request) + '\n');
    });
  }

  async run(input, context = {}) {
    return this._send('run', { input, context });
  }

  async *runStreaming(input, context = {}) {
    const result = await this._send('run_streaming', { input, context });
    for (const chunk of result.chunks || []) {
      yield chunk;
    }
  }

  async executeTool(name, args = {}) {
    return this._send('tool_call', { name, args });
  }

  async storeMemory(params) {
    return this._send('memory_store', params);
  }

  async searchMemory(params) {
    return this._send('memory_search', params);
  }

  destroy() {
    if (this._process) {
      this._process.stdin.end();
      this._process.kill();
      this._process = null;
    }
  }
}
```

- [ ] **Step 2: 提交**

```bash
git add src/runtime/pythonBridge.mjs
git commit -m "feat(runtime): add Python Agent bridge for JS-Python IPC"
```

---

## Task 5: 集成到 server.mjs

**Files:**
- Modify: `src/server.mjs`

- [ ] **Step 1: 添加 Python Agent 运行时配置**

在 settings 配置中添加：

```javascript
pythonAgent: {
  enabled: true,
  pythonPath: 'python3',
  scriptPath: './python/agent_core/ipc.py',
  timeout: 60000
}
```

- [ ] **Step 2: 添加 Python Agent 执行端点**

```javascript
import { PythonBridge } from './runtime/pythonBridge.mjs';

const pythonBridge = new PythonBridge({
  pythonPath: settings.pythonAgent?.pythonPath || 'python3',
  scriptPath: settings.pythonAgent?.scriptPath || './python/agent_core/ipc.py',
  timeoutMs: settings.pythonAgent?.timeout || 60000
});

// POST /api/agent/run - Execute with Python Agent
app.post('/api/agent/run', async (req, res) => {
  try {
    const { input, context } = req.body;
    const result = await pythonBridge.run(input, context);
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/agent/stream - Streaming execution (SSE)
app.get('/api/agent/stream', async (req, res) => {
  const { input, context } = req.query;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    for await (const chunk of pythonBridge.runStreaming(input, { context })) {
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    }
  } catch (error) {
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
  }
  res.end();
});
```

- [ ] **Step 3: 提交**

```bash
git add src/server.mjs
git commit -m "feat(server): integrate Python Agent bridge with run and stream endpoints"
```

---

## Task 6: 扩展 Python Agent 主模块

**Files:**
- Modify: `python/agent_core/agent.py` (假设已存在，或新建)

- [ ] **Step 1: 创建/更新 agent.py**

```python
"""Main Python Agent class integrating all components."""

from typing import Any, AsyncIterator

from memory import MemorySystem
from state import AgentState
from tools import ToolRegistry, SandboxedExecutor
from streaming import StreamingOutput

class Agent:
    """Main agent class coordinating memory, tools, and execution."""

    def __init__(self, db_path: str = None):
        self.memory = MemorySystem(db_path)
        self.state = AgentState()
        self.tools = ToolRegistry()
        self.sandbox = SandboxedExecutor()
        self._register_default_tools()

    def _register_default_tools(self):
        """Register built-in tools."""
        self.tools.register('sandbox_execute', self._tool_sandbox_execute, 'Execute Python code in sandbox')
        self.tools.register('search_memory', self._tool_search_memory, 'Search agent memory')
        self.tools.register('store_memory', self._tool_store_memory, 'Store to agent memory')

    def _tool_sandbox_execute(self, code: str, context: dict = None) -> dict:
        """Tool: Execute code in sandbox."""
        return self.sandbox.execute(code, context)

    def _tool_search_memory(self, query: str, limit: int = 5) -> dict:
        """Tool: Search memory."""
        embedding = self.memory._generate_embedding(query)
        return self.memory.search({'embedding': embedding, 'limit': limit})

    def _tool_store_memory(self, content: str, metadata: dict = None) -> dict:
        """Tool: Store a memory."""
        return self.memory.store({'content': content, 'metadata': metadata or {}})

    def run(self, input: str, context: dict = None) -> dict:
        """Synchronous run."""
        # Add to state
        conv_id = context.get('conversation_id', 'default') if context else 'default'
        self.state.add_message(conv_id, 'user', input)

        # Get context
        messages = self.state.get_context(conv_id)

        # Build prompt and execute
        response = self._generate_response(messages)

        # Store response
        self.state.add_message(conv_id, 'assistant', response)

        return {
            'response': response,
            'conversation_id': conv_id
        }

    def run_streaming(self, input: str, context: dict = None) -> AsyncIterator[dict]:
        """Streaming run."""
        result = self.run(input, context)
        yield {'type': 'final', 'content': result['response']}

    def _generate_response(self, messages: list[dict]) -> str:
        """Generate response - placeholder for LLM integration."""
        return "Python Agent response (integrate LLM here)"

    def execute_tool(self, name: str, args: dict) -> dict:
        """Execute a registered tool."""
        return self.tools.execute({'name': name, 'arguments': args})
```

- [ ] **Step 2: 提交**

```bash
git add python/agent_core/agent.py
git commit -m "feat(python): create main Agent class integrating all components"
```