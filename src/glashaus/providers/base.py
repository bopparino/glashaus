"""Provider interfaces and shared types.

Two separate protocols on purpose: `ChatProvider` and `EmbeddingProvider`
have different lifecycles (embeddings rarely swap, chat models swap
constantly), different capability flags, and different params. Composed
at the config layer rather than collapsed into one Provider interface.

This file also defines:

- `SystemBlock` — the cacheable system-prompt unit from plan §7.1. In
  Phase 1 the `cacheable` flag is a no-op (Ollama doesn't honor
  `cache_control`); the structure is preserved so the Phase-4 Anthropic
  adapter is a drop-in. Documented inline so nobody removes it.
- `Tool`, `ToolCall` — typed tool-use shapes that any chat provider
  must surface uniformly so the turn loop doesn't branch on provider.
- `ToolCallParseError` — raised when a model emits tool-call arguments
  that don't parse as JSON. Caught by `structured_complete_with_retry`.
- `structured_complete_with_retry` — Phase-1 follow-up #3 mandate:
  smaller local models are flaky on structured outputs in ways that
  look like system failures when they're really parse failures. Retry
  once with a stricter format reminder before raising.
- `StreamEvent` / `StreamTextDelta` / `StreamFinal` — discriminated
  union for streaming chat. Final event carries the full structured
  response so callers don't have to call complete() again after the
  stream to learn the tool_calls.
"""

from __future__ import annotations

from collections.abc import Iterator, Sequence
from dataclasses import dataclass, field
from typing import Any, Final, Protocol, runtime_checkable

# ============================================================================
# System prompt assembly (plan §7.1)
# ============================================================================


@dataclass(frozen=True, slots=True)
class SystemBlock:
    """One unit of system prompt.

    `cacheable=True` is the cache_control:ephemeral hint from §7.1. Phase 1
    has no Anthropic adapter, so this flag is no-op everywhere — Ollama
    concatenates blocks into a single system message regardless. The flag
    is preserved on the type so the Phase-4 Anthropic adapter can honor
    it without changing call sites or storage.
    """

    content: str
    cacheable: bool = False


# ============================================================================
# Chat message shape (provider-neutral)
# ============================================================================


@dataclass(frozen=True, slots=True)
class ChatMessage:
    """One message in the conversation history.

    `role`:
      - "user": from the user
      - "assistant": from the agent
      - "tool": result of a tool call (paired with `tool_call_id`)

    `tool_calls`: only meaningful on assistant messages. Each entry is a
    structured call the agent emitted.

    `tool_call_id`, `name`: only meaningful on tool messages. They
    associate the result with the specific call.
    """

    role: str
    content: str
    tool_calls: tuple[ToolCall, ...] = field(default_factory=tuple)
    tool_call_id: str | None = None
    name: str | None = None


@dataclass(frozen=True, slots=True)
class Tool:
    """A tool the model may call. `input_schema` is a JSON-schema dict
    describing the arguments. Provider adapters translate to whatever
    shape their API wants (Ollama: `tools=[{"type": "function", ...}]`)."""

    name: str
    description: str
    input_schema: dict[str, Any]


@dataclass(frozen=True, slots=True)
class ToolCall:
    """One structured call the agent emitted. `arguments` is the parsed
    dict, never a raw JSON string — the provider parses + raises
    ToolCallParseError on failure."""

    id: str
    name: str
    arguments: dict[str, Any]


@dataclass(frozen=True, slots=True)
class ChatResponse:
    """Provider-neutral response. The turn loop reads `content` for the
    user-facing text and iterates `tool_calls` for structured extraction.

    `finish_reason`: best-effort string ("stop", "tool_calls", "length",
    ...). Provider adapters map their own values onto this.

    `raw`: untouched provider response for the audit log. Don't read
    from this in business logic — it's diagnostic-only.
    """

    content: str
    tool_calls: tuple[ToolCall, ...]
    finish_reason: str
    raw: dict[str, Any]


# ============================================================================
# Streaming events
# ============================================================================


@dataclass(frozen=True, slots=True)
class StreamTextDelta:
    """A chunk of user-facing text from the model. Print as it arrives."""

    delta: str


@dataclass(frozen=True, slots=True)
class StreamFinal:
    """The terminal event of a stream: the full structured response.

    Callers iterate stream() until they receive a StreamFinal; then they
    read tool_calls / finish_reason / raw from `.response`. They do not
    need to call complete() again.
    """

    response: ChatResponse


StreamEvent = StreamTextDelta | StreamFinal


# ============================================================================
# Capabilities
# ============================================================================


@dataclass(frozen=True, slots=True)
class ChatCapabilities:
    supports_cache_control: bool
    supports_tool_use: bool
    supports_streaming: bool
    supports_vision: bool


@dataclass(frozen=True, slots=True)
class EmbeddingCapabilities:
    """Dimensions is read by the storage layer at startup to verify the
    embedding provider matches what migration 001 / future migrations
    locked in via vec0 (1536 today for OpenAI text-embedding-3-small)."""

    dimensions: int
    max_input_tokens: int


# ============================================================================
# Protocols (separate by design)
# ============================================================================


@runtime_checkable
class ChatProvider(Protocol):
    """Anything that can carry a conversation and emit tool calls.

    Different lifecycles than EmbeddingProvider on purpose — chat models
    swap constantly (Phase 4 adds Anthropic, OpenAI chat, Gemini), so
    this interface needs to be wide enough for streaming + tool use.
    """

    @property
    def model_name(self) -> str: ...

    @property
    def capabilities(self) -> ChatCapabilities: ...

    def complete(
        self,
        *,
        system_blocks: Sequence[SystemBlock],
        messages: Sequence[ChatMessage],
        tools: Sequence[Tool] = (),
        temperature: float = 0.7,
        max_tokens: int | None = None,
    ) -> ChatResponse: ...

    def stream(
        self,
        *,
        system_blocks: Sequence[SystemBlock],
        messages: Sequence[ChatMessage],
        tools: Sequence[Tool] = (),
        temperature: float = 0.7,
        max_tokens: int | None = None,
    ) -> Iterator[StreamEvent]: ...


@runtime_checkable
class EmbeddingProvider(Protocol):
    """Anything that maps text -> vector. Embeddings rarely swap because
    the dimension is locked into the vec0 schema at migration time —
    changing providers without re-migrating is a hard error."""

    @property
    def model_name(self) -> str: ...

    @property
    def capabilities(self) -> EmbeddingCapabilities: ...

    def embed(self, texts: Sequence[str]) -> list[list[float]]: ...


# ============================================================================
# Structured-output retry (follow-up #3)
# ============================================================================


class ToolCallParseError(Exception):
    """Model emitted a tool call whose arguments failed to parse as JSON.

    The model name and the raw argument text are attached for
    diagnostics. Caught by `structured_complete_with_retry`, which
    retries once with a stricter format reminder before re-raising.
    """

    def __init__(self, message: str, *, tool_name: str, raw_arguments: str) -> None:
        super().__init__(message)
        self.tool_name = tool_name
        self.raw_arguments = raw_arguments


_RETRY_NUDGE: Final[SystemBlock] = SystemBlock(
    content=(
        "Your previous response contained a tool call whose arguments "
        "could not be parsed as JSON. Emit arguments as strict, valid "
        "JSON only — no comments, no trailing commas, no markdown fences, "
        "no prose around the JSON object."
    ),
    cacheable=False,
)


def structured_complete_with_retry(
    provider: ChatProvider,
    *,
    system_blocks: Sequence[SystemBlock],
    messages: Sequence[ChatMessage],
    tools: Sequence[Tool] = (),
    max_retries: int = 1,
    temperature: float = 0.7,
    max_tokens: int | None = None,
) -> ChatResponse:
    """Call `provider.complete(...)`. If the model emits tool-call
    arguments that don't parse as JSON, retry up to `max_retries` times
    with an extra system block reminding the model to emit strict JSON.

    Defaults to one retry — that's the policy from Phase-1 follow-up #3:
    "retry once with a stricter format prompt before raising." Higher
    counts are available but rarely useful; if a model fails twice it
    will likely fail many times.
    """
    last_error: ToolCallParseError | None = None
    for attempt in range(max_retries + 1):
        blocks: Sequence[SystemBlock] = (
            (*system_blocks, _RETRY_NUDGE) if attempt > 0 else system_blocks
        )
        try:
            return provider.complete(
                system_blocks=blocks,
                messages=messages,
                tools=tools,
                temperature=temperature,
                max_tokens=max_tokens,
            )
        except ToolCallParseError as e:
            last_error = e
    assert last_error is not None
    raise last_error


__all__ = [
    "ChatCapabilities",
    "ChatMessage",
    "ChatProvider",
    "ChatResponse",
    "EmbeddingCapabilities",
    "EmbeddingProvider",
    "StreamEvent",
    "StreamFinal",
    "StreamTextDelta",
    "SystemBlock",
    "Tool",
    "ToolCall",
    "ToolCallParseError",
    "structured_complete_with_retry",
]
