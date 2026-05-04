"""Memory system with SQLite storage and vector search."""

import hashlib
import json
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

# Use numpy for cosine similarity if ml_distance not available
def _cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    if HAS_ML_DISTANCE:
        return cosine(a, b)
    norm_a = np.linalg.norm(a)
    norm_b = np.linalg.norm(b)
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return float(np.dot(a, b) / (norm_a * norm_b))


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

    def _generate_embedding(self, content: str, dim: int = 128) -> list[float]:
        """Generate a deterministic embedding from text content using word hashing.

        Uses hash of each word to seed a pseudo-random vector, then sums.
        This provides a simple but reproducible embedding without LLM calls.
        """
        if not HAS_NUMPY:
            return [0.0] * dim

        words = content.lower().split()
        vector = np.zeros(dim, dtype=np.float32)

        for word in words:
            # Use MD5 hash of word as seed for deterministic randomness
            word_hash = hashlib.md5(word.encode()).digest()
            seed = int.from_bytes(word_hash[:4], "little")
            rng = np.random.RandomState(seed)
            vector += rng.rand(dim).astype(np.float32)

        # Normalize to unit length
        norm = np.linalg.norm(vector)
        if norm > 0:
            vector = vector / norm

        return vector.tolist()

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
        if embedding is None and HAS_NUMPY:
            embedding = self._generate_embedding(content)

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

        if not HAS_NUMPY:
            return {"success": False, "error": "numpy not available"}

        query = np.array(embedding, dtype=np.float32)

        rows = self.conn.execute(
            "SELECT memory_id, vector FROM embeddings LIMIT 100"
        ).fetchall()

        results = []
        for memory_id, blob in rows:
            if blob is None:
                continue
            vec = np.frombuffer(blob, dtype=np.float32)
            sim = _cosine_similarity(query, vec)
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
