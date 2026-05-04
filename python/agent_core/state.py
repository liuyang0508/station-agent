"""State management for Python Agent conversations."""

import time
from typing import Any

class AgentState:
    """Manages conversation state and context windows."""

    def __init__(self, max_tokens: int = 60000):
        self.max_tokens = max_tokens
        self.conversations: dict[str, list[dict]] = {}
        self.context_windows: dict[str, list[dict]] = {}

    def add_message(self, conversation_id: str, role: str, content: str, metadata: dict = None):
        """Add a message to a conversation."""
        if conversation_id not in self.conversations:
            self.conversations[conversation_id] = []

        message = {
            'role': role,
            'content': content,
            'timestamp': time.time(),
            'metadata': metadata or {}
        }
        self.conversations[conversation_id].append(message)

    def get_context(self, conversation_id: str, max_messages: int = 40) -> list[dict]:
        """Get trimmed context window for a conversation."""
        if conversation_id not in self.conversations:
            return []

        messages = self.conversations[conversation_id]

        # Simple token estimation (4 chars per token)
        total_tokens = sum(len(m['content']) / 4 for m in messages)

        if total_tokens <= self.max_tokens and len(messages) <= max_messages:
            return messages

        # Trim from oldest messages
        trimmed = messages[-max_messages:]
        while sum(len(m['content']) / 4 for m in trimmed) > self.max_tokens and len(trimmed) > 1:
            trimmed = trimmed[1:]

        return trimmed

    def list_conversations(self) -> list[str]:
        """List all conversation IDs."""
        return list(self.conversations.keys())

    def get_conversation_summary(self, conversation_id: str) -> dict:
        """Get summary of a conversation."""
        messages = self.conversations.get(conversation_id, [])
        return {
            'id': conversation_id,
            'message_count': len(messages),
            'first_message': messages[0] if messages else None,
            'last_message': messages[-1] if messages else None
        }