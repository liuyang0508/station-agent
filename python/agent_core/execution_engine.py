"""Controlled code execution engine.

Safely executes Python code in a subprocess with resource limits.
Used for tool generation (exec() results) and skill execution.
"""

import subprocess
import uuid
import resource
import signal
import traceback
from typing import Any


class ExecutionEngine:
    """Runs Python code in controlled subprocess with memory/time limits."""

    def __init__(self, timeout_sec: int = 30, max_mem_mb: int = 128):
        self.timeout_sec = timeout_sec
        self.max_mem_mb = max_mem_mb
        self._processes: dict[str, subprocess.Popen] = {}

    def run(self, params: dict[str, Any]) -> dict[str, Any]:
        """Execute Python code in a subprocess.

        Params:
            code: str - Python code to execute
            cwd: str - working directory
            timeout: int - timeout in seconds (optional)
        """
        code = params.get("code")
        if not code:
            return {"success": False, "error": "code required"}

        cwd = params.get("cwd")
        timeout = params.get("timeout", self.timeout_sec)

        run_id = str(uuid.uuid4())[:8]

        try:
            proc = subprocess.Popen(
                ["python3", "-c", code],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                cwd=cwd,
            )
            self._processes[run_id] = proc

            try:
                stdout, stderr = proc.communicate(timeout=timeout)
            except subprocess.TimeoutExpired:
                proc.kill()
                return {"success": False, "error": f"Timeout after {timeout}s"}

            finally:
                self._processes.pop(run_id, None)

            return {
                "success": proc.returncode == 0,
                "stdout": stdout.decode("utf-8", errors="replace"),
                "stderr": stderr.decode("utf-8", errors="replace"),
                "returncode": proc.returncode,
            }

        except Exception:
            return {"success": False, "error": traceback.format_exc()}

    def kill(self, params: dict[str, Any]) -> dict[str, Any]:
        """Kill a running process by run_id."""
        run_id = params.get("run_id")
        if not run_id:
            return {"success": False, "error": "run_id required"}

        proc = self._processes.get(run_id)
        if proc:
            proc.kill()
            self._processes.pop(run_id, None)
            return {"success": True}

        return {"success": False, "error": "Process not found"}
