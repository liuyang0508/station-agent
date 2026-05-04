"""Memory summary skill - summarizes and extracts key info from stored memories."""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent / "agent_core"))

from skill_manager import Skill
from memory import MemorySystem


class MemorySummarySkill(Skill):
    name = "memory_summary"
    description = "List and summarize recent memories from the vector store."

    def run(self, context: dict) -> dict:
        limit = context.get("limit", 10)
        keyword = context.get("keyword", "")

        try:
            mem = MemorySystem()
            all_memories = mem.list_memories({"limit": 100})

            if not all_memories or "memories" not in all_memories:
                return {"success": True, "count": 0, "memories": []}

            memories = all_memories["memories"]

            # Filter by keyword if provided
            if keyword:
                keyword = keyword.lower()
                memories = [m for m in memories if keyword in m.get("content", "").lower()]

            # Limit results
            memories = memories[:limit]

            summaries = []
            for m in memories:
                content = m.get("content", "")[:200]
                summaries.append({
                    "id": m.get("id", ""),
                    "preview": content,
                    "tags": m.get("metadata", {}).get("tags", []),
                    "source": m.get("metadata", {}).get("source", "unknown")
                })

            return {
                "success": True,
                "count": len(summaries),
                "keyword": keyword or None,
                "memories": summaries
            }
        except Exception as e:
            return {"success": False, "error": str(e)}
