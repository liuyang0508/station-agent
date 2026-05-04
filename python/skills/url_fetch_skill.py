"""URL content fetcher - extracts text from web pages."""

import urllib.request
import re
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent / "agent_core"))

from skill_manager import Skill


class UrlFetchSkill(Skill):
    name = "url_fetch"
    description = "Fetch and extract readable text content from a URL."

    def run(self, context: dict) -> dict:
        url = context.get("url", "")
        if not url:
            return {"error": "url is required in context"}

        try:
            req = urllib.request.Request(
                url,
                headers={"User-Agent": "Mozilla/5.0 (compatible; StationAgent/1.0)"}
            )
            with urllib.request.urlopen(req, timeout=15) as resp:
                html = resp.read().decode("utf-8", errors="ignore")

            # Remove scripts, styles, nav
            for tag in ["script", "style", "nav", "header", "footer", "aside"]:
                html = re.sub(f"<{tag}[^>]*>.*?</{tag}>", "", html, flags=re.DOTALL | re.IGNORECASE)

            # Extract text
            text = re.sub(r"<[^>]+>", " ", html)
            text = re.sub(r"\s+", " ", text).strip()

            return {
                "success": True,
                "url": url,
                "title": self._extract_title(html),
                "text": text[:3000],
                "word_count": len(text.split())
            }
        except Exception as e:
            return {"success": False, "error": str(e)}

    def _extract_title(self, html: str) -> str:
        m = re.search(r"<title[^>]*>([^<]+)</title>", html, re.IGNORECASE)
        return m.group(1).strip() if m else ""
