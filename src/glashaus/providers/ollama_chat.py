"""Ollama chat provider.

Targets Kimi K2.6 via Ollama Cloud through the locally-installed and
signed-in Ollama daemon. The Python `ollama` client defaults to
`http://localhost:11434`; when the user is logged in via `ollama
signin`, cloud models (the `:cloud` tag) route transparently.

Environment overrides honored at construction time:

- `OLLAMA_HOST` — point at an Ollama daemon other than localhost.
- `OLLAMA_API_KEY` — sent as `Authorization: Bearer <key>`. Use this
  when running on a server without a local Ollama install, hitting the
  cloud API directly.

What this adapter is *not*: an embedding provider. The plan splits
chat and embeddings into separate interfaces because their lifecycles
and capability flags diverge — see `providers/base.py`.
"""

from __future__ import annotations

import json
import os
import uuid
from collections.abc import Iterator, Sequence
from typing import Any

from ollama import Client

from glashaus.providers.base import (
    ChatCapabilities,
    ChatMessage,
    ChatResponse,
    StreamEvent,
    StreamFinal,
    StreamTextDelta,
    SystemBlock,
    Tool,
    ToolCall,
    ToolCallParseError,
)

DEFAULT_MODEL = "kimi-k2.6:cloud"

_CAPABILITIES = ChatCapabilities(
    # Ollama doesn't honor cache_control:ephemeral. SystemBlocks with
    # cache_breakpoint_ttl_seconds set are concatenated as plain text
    # like any other block; the markers stay in the type system so
    # Phase 4's Anthropic adapter can pick them up without call-site
    # changes.
    supports_cache_control=False,
    supports_tool_use=True,
    supports_streaming=True,
    supports_vision=False,
)


class OllamaChatProvider:
    """Implements [`ChatProvider`][glashaus.providers.base.ChatProvider]
    against Ollama (local daemon or cloud API).
    """

    def __init__(
        self,
        model: str = DEFAULT_MODEL,
        *,
        host: str | None = None,
        api_key: str | None = None,
    ) -> None:
        self._model = model
        resolved_host = host or os.environ.get("OLLAMA_HOST")
        resolved_key = api_key or os.environ.get("OLLAMA_API_KEY")
        headers: dict[str, str] = {}
        if resolved_key:
            headers["Authorization"] = f"Bearer {resolved_key}"
        # If neither host nor key set, the ollama client picks its own
        # default (http://localhost:11434) — exactly what we want for
        # the user's signed-in laptop.
        self._client = Client(host=resolved_host, headers=headers or None)

    @property
    def model_name(self) -> str:
        return self._model

    @property
    def capabilities(self) -> ChatCapabilities:
        return _CAPABILITIES

    # ------------------------------------------------------------------
    # complete()
    # ------------------------------------------------------------------

    def complete(
        self,
        *,
        system_blocks: Sequence[SystemBlock],
        messages: Sequence[ChatMessage],
        tools: Sequence[Tool] = (),
        temperature: float = 0.7,
        max_tokens: int | None = None,
    ) -> ChatResponse:
        wire_messages = self._to_wire_messages(system_blocks, messages)
        wire_tools = self._to_wire_tools(tools) if tools else None
        options = self._build_options(temperature, max_tokens)

        raw = self._client.chat(
            model=self._model,
            messages=wire_messages,
            tools=wire_tools,
            stream=False,
            options=options,
        )
        return self._response_from_ollama(raw)

    # ------------------------------------------------------------------
    # stream()
    # ------------------------------------------------------------------

    def stream(
        self,
        *,
        system_blocks: Sequence[SystemBlock],
        messages: Sequence[ChatMessage],
        tools: Sequence[Tool] = (),
        temperature: float = 0.7,
        max_tokens: int | None = None,
    ) -> Iterator[StreamEvent]:
        wire_messages = self._to_wire_messages(system_blocks, messages)
        wire_tools = self._to_wire_tools(tools) if tools else None
        options = self._build_options(temperature, max_tokens)

        text_accumulator: list[str] = []
        final_chunk: Any = None

        stream = self._client.chat(
            model=self._model,
            messages=wire_messages,
            tools=wire_tools,
            stream=True,
            options=options,
        )

        for chunk in stream:
            # Every streamed chunk has .message with a partial .content.
            # The ollama client emits a final chunk with .done=True
            # whose .message may contain accumulated tool_calls.
            msg = getattr(chunk, "message", None)
            delta = ""
            if msg is not None:
                delta = getattr(msg, "content", "") or ""
            if delta:
                text_accumulator.append(delta)
                yield StreamTextDelta(delta=delta)
            if getattr(chunk, "done", False):
                final_chunk = chunk

        # Synthesize the final structured response. If the stream ended
        # without a `done=True` chunk (provider quirk), use the last we
        # saw — which is whatever was in `chunk` when the loop exited.
        if final_chunk is None:
            # Fall back to an empty raw payload so the audit log entry
            # is at least well-typed; this branch is "model misbehaved"
            # territory and the caller decides how to react.
            yield StreamFinal(
                response=ChatResponse(
                    content="".join(text_accumulator),
                    tool_calls=(),
                    finish_reason="incomplete",
                    raw={},
                )
            )
            return

        # Tool-call extraction off the final chunk. We pass the
        # already-accumulated text through; Ollama also emits the
        # full content on the final chunk for non-streaming consumers
        # but we already streamed each delta.
        tool_calls = self._extract_tool_calls(final_chunk)
        raw_dict = _to_plain_dict(final_chunk)
        yield StreamFinal(
            response=ChatResponse(
                content="".join(text_accumulator),
                tool_calls=tool_calls,
                finish_reason=_finish_reason(final_chunk),
                raw=raw_dict,
            )
        )

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    def _to_wire_messages(
        self,
        system_blocks: Sequence[SystemBlock],
        messages: Sequence[ChatMessage],
    ) -> list[dict[str, Any]]:
        """Concatenate system_blocks into one system message at the
        start. Ollama doesn't honor cache_control, so the flag is
        preserved at the type level but not on the wire."""
        wire: list[dict[str, Any]] = []
        if system_blocks:
            wire.append(
                {
                    "role": "system",
                    "content": "\n\n".join(b.content for b in system_blocks),
                }
            )
        for m in messages:
            entry: dict[str, Any] = {"role": m.role, "content": m.content}
            if m.tool_calls:
                entry["tool_calls"] = [
                    {
                        "function": {
                            "name": tc.name,
                            "arguments": tc.arguments,
                        }
                    }
                    for tc in m.tool_calls
                ]
            if m.tool_call_id is not None:
                # Ollama doesn't yet have a stable "tool_call_id" field
                # on tool-result messages across all models; many models
                # match by tool name. Send both to be safe.
                entry["tool_call_id"] = m.tool_call_id
            if m.name is not None:
                entry["name"] = m.name
            wire.append(entry)
        return wire

    @staticmethod
    def _to_wire_tools(tools: Sequence[Tool]) -> list[dict[str, Any]]:
        return [
            {
                "type": "function",
                "function": {
                    "name": t.name,
                    "description": t.description,
                    "parameters": t.input_schema,
                },
            }
            for t in tools
        ]

    @staticmethod
    def _build_options(temperature: float, max_tokens: int | None) -> dict[str, Any]:
        options: dict[str, Any] = {"temperature": temperature}
        if max_tokens is not None:
            options["num_predict"] = max_tokens
        return options

    def _response_from_ollama(self, raw: Any) -> ChatResponse:
        msg = getattr(raw, "message", None)
        content = ""
        if msg is not None:
            content = getattr(msg, "content", "") or ""
        tool_calls = self._extract_tool_calls(raw)
        return ChatResponse(
            content=content,
            tool_calls=tool_calls,
            finish_reason=_finish_reason(raw),
            raw=_to_plain_dict(raw),
        )

    @staticmethod
    def _extract_tool_calls(raw: Any) -> tuple[ToolCall, ...]:
        """Parse tool_calls off an ollama response object.

        Ollama emits tool_calls as objects with `.function.name` and
        `.function.arguments`. `arguments` is usually a dict already;
        some models emit a JSON string. We accept both and raise
        ToolCallParseError on un-parseable strings."""
        msg = getattr(raw, "message", None)
        if msg is None:
            return ()
        calls = getattr(msg, "tool_calls", None) or ()
        out: list[ToolCall] = []
        for call in calls:
            fn = getattr(call, "function", None)
            if fn is None:
                continue
            name = getattr(fn, "name", "") or ""
            arguments_raw = getattr(fn, "arguments", None)
            arguments = _coerce_arguments(arguments_raw, tool_name=name)
            out.append(
                ToolCall(
                    id=str(getattr(call, "id", "") or uuid.uuid4()),
                    name=name,
                    arguments=arguments,
                )
            )
        return tuple(out)


def _coerce_arguments(value: Any, *, tool_name: str) -> dict[str, Any]:
    """Accept dict-typed arguments as-is; parse strings as JSON. Raise
    ToolCallParseError on un-parseable strings so the retry helper can
    catch and retry once with a stricter format prompt."""
    if isinstance(value, dict):
        return value
    if value is None:
        return {}
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError as e:
            raise ToolCallParseError(
                f"tool call {tool_name!r} arguments failed to parse: {e}",
                tool_name=tool_name,
                raw_arguments=value,
            ) from e
        if not isinstance(parsed, dict):
            raise ToolCallParseError(
                f"tool call {tool_name!r} arguments parsed but were not "
                f"a JSON object (got {type(parsed).__name__})",
                tool_name=tool_name,
                raw_arguments=value,
            )
        return parsed
    raise ToolCallParseError(
        f"tool call {tool_name!r} arguments had unexpected type {type(value).__name__}",
        tool_name=tool_name,
        raw_arguments=repr(value),
    )


def _finish_reason(raw: Any) -> str:
    """Ollama uses `.done_reason` or absence-of-tool_calls + done=True
    to signal completion. Map to the OpenAI-ish strings the turn loop
    can switch on."""
    msg = getattr(raw, "message", None)
    if msg is not None and getattr(msg, "tool_calls", None):
        return "tool_calls"
    done_reason = getattr(raw, "done_reason", None)
    if done_reason:
        return str(done_reason)
    if getattr(raw, "done", False):
        return "stop"
    return "incomplete"


def _to_plain_dict(raw: Any) -> dict[str, Any]:
    """Convert an ollama Pydantic response into a vanilla dict for the
    audit log. The library uses pydantic v2 so .model_dump() is the
    canonical path."""
    if hasattr(raw, "model_dump"):
        try:
            out = raw.model_dump()
            if isinstance(out, dict):
                return out
        except Exception:
            pass
    if isinstance(raw, dict):
        return raw
    return {"_repr": repr(raw)}
