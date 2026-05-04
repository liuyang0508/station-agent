"""Demo skill for Station Agent."""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent / "agent_core"))

from skill_manager import Skill


class DemoSkill(Skill):
    name = "demo"
    description = "A demo skill that returns a greeting"

    def run(self, context):
        task = context.get("task", "world")
        return {
            "result": f"Hello, {task}!",
            "greeting": True,
            "memory_updates": [],
        }
