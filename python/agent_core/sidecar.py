"""Python Agent Core sidecar manager.

Spawns and communicates with the Python Agent Core sidecar process
via stdin/stdout JSON-RPC.
"""

import subprocess
import json
import os
import logging
from pathlib import Path
from typing import Any

log = logging.getLogger("python_sidecar")


class PythonSidecar:
    """Manages the Python Agent Core sidecar process."""

    def __init__(self, python_path: str | Path | None = None):
        """
        Args:
            python_path: Path to python3 binary. Defaults to searching PATH.
        """
        self.python_path = python_path or self._find_python()
        self._proc: subprocess.Popen | None = None
        self._request_id = 0

    def _find_python(self) -> str:
        for cmd in ["python3", "python"]:
            try:
                subprocess.run([cmd, "--version"], capture_output=True, check=True)
                return cmd
            except (subprocess.CalledProcessError, FileNotFoundError):
                continue
        raise RuntimeError("python3 not found in PATH")

    def start(self) -> None:
        """Start the Python sidecar process."""
        if self._proc is not None:
            return

        agent_core_path = Path(__file__).parent / "agent_core" / "main.py"

        self._proc = subprocess.Popen(
            [str(self.python_path), str(agent_core_path)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env={**os.environ, "PYTHONUNBUFFERED": "1"},
        )
        log.info("Python sidecar started (pid=%d)", self._proc.pid)

    def stop(self) -> None:
        """Stop the Python sidecar process."""
        if self._proc is None:
            return

        self._proc.terminate()
        try:
            self._proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self._proc.kill()
        self._proc = None
        log.info("Python sidecar stopped")

    def _send(self, method: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        """Send a JSON-RPC request and wait for a response."""
        if self._proc is None:
            raise RuntimeError("Sidecar not started")

        self._request_id += 1
        request = {
            "jsonrpc": "2.0",
            "id": self._request_id,
            "method": method,
            "params": params or {},
        }

        request_str = json.dumps(request) + "\n"
        self._proc.stdin.write(request_str.encode("utf-8"))
        self._proc.stdin.flush()

        response_line = self._proc.stdout.readline()
        if not response_line:
            raise RuntimeError("Sidecar process terminated unexpectedly")

        return json.loads(response_line.decode("utf-8"))

    # ─── Skill API ────────────────────────────────────────────────

    def skill_load(self, path: str) -> dict[str, Any]:
        return self._send("skill.load", {"path": path})

    def skill_list(self) -> list[dict[str, Any]]:
        result = self._send("skill.list")
        return result.get("result", [])

    def skill_unload(self, name: str) -> dict[str, Any]:
        return self._send("skill.unload", {"name": name})

    def skill_reload(self, name: str) -> dict[str, Any]:
        return self._send("skill.reload", {"name": name})

    def skill_run(self, name: str, context: dict[str, Any]) -> dict[str, Any]:
        return self._send("skill.run", {"name": name, "context": context})

    # ─── Memory API ────────────────────────────────────────────────

    def memory_store(self, content: str, metadata: dict | None = None, embedding: list | None = None) -> dict[str, Any]:
        return self._send("memory.store", {
            "content": content,
            "metadata": metadata or {},
            "embedding": embedding,
        })

    def memory_search(self, embedding: list[float], limit: int = 5) -> dict[str, Any]:
        return self._send("memory.search", {"embedding": embedding, "limit": limit})

    def memory_list(self, limit: int = 20) -> dict[str, Any]:
        return self._send("memory.list", {"limit": limit})

    def memory_delete(self, memory_id: str) -> dict[str, Any]:
        return self._send("memory.delete", {"id": memory_id})

    # ─── Exec API ─────────────────────────────────────────────────

    def exec_run(self, code: str, cwd: str | None = None, timeout: int = 30) -> dict[str, Any]:
        return self._send("exec.run", {"code": code, "cwd": cwd, "timeout": timeout})

    def exec_kill(self, run_id: str) -> dict[str, Any]:
        return self._send("exec.kill", {"run_id": run_id})
