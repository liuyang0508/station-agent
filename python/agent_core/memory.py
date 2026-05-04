"""Memory system with SQLite storage and vector search."""

import hashlib
import json
import re
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
        """Generate TF-IDF embedding from text content.

        Builds a mini TF-IDF vector for semantic similarity search.
        More principled than word hashing - terms appearing rarely across
        documents get higher weights.
        """
        if not HAS_NUMPY:
            return [0.0] * dim

        # Get all stored contents to build IDF
        rows = self.conn.execute("SELECT content FROM memories LIMIT 200").fetchall()
        all_docs = [r[0] for r in rows] + [content]

        # Tokenize
        words = re.findall(r"\b\w{2,}\b", content.lower())
        if not words:
            return [0.0] * dim

        # Count doc frequency for IDF
        doc_freq = {}
        for doc in all_docs:
            doc_words = set(re.findall(r"\b\w{2,}\b", doc.lower()))
            for w in doc_words:
                doc_freq[w] = doc_freq.get(w, 0) + 1

        num_docs = len(all_docs)
        vocab = {w: i for i, w in enumerate(sorted(doc_freq.keys())) if i < dim}
        vector = np.zeros(dim, dtype=np.float32)

        # TF-IDF
        for word in words:
            if word in vocab:
                tf = words.count(word) / max(len(words), 1)
                idf = np.log(num_docs / max(doc_freq.get(word, 1), 1)) + 1
                vector[vocab[word]] = tf * idf

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

        # Get all stored memories and their raw content
        rows = self.conn.execute("SELECT id, content FROM memories LIMIT 200").fetchall()
        if not rows:
            return {"success": True, "results": []}

        # Rebuild all embeddings using current corpus IDF (consistent similarity)
        query_vec = np.array(embedding, dtype=np.float32)
        mem_vectors = []
        all_words_in_corpus = set()
        for mid, content in rows:
            words = set(re.findall(r"\b\w{2,}\b", content.lower()))
            for w in words:
                all_words_in_corpus.add(w)

        num_docs = len(rows)
        vocab = {w: i for i, w in enumerate(sorted(all_words_in_corpus)) if i < 128}

        for memory_id, content in rows:
            words = re.findall(r"\b\w{2,}\b", content.lower())
            if not words:
                vec = np.zeros(128, dtype=np.float32)
            else:
                doc_freq = {}
                for doc_content in [c for _, c in rows]:
                    doc_words = set(re.findall(r"\b\w{2,}\b", doc_content.lower()))
                    for w in doc_words:
                        doc_freq[w] = doc_freq.get(w, 0) + 1

                vec = np.zeros(128, dtype=np.float32)
                for word in words:
                    if word in vocab:
                        tf = words.count(word) / max(len(words), 1)
                        idf = np.log(num_docs / max(doc_freq.get(word, 1), 1)) + 1
                        vec[vocab[word]] = tf * idf

                norm = np.linalg.norm(vec)
                if norm > 0:
                    vec = vec / norm

            mem_vectors.append((memory_id, content, vec))

        # Compute similarities
        results = []
        for memory_id, content, vec in mem_vectors:
            sim = _cosine_similarity(query_vec, vec)
            results.append((memory_id, content, float(sim)))

        results.sort(key=lambda x: x[2], reverse=True)
        top = results[:limit]

        return {
            "success": True,
            "results": [
                {"id": mid, "content": content[:200], "similarity": round(sim, 4)}
                for mid, content, sim in top
            ]
        }

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
