"""Code analysis skill - analyzes code files for complexity, issues, and structure."""

import re
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent / "agent_core"))

from skill_manager import Skill


class CodeAnalysisSkill(Skill):
    name = "code_analysis"
    description = "Analyze a code file: line count, function list, comment ratio, complexity hints."

    EXT_LANGS = {
        ".py": "Python", ".js": "JavaScript", ".ts": "TypeScript",
        ".mjs": "JavaScript", ".jsx": "JSX", ".tsx": "TSX",
        ".java": "Java", ".go": "Go", ".rs": "Rust", ".c": "C",
        ".cpp": "C++", ".cc": "C++", ".h": "C/C++ Header",
        ".rb": "Ruby", ".php": "PHP", ".swift": "Swift",
        ".kt": "Kotlin", ".cs": "C#", ".sh": "Shell",
        ".bash": "Bash", ".zsh": "Zsh", ".sql": "SQL",
        ".html": "HTML", ".css": "CSS", ".scss": "SCSS"
    }

    def run(self, context: dict) -> dict:
        path = context.get("path", "")
        if not path:
            return {"error": "path is required in context"}

        try:
            with open(path, "r", errors="ignore") as f:
                content = f.read()
        except Exception as e:
            return {"error": f"Cannot read file: {e}"}

        lines = content.split("\n")
        lang = self.EXT_LANGS.get(Path(path).suffix, "Unknown")

        functions = self._extract_functions(content, Path(path).suffix)
        comments = self._count_comments(content, Path(path).suffix)
        blank = sum(1 for l in lines if not l.strip())
        code_lines = len(lines) - blank

        return {
            "success": True,
            "path": path,
            "language": lang,
            "total_lines": len(lines),
            "code_lines": code_lines,
            "blank_lines": blank,
            "comment_lines": comments,
            "comment_ratio": round(comments / max(len(lines), 1) * 100, 1),
            "functions": functions[:20],
            "function_count": len(functions)
        }

    def _extract_functions(self, content: str, ext: str) -> list:
        funcs = []
        patterns = {
            ".py": r"def\s+(\w+)\s*\(",
            ".js": r"(?:function\s+(\w+)|(?:async\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(|(\w+)\s*\([^)]*\)\s*\{)",
            ".ts": r"(?:function\s+(\w+)|(?:const|let)\s+(\w+)\s*=\s*(?:async\s+)?\(|(\w+)\s*\([^)]*\)\s*[:{])",
            ".go": r"func\s+(?:\([^)]+\)\s+)?(\w+)\s*\(",
            ".rs": r"fn\s+(\w+)\s*(",
            ".java": r"(?:public|private|protected)?\s*(?:static)?\s*\w+\s+(\w+)\s*\(",
            ".rb": r"def\s+(\w+)",
            ".sh": r"function\s+(\w+)|(\w+)\s*\(\)\s*\{",
        }
        pat = patterns.get(ext, r"(?:function|def|fn|proc)\s+(\w+)\s*\(")
        for m in re.finditer(pat, content):
            name = next((g for g in m.groups() if g), m.group(1))
            if name:
                funcs.append(name)
        return funcs

    def _count_comments(self, content: str, ext: str) -> int:
        if ext in [".py", ".rb", ".sh", ".bash", ".zsh", ".yaml", ".yml"]:
            return len(re.findall(r"^\s*#", content, re.MULTILINE))
        if ext in [".js", ".ts", ".jsx", ".tsx", ".java", ".c", ".cpp", ".h", ".go", ".rs", ".cs"]:
            return len(re.findall(r"^\s*//", content, re.MULTILINE)) + \
                   len(re.findall(r"/\*[\s\S]*?\*/", content))
        if ext in [".html", ".css", ".scss"]:
            return len(re.findall(r"<!--|-->", content)) // 2 + \
                   len(re.findall(r"^\s*/\*", content, re.MULTILINE))
        return 0
