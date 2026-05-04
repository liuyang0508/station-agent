"""JSON-RPC 2.0 protocol processor for stdin/stdout IPC."""

import json
from typing import Any, Callable


class JSONRPCProtocol:
    """Handles JSON-RPC 2.0 requests/responses over text lines."""

    def __init__(self):
        self.handlers: dict[str, Callable] = {}

    def register(self, method: str, handler: Callable) -> None:
        """Register a method handler.

        Handler signature: def handler(params: dict) -> Any
        """
        self.handlers[method] = handler

    def handle(self, request: dict[str, Any]) -> dict[str, Any] | None:
        """Process a JSON-RPC request and return a response."""
        if request.get("jsonrpc") != "2.0":
            return self._error(None, -32600, "Invalid JSON-RPC version")

        method = request.get("method")
        params = request.get("params", {})
        id_ = request.get("id")

        if method not in self.handlers:
            return self._error(id_, -32601, f"Method not found: {method}")

        try:
            result = self.handlers[method](params)
            return self._response(id_, result)
        except Exception as e:
            return self._error(id_, -32603, str(e))

    def _response(self, id_: Any, result: Any) -> dict[str, Any]:
        return {"jsonrpc": "2.0", "id": id_, "result": result}

    def _error(self, id_: Any, code: int, message: str) -> dict[str, Any]:
        return {"jsonrpc": "2.0", "id": id_, "error": {"code": code, "message": message}}
