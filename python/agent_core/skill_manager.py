"""Skill dynamic loading/unloading/reloading.

Skills are Python modules that implement a standard interface.
They can be loaded from disk, reloaded at runtime, and called by the Agent.
"""

import importlib
import importlib.util
import sys
import traceback
from pathlib import Path
from typing import Any

# Skill base interface
class Skill:
    """Base class for all Skills."""
    name: str = "base_skill"
    description: str = ""

    def run(self, context: dict[str, Any]) -> dict[str, Any]:
        """Execute the skill with the given context.

        Args:
            context: Dict containing task, memory, workspace info

        Returns:
            Dict with result and optional memory_updates
        """
        raise NotImplementedError


class SkillManager:
    """Manages skill lifecycle: load, unload, reload, list."""

    def __init__(self, skills_dir: str | Path | None = None):
        """
        Args:
            skills_dir: Directory to load skills from. Defaults to ./skills
        """
        self.skills_dir = Path(skills_dir) if skills_dir else Path("./skills")
        self._loaded_skills: dict[str, type[Skill]] = {}
        self._instances: dict[str, Skill] = {}

    def load(self, path: str | Path) -> dict[str, Any]:
        """Load a skill from a Python file.

        Args:
            path: Path to the skill .py file

        Returns:
            Skill descriptor with name, description, tools
        """
        path = Path(path)
        module_name = path.stem

        # Remove if already loaded to allow reload
        if module_name in self._loaded_skills:
            self.unload({"name": module_name})

        # Add skill's parent dir to sys.path so its imports resolve
        parent_dir = str(path.parent)
        if parent_dir not in sys.path:
            sys.path.insert(0, parent_dir)

        # Load module from file
        spec = importlib.util.spec_from_file_location(module_name, path)
        if spec is None or spec.loader is None:
            raise ImportError(f"Cannot load spec from {path}")

        module = importlib.util.module_from_spec(spec)
        sys.modules[module_name] = module
        spec.loader.exec_module(module)

        # Find Skill class in module
        skill_cls = None
        for attr_name in dir(module):
            attr = getattr(module, attr_name)
            if isinstance(attr, type) and issubclass(attr, Skill) and attr is not Skill:
                skill_cls = attr
                break

        if skill_cls is None:
            raise ImportError(f"No Skill subclass found in {path}")

        # Instantiate and register
        instance = skill_cls()
        instance._path = path
        self._loaded_skills[module_name] = skill_cls
        self._instances[module_name] = instance

        return {
            "name": instance.name,
            "description": instance.description,
            "module": module_name,
            "path": str(path),
        }

    def list(self, params: dict[str, Any]) -> list[dict[str, Any]]:
        """List all loaded skills."""
        return [
            {
                "name": name,
                "description": inst.description,
                "module": module,
                "path": str(getattr(inst, "_path", "")),
            }
            for module, (name, inst) in self._enumerate()
        ]

    def unload(self, params: dict[str, Any]) -> dict[str, Any]:
        """Unload a skill by name."""
        name = params.get("name")
        if not name:
            return {"success": False, "error": "name required"}

        for module, (n, inst) in self._enumerate():
            if n == name:
                del sys.modules[module]
                del self._loaded_skills[module]
                del self._instances[module]
                return {"success": True}

        return {"success": False, "error": f"Skill not found: {name}"}

    def reload(self, params: dict[str, Any]) -> dict[str, Any]:
        """Reload a skill by name."""
        name = params.get("name")
        if not name:
            return {"success": False, "error": "name required"}

        # Find path of loaded skill
        path = None
        for module, (n, inst) in self._enumerate():
            if n == name:
                path = getattr(inst, "_path", None)
                break

        if path is None:
            return {"success": False, "error": f"Skill not found: {name}"}

        self.unload({"name": name})
        return self.load(Path(path))

    def run(self, params: dict[str, Any]) -> dict[str, Any]:
        """Run a skill by name with context."""
        name = params.get("name")
        context = params.get("context", {})

        if not name:
            return {"success": False, "error": "name required"}

        for module, (n, inst) in self._enumerate():
            if n == name:
                try:
                    result = inst.run(context)
                    return {"success": True, "result": result}
                except Exception:
                    return {"success": False, "error": traceback.format_exc()}

        return {"success": False, "error": f"Skill not found: {name}"}

    def _enumerate(self):
        for module, cls in self._loaded_skills.items():
            inst = self._instances.get(module)
            if inst:
                yield module, (inst.name, inst)


# Module-level singleton for IPC
_skill_manager = SkillManager()


def get_skill_manager() -> SkillManager:
    return _skill_manager
