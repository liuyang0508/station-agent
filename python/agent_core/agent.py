"""Main Python Agent class integrating all components."""

from typing import Any, AsyncIterator

from memory import MemorySystem
from state import AgentState
from tools import ToolRegistry, SandboxedExecutor

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
