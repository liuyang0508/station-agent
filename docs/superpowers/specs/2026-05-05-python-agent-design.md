# Python Agent Production-Grade Integration Design

**Date:** 2026-05-05
**Status:** Approved

## Overview

将 Python Agent 从原型提升到生产级质量，作为 station-agent 的核心推理引擎，支持流式输出、多模态输入、长期记忆和工具调用。

---

## 1. Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    station-agent                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │
│  │  JS Runtime │  │   Python    │  │   Skill System  │  │
│  │  (server)   │◄─►│   Agent     │◄─►│  (skillManager) │  │
│  └─────────────┘  └─────────────┘  └─────────────────┘  │
│         ▲                │                    ▲           │
│         │                ▼                    │           │
│  ┌─────────────┐  ┌─────────────┐           │           │
│  │  WebView    │  │   SQLite    │           │           │
│  │  (macOS)    │  │  (store)    │◄──────────┘           │
│  └─────────────┘  └─────────────┘                      │
└─────────────────────────────────────────────────────────┘
```

## 2. Core Features

### 2.1 Streaming Response

```javascript
// server.mjs - SSE endpoint
app.get('/api/agent/stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  const result = await pythonAgent.run({
    input: req.query.input,
    stream: true,
    onChunk: (chunk) => {
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    }
  });
  res.end();
});
```

### 2.2 Multi-Modal Input

```python
# python/agent_core/vision.py
class VisionProcessor:
    def process_screenshot(self, image_path: str) -> str:
        # 使用 GUI-Owl 1.5 处理截图
        pass

    def process_frame(self, frame_data: bytes) -> dict:
        # 处理实时帧
        pass
```

### 2.3 Tool Calling Protocol

```python
# python/agent_core/tools.py
class ToolRegistry:
    def register(self, name: str, handler: callable):
        self._tools[name] = handler

    def execute(self, tool_call: dict) -> dict:
        tool_name = tool_call['name']
        args = tool_call['arguments']
        return self._tools[tool_name](**args)
```

### 2.4 Memory Integration

```python
# python/agent_core/memory.py
class AgentMemory:
    def __init__(self, db_path: str):
        self.store = SQLiteMemoryStore(db_path)

    def store_interaction(self, input_text: str, output_text: str, metadata: dict):
        # 存储到 SQLite
        pass

    def retrieve_context(self, query: str, limit: int = 5) -> list:
        # 向量检索
        pass
```

## 3. IPC Communication

### 3.1 JSON-RPC over stdin/stdout

```python
# python/agent_core/ipc.py
import json
import sys

class IPCServer:
    def __init__(self, agent):
        self.agent = agent

    def handle_request(self, request: dict) -> dict:
        method = request.get('method')
        params = request.get('params', {})
        id = request.get('id')

        if method == 'run':
            result = self.agent.run(**params)
            return {'id': id, 'result': result}
        elif method == 'stream':
            result = self.agent.run_streaming(**params)
            return {'id': id, 'result': list(result)}

        return {'id': id, 'error': 'Unknown method'}

    def run_loop(self):
        for line in sys.stdin:
            request = json.loads(line)
            response = self.handle_request(request)
            print(json.dumps(response), flush=True)
```

### 3.2 Message Types

| Type | Direction | Description |
|------|-----------|-------------|
| `run` | JS → Python | 同步执行 |
| `run_streaming` | JS → Python | 流式执行 |
| `tool_call` | Python → JS | 请求执行工具 |
| `tool_result` | JS → Python | 工具执行结果 |
| `memory_query` | Python → JS | 查询记忆 |
| `memory_store` | JS → Python | 存储记忆 |

## 4. Sandbox Integration

### 4.1 Python Sandbox

```javascript
// src/runtime/sandboxExecutor.mjs
export class PythonSandbox {
  async run(code, context = {}) {
    // 使用 spawn 运行 Python
    // 传入 context 作为环境变量
  }
}
```

### 4.2 Tool Sandboxing

```python
# python/agent_core/sandbox.py
class SandboxedTool:
    def __init__(self, timeout_ms: int = 30000):
        self.timeout_ms = timeout_ms

    def execute(self, code: str, context: dict) -> dict:
        # 在受控环境中执行
        pass

    def validate_code(self, code: str) -> bool:
        # 安全检查
        forbidden = ['import os', 'import sys', 'subprocess', 'eval', 'exec']
        return not any(f in code for f in forbidden)
```

## 5. State Management

```python
# python/agent_core/state.py
class AgentState:
    def __init__(self):
        self.conversations = {}  # conversation_id -> messages
        self.active_tools = {}   # tool_id -> tool_instance
        self.context_windows = {}  # conversation_id -> context_window

    def add_message(self, conversation_id: str, role: str, content: str):
        if conversation_id not in self.conversations:
            self.conversations[conversation_id] = []
        self.conversations[conversation_id].append({
            'role': role,
            'content': content,
            'timestamp': time.time()
        })

    def get_context(self, conversation_id: str, max_tokens: int = 60000) -> list:
        messages = self.conversations.get(conversation_id, [])
        return self._trim_context(messages, max_tokens)
```

## 6. Error Handling

| Error Type | Handling Strategy |
|------------|------------------|
| Tool timeout | 返回超时错误，包含部分结果 |
| Invalid tool call | 返回验证错误，附错误详情 |
| Memory full | LRU 淘汰旧记忆 |
| Model error | 重试 3 次，指数退避 |
| IPC disconnect | 自动重连，状态恢复 |

## 7. Implementation

### 7.1 New Python Package Structure

```
python/agent_core/
├── __init__.py
├── agent.py           # 主 Agent 类
├── ipc.py             # JSON-RPC 通信
├── tools.py           # 工具注册与执行
├── memory.py          # 记忆系统（已有）
├── vision.py          # 多模态处理
├── state.py           # 状态管理
├── sandbox.py         # 安全沙箱
└── streaming.py      # 流式输出
```

### 7.2 Server Integration

```javascript
// src/server.mjs
import { spawn } from 'node:child_process';
import { PythonAgentBridge } from './runtime/pythonBridge.mjs';

const pythonAgent = new PythonAgentBridge({
  pythonPath: 'python3',
  scriptPath: './python/agent_core/ipc.py'
});

app.post('/api/agent/run', async (req, res) => {
  const result = await pythonAgent.run(req.body.input, {
    context: req.body.context
  });
  res.json(result);
});
```

## 8. Configuration

```javascript
{
  pythonAgent: {
    enabled: true,
    pythonPath: 'python3',
    scriptPath: './python/agent_core/ipc.py',
    timeout: 60000,
    maxRetries: 3,
    streaming: true
  }
}
```

## 9. Key Constraints

1. **隔离性** — Python Agent 崩溃不影响 JS Runtime
2. **流式输出** — 支持 Server-Sent Events
3. **工具安全** — 所有工具调用经过沙箱验证
4. **状态持久化** — 对话状态存入 SQLite
5. **向后兼容** — 保持现有 JS Runtime 作为备选