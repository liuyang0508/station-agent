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