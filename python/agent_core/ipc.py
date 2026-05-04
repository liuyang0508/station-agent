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