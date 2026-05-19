"""TurnRunner: orchestrate a single chat turn end-to-end.

Flow:

1. Read current self-state (single read; no per-section round-trips).
2. Assemble system blocks via the chunk-5 cache-layout.
3. Build the messages array: conversation history + current user message.
4. Stream from the chat provider; emit text deltas to a callback as
   they arrive (user-perceived latency = generation time).
5. After StreamFinal, locate the two tool calls.
6. If `record_turn` parsing fails OR it's missing entirely, fall back
   to one non-streaming `structured_complete_with_retry` call to fetch
   valid tool calls. The streamed text from the first attempt remains
   the canonical user-facing response; the retry's text is discarded.
7. Apply `record_turn` (terminal failure raises — the turn cannot
   complete without an episodic record).
8. Apply `update_self_state` if present. Parsing or apply failures
   are logged and deferred — the episodic stands. The turn returns
   successfully with `update_applied=False` and a populated
   `update_error`.

Why `record_turn` is hard-required and `update_self_state` isn't:

- Without an episodic record, the next turn cannot retrieve continuity
  context. That's a data-integrity failure, not a UX hiccup.
- A failed self-state update means we don't drift this turn — that's
  not great, but the user still got a coherent response, and the
  episodic record lets a future turn (or a dream cycle) re-derive
  drift signals from the conversation history.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable, Sequence
from dataclasses import dataclass

from glashaus.logging import get_logger
from glashaus.memory.store import MemoryStore
from glashaus.memory.types import EpisodicMemory
from glashaus.providers.base import (
    ChatMessage,
    ChatProvider,
    ChatResponse,
    StreamFinal,
    StreamTextDelta,
    SystemBlock,
    ToolCall,
    ToolCallParseError,
    structured_complete_with_retry,
)
from glashaus.self_state.store import SelfStateStore
from glashaus.turn.apply import (
    ApplyReport,
    apply_record_turn,
    apply_self_state_update,
)
from glashaus.turn.assemble import assemble_system_blocks
from glashaus.turn.parse import (
    SelfStateUpdate,
    parse_record_turn,
    parse_update_self_state,
)
from glashaus.turn.tools import TURN_TOOLS

log = get_logger(__name__)


# ============================================================================
# I/O dataclasses
# ============================================================================


@dataclass(frozen=True, slots=True)
class TurnInput:
    """Single-turn input. `base_spec` is the agent persona block built
    by the CLI / daemon from config + plan principles. `channel` flows
    into the episodic record so retrieval can filter by channel later."""

    user_text: str
    user_id: str
    agent_id: str
    base_spec: str
    channel: str = "cli"


@dataclass(frozen=True, slots=True)
class TurnResult:
    """What happened. `episodic` is always populated on success — the
    turn does not return without writing one. `update_applied` is False
    when `update_self_state` was missing or failed (with `update_error`
    set in either case). `apply_report` carries the per-section
    breakdown when an update was attempted."""

    episodic: EpisodicMemory
    response_text: str
    update_applied: bool
    update_error: str | None
    apply_report: ApplyReport | None


# ============================================================================
# Orchestrator
# ============================================================================


class TurnRunner:
    """Glue between memory, self-state, and the chat provider.

    Construct once per session; call `run_stream` per turn.
    """

    def __init__(
        self,
        *,
        memory: MemoryStore,
        self_state: SelfStateStore,
        chat: ChatProvider,
        temperature: float = 0.7,
        max_tokens: int | None = None,
    ) -> None:
        self.memory = memory
        self.self_state = self_state
        self.chat = chat
        self.temperature = temperature
        self.max_tokens = max_tokens

    # ------------------------------------------------------------------
    # Public entry point
    # ------------------------------------------------------------------

    def run_stream(
        self,
        turn_input: TurnInput,
        history: Sequence[ChatMessage],
        *,
        on_text_delta: Callable[[str], None],
        semantic_hot_set: Sequence[object] = (),
        episodic_results: Sequence[object] = (),
    ) -> TurnResult:
        """Run one turn, streaming user-facing text to `on_text_delta`.

        `semantic_hot_set` and `episodic_results` are typed as `object`
        on purpose: the retriever (chunk 6) hasn't landed yet, so the
        turn loop accepts whatever the assembler accepts and passes it
        through. When chunk 6 lands these become concrete types again.
        """
        blocks = assemble_system_blocks(
            base_spec=turn_input.base_spec,
            self_state=self.self_state.get(),
            semantic_hot_set=semantic_hot_set,  # type: ignore[arg-type]
            episodic_results=episodic_results,  # type: ignore[arg-type]
        )
        messages = self._build_messages(history, turn_input.user_text)

        streamed_text, stream_final, stream_error = self._stream_first_attempt(
            blocks, messages, on_text_delta
        )

        record_turn_call, update_call = self._locate_tool_calls(stream_final)

        # Retry path: missing or unparseable record_turn triggers one
        # non-streaming follow-up via structured_complete_with_retry.
        # The retry's text is discarded — the user already saw the
        # streamed text from the first attempt.
        if stream_error is not None or record_turn_call is None:
            log.info(
                "turn.retry_for_tool_calls",
                stream_error=str(stream_error) if stream_error else None,
                had_record_turn=record_turn_call is not None,
            )
            retry = self._retry_for_tool_calls(blocks, messages)
            record_turn_call = _find(retry.tool_calls, "record_turn")
            # Prefer the retry's update_self_state if the first attempt
            # didn't yield one.
            if update_call is None:
                update_call = _find(retry.tool_calls, "update_self_state")

        if record_turn_call is None:
            raise RuntimeError(
                "record_turn was not emitted, even after retry. "
                "Cannot complete this turn — no episodic record."
            )

        # record_turn is terminal-failure on parse: re-parse failure
        # here means even the retry got it wrong. We raise rather than
        # write a malformed episodic.
        try:
            record = parse_record_turn(record_turn_call.arguments)
        except ToolCallParseError as e:
            log.error("turn.record_turn_parse_failed", error=str(e))
            raise

        # Cross-tool turn_id consistency check. The spec calls for
        # shared turn_id between record_turn and update_self_state for
        # dedup across retries. A mismatch is suspicious enough to log,
        # not fatal in Phase 1.
        update_parsed: SelfStateUpdate | None = None
        update_error: str | None = None
        if update_call is not None:
            try:
                update_parsed = parse_update_self_state(update_call.arguments)
                if update_parsed.turn_id != record.turn_id:
                    log.warning(
                        "turn.turn_id_mismatch",
                        record_turn_id=record.turn_id,
                        update_turn_id=update_parsed.turn_id,
                    )
            except ToolCallParseError as e:
                # update_self_state failure is non-terminal — log,
                # defer, don't fail the turn.
                update_error = f"parse failed: {e}"
                log.warning("turn.update_self_state_parse_failed", error=str(e))
        else:
            update_error = "update_self_state was not emitted"
            log.warning("turn.update_self_state_missing")

        # Episodic write — terminal-failure if this raises.
        episodic = apply_record_turn(
            record,
            user_id=turn_input.user_id,
            agent_id=turn_input.agent_id,
            channel=turn_input.channel,
            memory=self.memory,
        )

        # Self-state apply — best-effort.
        apply_report: ApplyReport | None = None
        update_applied = False
        if update_parsed is not None:
            try:
                apply_report = apply_self_state_update(
                    update_parsed,
                    self_state=self.self_state,
                    trigger_episodic_id=episodic.id,
                )
                update_applied = True
                if apply_report.errors:
                    log.warning(
                        "turn.update_self_state_partial",
                        errors=list(apply_report.errors),
                    )
            except Exception as e:
                update_error = f"apply failed: {e}"
                log.warning("turn.update_self_state_apply_failed", error=str(e))

        return TurnResult(
            episodic=episodic,
            response_text=streamed_text,
            update_applied=update_applied,
            update_error=update_error,
            apply_report=apply_report,
        )

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    def _build_messages(self, history: Sequence[ChatMessage], user_text: str) -> list[ChatMessage]:
        return [*history, ChatMessage(role="user", content=user_text)]

    def _stream_first_attempt(
        self,
        blocks: Sequence[SystemBlock],
        messages: Sequence[ChatMessage],
        on_text_delta: Callable[[str], None],
    ) -> tuple[str, ChatResponse | None, ToolCallParseError | None]:
        """Stream the first attempt, accumulating text deltas through
        the callback. Catches ToolCallParseError raised during the
        final-event extraction so the caller can fall back to the
        retry path; any other exception propagates."""
        text_chunks: list[str] = []
        final: ChatResponse | None = None
        try:
            for event in self.chat.stream(
                system_blocks=blocks,
                messages=messages,
                tools=TURN_TOOLS,
                temperature=self.temperature,
                max_tokens=self.max_tokens,
            ):
                if isinstance(event, StreamTextDelta):
                    text_chunks.append(event.delta)
                    on_text_delta(event.delta)
                elif isinstance(event, StreamFinal):
                    final = event.response
        except ToolCallParseError as e:
            return "".join(text_chunks), None, e
        return "".join(text_chunks), final, None

    def _retry_for_tool_calls(
        self,
        blocks: Sequence[SystemBlock],
        messages: Sequence[ChatMessage],
    ) -> ChatResponse:
        """One non-streaming complete() with the strict-JSON nudge
        block injected via `structured_complete_with_retry`. The text
        from this attempt is discarded by the caller."""
        return structured_complete_with_retry(
            self.chat,
            system_blocks=blocks,
            messages=messages,
            tools=TURN_TOOLS,
            temperature=self.temperature,
            max_tokens=self.max_tokens,
        )

    def _locate_tool_calls(
        self, response: ChatResponse | None
    ) -> tuple[ToolCall | None, ToolCall | None]:
        if response is None:
            return None, None
        return (
            _find(response.tool_calls, "record_turn"),
            _find(response.tool_calls, "update_self_state"),
        )


def _find(calls: Sequence[ToolCall], name: str) -> ToolCall | None:
    """First tool call by name. Phase 1 doesn't care about multiple
    same-named calls (parallel tool use of the *same* tool is unusual);
    we'd just process the first one."""
    for call in calls:
        if call.name == name:
            return call
    return None


# Stable turn_id generator for callers that want one before calling
# the model (e.g. tests that pre-mint an id for assertions).
def new_turn_id() -> str:
    return str(uuid.uuid4())
