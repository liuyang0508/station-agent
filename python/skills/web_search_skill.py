"""Web search skill - searches the web for information."""

import json
import urllib.request
import urllib.parse
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent / "agent_core"))

from skill_manager import Skill


class WebSearchSkill(Skill):
    name = "web_search"
    description = "Search the web for information. Returns titles and snippets."

    def run(self, context: dict) -> dict:
        query = context.get("query", "")
        if not query:
            return {"error": "query is required in context"}

        try:
            encoded = urllib.parse.quote_plus(query)
            url = f"https://ddg-api.herokuapp.com/search?q={encoded}&nb=5"
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode())

            results = [
                {"title": r.get("title", ""), "url": r.get("url", ""), "snippet": r.get("description", "")}
                for r in data[:5]
            ]
            return {"success": True, "query": query, "results": results, "count": len(results)}
        except Exception as e:
            return {"success": False, "error": str(e)}
