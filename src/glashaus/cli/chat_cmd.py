"""`glashaus chat` — interactive streaming chat session.

Loop:
1. Open the state DB; auto-run the wizard if uninitialized.
2. Build a TurnRunner with the configured chat provider, embedder
   (if OPENAI_API_KEY is set), and HybridRetriever.
3. REPL: read a line from stdin, run a turn, stream the assistant
   text back, loop. `/exit` or `/quit` or EOF leaves the loop.

In-session conversation history is kept in memory (a list of
ChatMessage). Cross-session continuity comes from the retriever
surfacing past episodic + semantic records — the literal transcript
does NOT replay across sessions, by design.

Construction is split into a factory so tests can substitute fakes:
`build_runner` returns the TurnRunner that the loop will use. The
default factory wires Ollama + (optional) OpenAI + HybridRetriever.
"""

from __future__ import annotations

import argparse
import os
import sys
from collections.abc import Callable
from typing import TextIO

from glashaus.cli.config import (
    DEFAULT_OLLAMA_MODEL,
    DEFAULT_TEMPERATURE,
    render_base_spec,
)
from glashaus.cli.wizard import run_wizard
from glashaus.logging import configure_logging
from glashaus.memory.store import MemoryStore
from glashaus.providers.base import ChatMessage, ChatProvider, EmbeddingProvider
from glashaus.providers.ollama_chat import OllamaChatProvider
from glashaus.providers.openai_embed import OpenAIEmbeddingProvider
from glashaus.retrieval.retriever import HybridRetriever
from glashaus.self_state.store import SelfStateStore
from glashaus.storage import open_state_db
from glashaus.storage.runner import MigrationRunner
from glashaus.turn.loop import TurnInput, TurnRunner

# Sentinel strings the user can type to leave.
_EXIT_COMMANDS: frozenset[str] = frozenset({"/exit", "/quit"})
_HELP_COMMAND: str = "/help"

# Builder hook so tests can inject fakes.
RunnerFactory = Callable[
    [MemoryStore, SelfStateStore, str, float],
    TurnRunner,
]


def _default_runner_factory(
    memory: MemoryStore,
    self_state: SelfStateStore,
    model: str,
    temperature: float,
) -> TurnRunner:
    """Real-provider factory used in normal CLI invocation."""
    chat: ChatProvider = OllamaChatProvider(model=model)
    embedder: EmbeddingProvider | None = None
    if os.environ.get("OPENAI_API_KEY"):
        embedder = OpenAIEmbeddingProvider()
    retriever = HybridRetriever(memory.conn)
    return TurnRunner(
        memory=memory,
        self_state=self_state,
        chat=chat,
        retriever=retriever,
        embedder=embedder,
        temperature=temperature,
    )


def run_chat(
    args: argparse.Namespace,
    *,
    runner_factory: RunnerFactory | None = None,
    stdin: TextIO | None = None,
    stdout: TextIO | None = None,
    reader: Callable[[str], str] | None = None,
) -> int:
    """Entry point invoked by argparse dispatch.

    `runner_factory` swap point for tests. Default uses real Ollama +
    OpenAI providers.
    """
    # Quiet structured logging during interactive chat. WARNING and
    # below carry the same information the on_status callback and
    # `[self-state deferred: ...]` surfacing already provide — and
    # rendering them as raw `turn.record_turn_schema_failed` lines
    # mid-conversation is jarring. ERROR-level events still appear
    # for genuine failures the user should see. File-based audit
    # trail for thesis-time analysis is a later phase.
    configure_logging(level="ERROR")

    factory = runner_factory or _default_runner_factory
    out = stdout or sys.stdout
    ask = reader if reader is not None else _make_reader(stdin)

    conn = open_state_db()
    MigrationRunner(conn).apply_all()
    memory = MemoryStore(conn)
    self_state = SelfStateStore(conn)

    if not self_state.is_initialized():
        out.write("No state DB yet — running first-run setup.\n\n")
        out.flush()
        run_wizard(
            self_state=self_state,
            stdin=stdin,
            stdout=out,
            reader=reader,
        )
        out.write("\n")

    model = getattr(args, "model", None) or DEFAULT_OLLAMA_MODEL
    temperature = getattr(args, "temperature", None) or DEFAULT_TEMPERATURE
    runner = factory(memory, self_state, model, temperature)

    state = self_state.get()
    base_spec = render_base_spec(
        name=state.identity_core.name,
        voice=state.identity_core.voice,
        base_values=state.identity_core.base_values,
        channel="cli",
    )

    out.write(
        f"{state.identity_core.name}. Model: {model}. Type /exit to leave, /help for commands.\n\n"
    )
    out.flush()

    history: list[ChatMessage] = []
    while True:
        try:
            user_text = ask("you> ").strip()
        except (EOFError, KeyboardInterrupt):
            out.write("\n")
            break
        if not user_text:
            continue
        if user_text in _EXIT_COMMANDS:
            break
        if user_text == _HELP_COMMAND:
            _print_help(out)
            continue

        turn_input = TurnInput(
            user_text=user_text,
            user_id="austin",  # Phase 1: single-user; Phase 6 wires multi-user
            agent_id=state.identity_core.name,
            base_spec=base_spec,
            channel="cli",
        )

        out.write(f"{state.identity_core.name}> ")
        out.flush()

        def status_notice(msg: str) -> None:
            out.write(f"\n[{msg}]\n")
            out.flush()

        try:
            result = runner.run_stream(
                turn_input,
                history=history,
                on_text_delta=lambda d: _write_delta(out, d),
                on_status=status_notice,
            )
        except Exception as e:
            out.write(f"\n[turn failed: {e}]\n\n")
            out.flush()
            continue

        out.write("\n")
        if result.update_error and not result.update_applied:
            out.write(f"[self-state deferred: {result.update_error}]\n")
        out.write("\n")
        out.flush()

        history.append(ChatMessage(role="user", content=user_text))
        history.append(ChatMessage(role="assistant", content=result.response_text))

    conn.close()
    return 0


def _print_help(out: TextIO) -> None:
    out.write("/exit, /quit    leave the chat\n/help           this list\n\n")
    out.flush()


def _write_delta(out: TextIO, delta: str) -> None:
    out.write(delta)
    out.flush()


def _make_reader(stdin: TextIO | None) -> Callable[[str], str]:
    """Same shape as wizard._make_reader, factored locally so chat
    doesn't reach into the wizard module."""
    if stdin is None:
        return input

    def _read(prompt: str) -> str:
        if prompt:
            sys.stdout.write(prompt)
            sys.stdout.flush()
        line = stdin.readline()
        if line == "":
            raise EOFError
        return line.rstrip("\n").rstrip("\r")

    return _read
