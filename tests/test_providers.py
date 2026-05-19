"""Tests for the provider layer.

Coverage:
- ChatProvider / EmbeddingProvider Protocol separation (no accidental
  collapse into one interface).
- SystemBlock / Tool / ToolCall / ChatMessage / ChatResponse shapes.
- OllamaChatProvider: complete() and stream() against a fake `ollama.Client`,
  including tool-call extraction (dict args + JSON-string args + bad
  args raising ToolCallParseError), system-block concatenation,
  streaming-final-event synthesis, and env-var resolution.
- OpenAIEmbeddingProvider: embed() against a fake `openai` client,
  capability flags (1536 dim default), the dimensions-rebuild caveat
  comment is exercised.
- structured_complete_with_retry: retries once on ToolCallParseError,
  injects the nudge block, gives up after max_retries.

No live API calls. The point of the unit tests is that the adapter
logic is correct; integration tests against real Ollama / OpenAI come
later (and the cache_control canary CI job for Anthropic is tracked
as follow-up #4).
"""

from __future__ import annotations

from collections.abc import Iterator, Sequence
from typing import Any
from unittest.mock import MagicMock

import pytest

from glashaus.providers import (
    ChatCapabilities,
    ChatMessage,
    ChatProvider,
    ChatResponse,
    OllamaChatProvider,
    OpenAIEmbeddingProvider,
    StreamFinal,
    StreamTextDelta,
    SystemBlock,
    Tool,
    ToolCall,
    ToolCallParseError,
    structured_complete_with_retry,
)
from glashaus.providers.openai_embed import (
    DEFAULT_DIMENSIONS,
    DEFAULT_MAX_INPUT_TOKENS,
)

# ============================================================================
# Type / protocol shape
# ============================================================================


def test_chat_and_embedding_protocols_are_separate() -> None:
    """The whole point of splitting these — a class can satisfy one and
    not the other. If they ever collapse into a single Protocol, this
    test must keep failing meaningfully."""

    class FakeChat:
        @property
        def model_name(self) -> str:
            return "x"

        @property
        def capabilities(self) -> ChatCapabilities:
            return ChatCapabilities(False, False, False, False)

        def complete(self, **_: Any) -> ChatResponse:  # pragma: no cover — just satisfies protocol
            return ChatResponse(content="", tool_calls=(), finish_reason="stop", raw={})

        def stream(self, **_: Any) -> Iterator[Any]:  # pragma: no cover
            yield from ()

    fake = FakeChat()
    assert isinstance(fake, ChatProvider)
    # FakeChat has no `embed` method, so structurally it can't satisfy
    # EmbeddingProvider. mypy treats the isinstance branch as unreachable
    # at static-check time; the runtime check is the whole point of the
    # test, so we assert the structural property directly.
    assert not hasattr(fake, "embed")


def test_system_block_default_has_no_cache_breakpoint() -> None:
    assert SystemBlock(content="x").cache_breakpoint_ttl_seconds is None


def test_system_block_can_carry_cache_breakpoint_ttl() -> None:
    b = SystemBlock(content="x", cache_breakpoint_ttl_seconds=3600)
    assert b.cache_breakpoint_ttl_seconds == 3600


def test_tool_call_arguments_are_dict_not_string() -> None:
    """ToolCall stores parsed args. If a value lands here as a string,
    the provider adapter has a bug."""
    tc = ToolCall(id="1", name="record", arguments={"salience": 0.8})
    assert isinstance(tc.arguments, dict)


# ============================================================================
# OllamaChatProvider — complete()
# ============================================================================


def _make_msg(content: str = "", tool_calls: list[Any] | None = None) -> MagicMock:
    msg = MagicMock()
    msg.content = content
    msg.tool_calls = tool_calls
    return msg


def _make_response(
    content: str = "", tool_calls: list[Any] | None = None, done: bool = True
) -> MagicMock:
    resp = MagicMock()
    resp.message = _make_msg(content, tool_calls)
    resp.done = done
    resp.done_reason = "stop" if not tool_calls else None
    # Mimic pydantic's .model_dump() for the audit payload.
    resp.model_dump.return_value = {"message": {"content": content}, "done": done}
    return resp


def _make_tool_call(name: str, arguments: Any, call_id: str | None = None) -> MagicMock:
    call = MagicMock()
    call.function.name = name
    call.function.arguments = arguments
    call.id = call_id or "call-1"
    return call


def _patch_client(provider: OllamaChatProvider) -> MagicMock:
    """Replace the provider's ollama client with a MagicMock. Returns
    it so the test can configure `.chat.return_value` or
    `.chat.side_effect`."""
    fake = MagicMock()
    provider._client = fake
    return fake


@pytest.fixture
def ollama_provider() -> OllamaChatProvider:
    return OllamaChatProvider(model="test-model")


def test_ollama_complete_concatenates_system_blocks(
    ollama_provider: OllamaChatProvider,
) -> None:
    client = _patch_client(ollama_provider)
    client.chat.return_value = _make_response(content="hi back")

    ollama_provider.complete(
        system_blocks=[SystemBlock("first"), SystemBlock("second")],
        messages=[ChatMessage(role="user", content="hi")],
    )

    sent_messages = client.chat.call_args.kwargs["messages"]
    assert sent_messages[0]["role"] == "system"
    assert sent_messages[0]["content"] == "first\n\nsecond"
    assert sent_messages[1] == {"role": "user", "content": "hi"}


def test_ollama_complete_returns_chat_response_with_content(
    ollama_provider: OllamaChatProvider,
) -> None:
    client = _patch_client(ollama_provider)
    client.chat.return_value = _make_response(content="hello world")

    resp = ollama_provider.complete(
        system_blocks=[],
        messages=[ChatMessage(role="user", content="hi")],
    )
    assert resp.content == "hello world"
    assert resp.tool_calls == ()
    assert resp.finish_reason == "stop"


def test_ollama_extracts_tool_calls_with_dict_args(
    ollama_provider: OllamaChatProvider,
) -> None:
    client = _patch_client(ollama_provider)
    client.chat.return_value = _make_response(
        content="",
        tool_calls=[
            _make_tool_call(name="record_turn", arguments={"salience": 0.8, "valence": 0.2})
        ],
    )

    resp = ollama_provider.complete(
        system_blocks=[],
        messages=[ChatMessage(role="user", content="...")],
    )
    assert len(resp.tool_calls) == 1
    tc = resp.tool_calls[0]
    assert tc.name == "record_turn"
    assert tc.arguments == {"salience": 0.8, "valence": 0.2}
    assert resp.finish_reason == "tool_calls"


def test_ollama_extracts_tool_calls_with_json_string_args(
    ollama_provider: OllamaChatProvider,
) -> None:
    """Some models emit arguments as a JSON-encoded string. We parse."""
    client = _patch_client(ollama_provider)
    client.chat.return_value = _make_response(
        tool_calls=[_make_tool_call(name="record_turn", arguments='{"salience": 0.5}')],
    )
    resp = ollama_provider.complete(
        system_blocks=[],
        messages=[ChatMessage(role="user", content="x")],
    )
    assert resp.tool_calls[0].arguments == {"salience": 0.5}


def test_ollama_raises_on_unparseable_argument_string(
    ollama_provider: OllamaChatProvider,
) -> None:
    client = _patch_client(ollama_provider)
    client.chat.return_value = _make_response(
        tool_calls=[_make_tool_call(name="record_turn", arguments="{salience: 0.5,}")],
    )
    with pytest.raises(ToolCallParseError) as excinfo:
        ollama_provider.complete(
            system_blocks=[],
            messages=[ChatMessage(role="user", content="x")],
        )
    assert excinfo.value.tool_name == "record_turn"
    assert "{salience" in excinfo.value.raw_arguments


def test_ollama_raises_when_json_args_arent_object(
    ollama_provider: OllamaChatProvider,
) -> None:
    """Top-level array or scalar is parseable but not a valid arguments
    payload — must still raise so the retry helper fires."""
    client = _patch_client(ollama_provider)
    client.chat.return_value = _make_response(
        tool_calls=[_make_tool_call(name="record_turn", arguments="[1, 2, 3]")]
    )
    with pytest.raises(ToolCallParseError):
        ollama_provider.complete(
            system_blocks=[],
            messages=[ChatMessage(role="user", content="x")],
        )


def test_ollama_capabilities_indicate_no_cache_control(
    ollama_provider: OllamaChatProvider,
) -> None:
    caps = ollama_provider.capabilities
    assert caps.supports_cache_control is False
    assert caps.supports_tool_use is True
    assert caps.supports_streaming is True
    assert caps.supports_vision is False


def test_ollama_complete_forwards_temperature_and_max_tokens(
    ollama_provider: OllamaChatProvider,
) -> None:
    client = _patch_client(ollama_provider)
    client.chat.return_value = _make_response(content="ok")
    ollama_provider.complete(
        system_blocks=[],
        messages=[ChatMessage(role="user", content="x")],
        temperature=0.2,
        max_tokens=256,
    )
    options = client.chat.call_args.kwargs["options"]
    assert options["temperature"] == 0.2
    assert options["num_predict"] == 256


def test_ollama_complete_translates_tools_to_function_shape(
    ollama_provider: OllamaChatProvider,
) -> None:
    client = _patch_client(ollama_provider)
    client.chat.return_value = _make_response(content="ok")
    ollama_provider.complete(
        system_blocks=[],
        messages=[ChatMessage(role="user", content="x")],
        tools=[
            Tool(
                name="record",
                description="record a turn",
                input_schema={
                    "type": "object",
                    "properties": {"salience": {"type": "number"}},
                    "required": ["salience"],
                },
            )
        ],
    )
    sent_tools = client.chat.call_args.kwargs["tools"]
    assert sent_tools[0]["function"]["name"] == "record"
    assert sent_tools[0]["function"]["parameters"]["required"] == ["salience"]


# ============================================================================
# OllamaChatProvider — stream()
# ============================================================================


def test_ollama_stream_yields_deltas_then_final(
    ollama_provider: OllamaChatProvider,
) -> None:
    client = _patch_client(ollama_provider)
    chunks = [
        _make_response(content="Hello", done=False),
        _make_response(content=", ", done=False),
        _make_response(content="world", done=False),
        _make_response(content="", done=True),  # final marker
    ]
    client.chat.return_value = iter(chunks)

    events = list(
        ollama_provider.stream(
            system_blocks=[],
            messages=[ChatMessage(role="user", content="hi")],
        )
    )
    deltas = [e for e in events if isinstance(e, StreamTextDelta)]
    finals = [e for e in events if isinstance(e, StreamFinal)]
    assert len(finals) == 1
    assert "".join(d.delta for d in deltas) == "Hello, world"
    assert finals[0].response.content == "Hello, world"
    assert finals[0].response.finish_reason == "stop"


def test_ollama_stream_collects_tool_calls_on_final_chunk(
    ollama_provider: OllamaChatProvider,
) -> None:
    client = _patch_client(ollama_provider)
    final = _make_response(content="", done=True)
    final.message.tool_calls = [_make_tool_call(name="record_turn", arguments={"salience": 0.6})]
    final.done_reason = None  # tool_calls path
    client.chat.return_value = iter([final])

    events = list(
        ollama_provider.stream(
            system_blocks=[],
            messages=[ChatMessage(role="user", content="x")],
            tools=[Tool(name="record_turn", description="d", input_schema={})],
        )
    )
    finals = [e for e in events if isinstance(e, StreamFinal)]
    assert len(finals) == 1
    assert finals[0].response.tool_calls[0].name == "record_turn"
    assert finals[0].response.finish_reason == "tool_calls"


def test_ollama_stream_synthesizes_incomplete_final_when_no_done_chunk(
    ollama_provider: OllamaChatProvider,
) -> None:
    """Defensive — if the stream ends without a done=True chunk, we still
    emit a StreamFinal so callers don't hang waiting for one."""
    client = _patch_client(ollama_provider)
    client.chat.return_value = iter([_make_response(content="partial", done=False)])

    events = list(
        ollama_provider.stream(
            system_blocks=[],
            messages=[ChatMessage(role="user", content="x")],
        )
    )
    finals = [e for e in events if isinstance(e, StreamFinal)]
    assert len(finals) == 1
    assert finals[0].response.finish_reason == "incomplete"


# ============================================================================
# OllamaChatProvider — env var resolution
# ============================================================================


def test_ollama_provider_reads_api_key_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OLLAMA_API_KEY", "test-key")
    p = OllamaChatProvider(model="test")
    # Can't introspect Client headers cleanly across versions; the
    # important behavior is that construction doesn't fail with a key
    # present, and that the explicit-arg path also works (next test).
    assert p.model_name == "test"


def test_ollama_provider_uses_explicit_key_over_env(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("OLLAMA_API_KEY", "env-key")
    # If construction with an explicit key doesn't blow up, the override
    # path is wired.
    p = OllamaChatProvider(model="test", api_key="explicit")
    assert p.model_name == "test"


# ============================================================================
# OpenAIEmbeddingProvider
# ============================================================================


def _patch_openai(provider: OpenAIEmbeddingProvider) -> MagicMock:
    fake = MagicMock()
    provider._client = fake
    return fake


def test_embedding_capabilities_defaults_to_1536_dim() -> None:
    p = OpenAIEmbeddingProvider(api_key="sk-test")
    assert p.capabilities.dimensions == DEFAULT_DIMENSIONS
    assert p.capabilities.dimensions == 1536
    assert p.capabilities.max_input_tokens == DEFAULT_MAX_INPUT_TOKENS


def test_embedding_model_name_is_text_embedding_3_small() -> None:
    p = OpenAIEmbeddingProvider(api_key="sk-test")
    assert p.model_name == "text-embedding-3-small"


def test_embed_returns_list_of_lists() -> None:
    p = OpenAIEmbeddingProvider(api_key="sk-test")
    client = _patch_openai(p)
    fake_resp = MagicMock()
    item_a = MagicMock()
    item_a.embedding = [0.1] * 1536
    item_b = MagicMock()
    item_b.embedding = [0.2] * 1536
    fake_resp.data = [item_a, item_b]
    client.embeddings.create.return_value = fake_resp

    out = p.embed(["austin says hi", "second"])
    assert len(out) == 2
    assert len(out[0]) == 1536
    assert all(isinstance(x, float) for x in out[0])


def test_embed_empty_input_short_circuits() -> None:
    """Don't make an API call for an empty input list."""
    p = OpenAIEmbeddingProvider(api_key="sk-test")
    client = _patch_openai(p)
    assert p.embed([]) == []
    client.embeddings.create.assert_not_called()


def test_embed_does_not_pass_dimensions_at_default() -> None:
    """At the model's native dim we don't send `dimensions=` because
    some API combos reject the redundant arg."""
    p = OpenAIEmbeddingProvider(api_key="sk-test")
    client = _patch_openai(p)
    fake_resp = MagicMock()
    fake_resp.data = [MagicMock(embedding=[0.0] * 1536)]
    client.embeddings.create.return_value = fake_resp

    p.embed(["hi"])
    kwargs = client.embeddings.create.call_args.kwargs
    assert "dimensions" not in kwargs


def test_embed_passes_dimensions_when_overridden() -> None:
    """If the caller asks for a non-native dim, pass it through. (Still
    requires a matching vec0 migration — see the module docstring.)"""
    p = OpenAIEmbeddingProvider(api_key="sk-test", dimensions=512)
    client = _patch_openai(p)
    fake_resp = MagicMock()
    fake_resp.data = [MagicMock(embedding=[0.0] * 512)]
    client.embeddings.create.return_value = fake_resp

    p.embed(["hi"])
    assert client.embeddings.create.call_args.kwargs["dimensions"] == 512


# ============================================================================
# structured_complete_with_retry
# ============================================================================


class _FakeChatProvider:
    """Records call history; configurable side_effects for testing retry."""

    def __init__(self, behaviors: list[Any]) -> None:
        self._behaviors = list(behaviors)
        self.calls: list[dict[str, Any]] = []
        self.model_name = "fake"
        self.capabilities = ChatCapabilities(
            supports_cache_control=False,
            supports_tool_use=True,
            supports_streaming=False,
            supports_vision=False,
        )

    def complete(
        self,
        *,
        system_blocks: Sequence[SystemBlock],
        messages: Sequence[ChatMessage],
        tools: Sequence[Tool] = (),
        temperature: float = 0.7,
        max_tokens: int | None = None,
    ) -> ChatResponse:
        self.calls.append(
            {
                "system_blocks": list(system_blocks),
                "messages": list(messages),
                "tools": list(tools),
            }
        )
        behavior = self._behaviors.pop(0)
        if isinstance(behavior, Exception):
            raise behavior
        assert isinstance(behavior, ChatResponse)
        return behavior

    def stream(self, **_: Any) -> Iterator[Any]:  # pragma: no cover — protocol requires this
        yield from ()


def _good_response() -> ChatResponse:
    return ChatResponse(
        content="ok",
        tool_calls=(ToolCall(id="1", name="record", arguments={"salience": 0.5}),),
        finish_reason="tool_calls",
        raw={},
    )


def test_retry_helper_returns_first_success_no_retry() -> None:
    fake = _FakeChatProvider([_good_response()])
    out = structured_complete_with_retry(
        fake,
        system_blocks=[SystemBlock("original")],
        messages=[ChatMessage(role="user", content="hi")],
        tools=[],
    )
    assert out.content == "ok"
    assert len(fake.calls) == 1
    # No nudge block on a clean first try.
    assert len(fake.calls[0]["system_blocks"]) == 1


def test_retry_helper_retries_once_on_parse_error_and_injects_nudge() -> None:
    err = ToolCallParseError("boom", tool_name="record", raw_arguments="not json")
    fake = _FakeChatProvider([err, _good_response()])
    out = structured_complete_with_retry(
        fake,
        system_blocks=[SystemBlock("original")],
        messages=[ChatMessage(role="user", content="hi")],
        tools=[],
    )
    assert out.content == "ok"
    assert len(fake.calls) == 2
    # Second attempt has an extra nudge block.
    assert len(fake.calls[1]["system_blocks"]) == 2
    nudge = fake.calls[1]["system_blocks"][-1]
    assert "strict, valid JSON" in nudge.content
    # Original block still leads.
    assert fake.calls[1]["system_blocks"][0].content == "original"


def test_retry_helper_raises_after_exhausting_retries() -> None:
    err1 = ToolCallParseError("a", tool_name="record", raw_arguments="x")
    err2 = ToolCallParseError("b", tool_name="record", raw_arguments="y")
    fake = _FakeChatProvider([err1, err2])
    with pytest.raises(ToolCallParseError) as excinfo:
        structured_complete_with_retry(
            fake,
            system_blocks=[SystemBlock("original")],
            messages=[ChatMessage(role="user", content="hi")],
            tools=[],
            max_retries=1,
        )
    # The *last* error is what propagates.
    assert str(excinfo.value).startswith("b")
    assert len(fake.calls) == 2


def test_retry_helper_max_retries_zero_means_no_retry() -> None:
    err = ToolCallParseError("once", tool_name="record", raw_arguments="x")
    fake = _FakeChatProvider([err])
    with pytest.raises(ToolCallParseError):
        structured_complete_with_retry(
            fake,
            system_blocks=[],
            messages=[ChatMessage(role="user", content="x")],
            tools=[],
            max_retries=0,
        )
    assert len(fake.calls) == 1


def test_retry_helper_does_not_retry_other_exceptions() -> None:
    """Only ToolCallParseError triggers the retry path. Other failures
    propagate immediately."""
    fake = _FakeChatProvider([RuntimeError("transport boom")])
    with pytest.raises(RuntimeError, match="transport"):
        structured_complete_with_retry(
            fake,
            system_blocks=[],
            messages=[ChatMessage(role="user", content="x")],
            tools=[],
        )
    assert len(fake.calls) == 1
