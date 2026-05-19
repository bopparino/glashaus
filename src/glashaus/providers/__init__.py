"""LLM / embedding provider adapters.

Two separate Protocols (`ChatProvider`, `EmbeddingProvider`) composed at
the config layer. They have different lifecycles, params, and capability
flags — keeping them split makes "Ollama for chat + OpenAI for embeddings"
the natural shape, not a special case.

See `providers/base.py` for the interfaces and the structured-output
retry helper (`structured_complete_with_retry`).
"""

from glashaus.providers.base import (
    ChatCapabilities,
    ChatMessage,
    ChatProvider,
    ChatResponse,
    EmbeddingCapabilities,
    EmbeddingProvider,
    StreamEvent,
    StreamFinal,
    StreamTextDelta,
    SystemBlock,
    Tool,
    ToolCall,
    ToolCallParseError,
    structured_complete_with_retry,
)
from glashaus.providers.ollama_chat import (
    DEFAULT_MODEL as DEFAULT_OLLAMA_MODEL,
)
from glashaus.providers.ollama_chat import (
    OllamaChatProvider,
)
from glashaus.providers.openai_embed import (
    DEFAULT_MODEL as DEFAULT_EMBEDDING_MODEL,
)
from glashaus.providers.openai_embed import (
    OpenAIEmbeddingProvider,
)

__all__ = [
    "DEFAULT_EMBEDDING_MODEL",
    "DEFAULT_OLLAMA_MODEL",
    "ChatCapabilities",
    "ChatMessage",
    "ChatProvider",
    "ChatResponse",
    "EmbeddingCapabilities",
    "EmbeddingProvider",
    "OllamaChatProvider",
    "OpenAIEmbeddingProvider",
    "StreamEvent",
    "StreamFinal",
    "StreamTextDelta",
    "SystemBlock",
    "Tool",
    "ToolCall",
    "ToolCallParseError",
    "structured_complete_with_retry",
]
