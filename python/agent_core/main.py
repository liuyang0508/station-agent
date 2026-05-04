#!/usr/bin/env python3
"""Python Agent Core sidecar entry point.

Reads JSON-RPC requests from stdin, writes responses to stdout.
"""

import sys
from pathlib import Path

# Add python/ to path so agent_core can be imported as a package
sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent / "python"))

import json
import logging

from protocol import JSONRPCProtocol
from skill_manager import get_skill_manager
from memory import MemorySystem
from execution_engine import ExecutionEngine

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("agent_core")


def main():
    protocol = JSONRPCProtocol()
    skill_mgr = get_skill_manager()

    # Register skill.* methods
    def wrap(fn):
        def inner(params):
            return fn(params)
        return inner

    protocol.register("skill.load", lambda p: skill_mgr.load(p.get("path")))
    protocol.register("skill.list", lambda p: skill_mgr.list(p))
    protocol.register("skill.unload", lambda p: skill_mgr.unload(p))
    protocol.register("skill.reload", lambda p: skill_mgr.reload(p))
    protocol.register("skill.run", lambda p: skill_mgr.run(p))

    # Register memory.* methods
    memory = MemorySystem()
    protocol.register("memory.store", lambda p: memory.store(p))
    protocol.register("memory.search", lambda p: memory.search(p))
    protocol.register("memory.list", lambda p: memory.list_memories(p))
    protocol.register("memory.delete", lambda p: memory.delete(p))

    # Register exec.* methods
    engine = ExecutionEngine()
    protocol.register("exec.run", lambda p: engine.run(p))
    protocol.register("exec.kill", lambda p: engine.kill(p))

    log.info("Python Agent Core ready")

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            request = json.loads(line)
            response = protocol.handle(request)
            if response:
                print(json.dumps(response), flush=True)
        except json.JSONDecodeError:
            log.error("Invalid JSON: %s", line)
        except Exception:
            log.exception("Error handling request")


if __name__ == "__main__":
    main()
