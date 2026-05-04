"""Memory system with SQLite storage and vector search."""

import sqlite3
import uuid
from pathlib import Path
from typing import Any

try:
    import numpy as np
    HAS_NUMPY = True
except ImportError:
    HAS_NUMPY = False

try:
    from ml_distance import cosine
    HAS_ML_DISTANCE = True
except ImportError:
    HAS_ML_DISTANCE = False


class MemorySystem:
    """SQLite-backed memory with vector search for embeddings."""

    def __init__(self, db_path: str | Path | None = None):
        if db_path is None:
            db_path = Path.home() / ".station_agent" / "memory.db"
        db_path = Path(db_path)
        db_path.parent.mkdir(parents=True, exist_ok=True)

        self.conn = sqlite3.connect(db_path)
        self._init_db()

    def _init_db(self):
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS memories (
                id TEXT PRIMARY KEY,
                content TEXT NOT NULL,
                metadata TEXT DEFAULT '{}',
                created_at REAL DEFAULT (julianday('now'))
            )
        """)
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS embeddings (
                memory_id TEXT,
                vector BLOB,
                FOREIGN KEY (memory_id) REFERENCES memories(id)
            )
        """)
        self.conn.commit()

    def store(self, params: dict[str, Any]) -> dict[str, Any]:
        """Store a memory with optional embedding.

        Params:
            content: str - the memory text
            metadata: dict - optional metadata
            embedding: list[float] - optional vector embedding
        """
        content = params.get("content")
        if not content:
            return {"success": False, "error": "content required"}

        memory_id = str(uuid.uuid4())
        metadata = params.get("metadata", {})
        embedding = params.get("embedding")

        self.conn.execute(
            "INSERT INTO memories (id, content, metadata) VALUES (?, ?, ?)",
            (memory_id, content, json.dumps(metadata)),
        )

        if embedding and HAS_NUMPY:
            arr = np.array(embedding, dtype=np.float32)
            self.conn.execute(
                "INSERT INTO embeddings (memory_id, vector) VALUES (?, ?)",
                (memory_id, arr.tobytes()),
            )

        self.conn.commit()
        return {"success": True, "id": memory_id}

    def search(self, params: dict[str, Any]) -> dict[str, Any]:
        """Search memories by vector similarity.

        Params:
            embedding: list[float]
            limit: int (default 5)
        """
        embedding = params.get("embedding")
        limit = params.get("limit", 5)

        if not embedding:
            return {"success": False, "error": "embedding required"}

        if not HAS_NUMPY or not HAS_ML_DISTANCE:
            return {"success": False, "error": "numpy/ml-distance not available"}

        query = np.array(embedding, dtype=np.float32)

        rows = self.conn.execute(
            "SELECT memory_id, vector FROM embeddings LIMIT 100"
        ).fetchall()

        results = []
        for memory_id, blob in rows:
            if blob is None:
                continue
            vec = np.frombuffer(blob, dtype=np.float32)
            sim = cosine(query, vec)
            results.append((memory_id, float(sim)))

        results.sort(key=lambda x: x[1], reverse=True)
        top_ids = [r[0] for r in results[:limit]]

        if not top_ids:
            return {"success": True, "results": []}

        placeholders = ",".join("?" * len(top_ids))
        rows = self.conn.execute(
            f"SELECT id, content, metadata FROM memories WHERE id IN ({placeholders})",
            top_ids,
        ).fetchall()

        return {
            "success": True,
            "results": [
                {"id": r[0], "content": r[1], "metadata": json.loads(r[2])}
                for r in rows
            ],
        }

    def list_memories(self, params: dict[str, Any]) -> dict[str, Any]:
        """List recent memories."""
        limit = params.get("limit", 20)
        rows = self.conn.execute(
            "SELECT id, content, metadata FROM memories ORDER BY created_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return {
            "success": True,
            "memories": [
                {"id": r[0], "content": r[1], "metadata": json.loads(r[2])}
                for r in rows
            ],
        }

    def delete(self, params: dict[str, Any]) -> dict[str, Any]:
        """Delete a memory by id."""
        memory_id = params.get("id")
        if not memory_id:
            return {"success": False, "error": "id required"}

        self.conn.execute("DELETE FROM memories WHERE id = ?", (memory_id,))
        self.conn.execute("DELETE FROM embeddings WHERE memory_id = ?", (memory_id,))
        self.conn.commit()
        return {"success": True}


import json  # fmt
