"""Tests for the CLI layer.

Covers:
- Wizard happy path with injected stdin; refuses on second run.
- format_self_state / format_episodic_* output shape.
- `glashaus self` returns 1 when uninit, 0 with formatted output.
- `glashaus memory search` empty DB + populated DB.
- `glashaus memory inspect` with missing + valid id.
- `glashaus chat` end-to-end with a fake runner: wizard runs on first
  invocation, then a single turn flows through, episodic lands,
  self-state updates.
- argparse routing.

`GLASHAUS_STATE_DIR` env var is set to a tmp_path in every test that
touches the state DB so we never collide with the user's real ~/.glashaus.
"""

from __future__ import annotations

import io
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest

from glashaus.cli import main as cli_main
from glashaus.cli.chat_cmd import run_chat
from glashaus.cli.config import DISPOSITION_PRESETS, PRESET_ORDER, render_base_spec
from glashaus.cli.format import (
    format_episodic_brief,
    format_episodic_full,
    format_episodic_search_results,
    format_self_state,
    format_semantic_search_results,
)
from glashaus.cli.inspect_cmd import run_memory_inspect, run_memory_search, run_self
from glashaus.cli.main import build_parser
from glashaus.cli.wizard import WizardResult, run_wizard
from glashaus.memory import Affect, MemoryStore
from glashaus.memory.types import EpisodicMemory
from glashaus.self_state.store import SelfStateStore
from glashaus.self_state.types import (
    CurrentState,
    Disposition,
    FormedOpinion,
    IdentityCore,
    Quirk,
    RelationalStance,
    SelfState,
)
from glashaus.storage import MigrationRunner, connect, open_state_db
from glashaus.turn.loop import TurnInput, TurnResult

# ============================================================================
# Fixtures
# ============================================================================


@pytest.fixture
def state_dir(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Path:
    """Sandbox the state DB into tmp_path. The factories in storage.db
    honor GLASHAUS_STATE_DIR; tests just need to set it."""
    monkeypatch.setenv("GLASHAUS_STATE_DIR", str(tmp_path))
    return tmp_path


@pytest.fixture
def initialized_state(state_dir: Path) -> Iterator[None]:
    """Bring up a state DB with a seeded SelfState — fixture for the
    inspect-command tests that need a populated store."""
    conn = open_state_db()
    MigrationRunner(conn).apply_all()
    ss = SelfStateStore(conn)
    now = datetime.now(UTC)
    ss.initialize(
        identity_core=IdentityCore(
            name="GlasHaus",
            voice="warm, curious, present",
            base_values=("be honest", "respect autonomy"),
            updated_at=now,
        ),
        disposition=Disposition(
            curiosity=0.8,
            playfulness=0.55,
            reserve=0.35,
            warmth=0.75,
            directness=0.55,
            updated_at=now,
        ),
        current_state=CurrentState(
            mood="settling in", energy=0.5, preoccupations=(), updated_at=now
        ),
        relational_stance=RelationalStance(
            trust=0.5,
            familiarity=0.05,
            current_warmth=0.5,
            history_markers=(),
            updated_at=now,
        ),
    )
    conn.close()
    yield


# ============================================================================
# format.py — pure formatters
# ============================================================================


def _seed_self_state() -> SelfState:
    now = datetime(2026, 5, 19, 19, 0, 0, tzinfo=UTC)
    return SelfState(
        identity_core=IdentityCore(
            name="GlasHaus",
            voice="warm and dry",
            base_values=("be honest", "respect autonomy"),
            updated_at=now,
        ),
        disposition=Disposition(
            curiosity=0.65,
            playfulness=0.5,
            reserve=0.4,
            warmth=0.6,
            directness=0.55,
            updated_at=now,
        ),
        current_state=CurrentState(
            mood="curious",
            energy=0.7,
            preoccupations=("the thesis",),
            updated_at=now,
        ),
        relational_stance=RelationalStance(
            trust=0.5,
            familiarity=0.3,
            current_warmth=0.55,
            history_markers=("first deep chat",),
            updated_at=now,
        ),
        formed_opinions=(
            FormedOpinion(
                id="op-1",
                claim="austin works late",
                formed_at=now,
                evidence_ids=("ep-x",),
            ),
        ),
        quirks=(
            Quirk(
                id="q-1",
                pattern="answers with questions",
                observed_count=3,
                first_seen=now,
                last_seen=now,
            ),
        ),
    )


def test_format_self_state_includes_all_sections() -> None:
    out = format_self_state(_seed_self_state())
    assert "identity_core" in out
    assert "GlasHaus" in out
    assert "be honest" in out
    assert "disposition" in out
    assert "curiosity:    0.65" in out
    assert "current_state" in out
    assert "the thesis" in out
    assert "relational_stance" in out
    assert "first deep chat" in out
    assert "formed_opinions" in out
    assert "austin works late" in out
    assert "quirks" in out
    assert "answers with questions" in out


def test_format_self_state_handles_empty_lists() -> None:
    """Defaults / empties shouldn't crash or render blank lines."""
    now = datetime.now(UTC)
    minimal = SelfState(
        identity_core=IdentityCore(name="GH", voice="v", base_values=(), updated_at=now),
        disposition=Disposition(
            curiosity=0.5,
            playfulness=0.5,
            reserve=0.5,
            warmth=0.5,
            directness=0.5,
            updated_at=now,
        ),
        current_state=CurrentState(mood="m", energy=0.5, preoccupations=(), updated_at=now),
        relational_stance=RelationalStance(
            trust=0.5,
            familiarity=0.5,
            current_warmth=0.5,
            history_markers=(),
            updated_at=now,
        ),
    )
    out = format_self_state(minimal)
    assert "(none)" in out  # base_values, preoccupations, history_markers
    assert "(none yet)" in out  # opinions, quirks


def _seed_ep(content: str = "austin said hi", **kw: Any) -> EpisodicMemory:
    return EpisodicMemory(
        id=kw.pop("id", "ep-test"),
        ts=datetime(2026, 5, 19, 12, 0, 0, tzinfo=UTC),
        content=content,
        user_id="austin",
        agent_id="glashaus",
        affect=Affect(
            valence=float(kw.pop("valence", 0.3)),
            arousal=float(kw.pop("arousal", 0.5)),
            dominant_emotion=str(kw.pop("dominant_emotion", "warm")),
        ),
        salience=float(kw.pop("salience", 0.6)),
        topics=tuple(kw.pop("topics", ())),
        references=tuple(kw.pop("references", ())),
        channel=str(kw.pop("channel", "cli")),
        has_embedding=bool(kw.pop("has_embedding", False)),
    )


def test_format_episodic_brief_truncates_long_content() -> None:
    ep = _seed_ep(content="x" * 200)
    out = format_episodic_brief(ep)
    assert "..." in out
    assert len(out.splitlines()[1].lstrip()) <= 80 + 3  # 80 + "..."


def test_format_episodic_full_includes_all_fields() -> None:
    ep = _seed_ep(topics=("thesis", "evening"), references=("ep-prev",))
    out = format_episodic_full(ep)
    assert "ep-test" in out
    assert "thesis" in out
    assert "ep-prev" in out
    assert "valence:           +0.300" in out  # signed format
    assert "has_embedding: False" in out


def test_format_episodic_search_results_pluralizes() -> None:
    one = format_episodic_search_results([_seed_ep()])
    many = format_episodic_search_results([_seed_ep(id="ep-1"), _seed_ep(id="ep-2")])
    assert "1 episodic result:" in one
    assert "2 episodic results:" in many


def test_format_episodic_search_results_empty() -> None:
    assert format_episodic_search_results([]) == "(no episodic results)"


def test_format_semantic_search_results_empty() -> None:
    assert format_semantic_search_results([]) == "(no semantic results)"


# ============================================================================
# config.py — base_spec rendering
# ============================================================================


def test_render_base_spec_includes_name_and_values() -> None:
    spec = render_base_spec(
        name="GlasHaus",
        voice="warm, dry",
        base_values=("be honest", "respect autonomy"),
        channel="cli",
    )
    assert "GlasHaus" in spec
    assert "warm, dry" in spec
    assert "be honest" in spec
    assert "respect autonomy" in spec
    assert "Channel: cli" in spec


def test_render_base_spec_handles_empty_base_values() -> None:
    spec = render_base_spec(name="GlasHaus", voice="v", base_values=(), channel="cli")
    assert "(none recorded)" in spec


def test_preset_order_matches_preset_dict_keys() -> None:
    assert set(PRESET_ORDER) == set(DISPOSITION_PRESETS.keys())


# ============================================================================
# wizard.py
# ============================================================================


class _ScriptedReader:
    """`input()`-shape callable backed by a list of canned responses."""

    def __init__(self, responses: list[str]) -> None:
        self._responses = list(responses)
        self.prompts: list[str] = []

    def __call__(self, prompt: str) -> str:
        self.prompts.append(prompt)
        if not self._responses:
            raise EOFError
        return self._responses.pop(0)


def _new_self_state_store() -> tuple[SelfStateStore, Any]:
    conn = connect(":memory:")
    MigrationRunner(conn).apply_all()
    return SelfStateStore(conn), conn


def test_wizard_happy_path_initializes_state() -> None:
    ss, _ = _new_self_state_store()
    out = io.StringIO()
    reader = _ScriptedReader(
        [
            "GlasHaus",  # name
            "2",  # preset: warm_and_curious
            "be honest",
            "respect autonomy",
            "",  # done
        ]
    )
    result = run_wizard(self_state=ss, stdout=out, reader=reader)
    assert isinstance(result, WizardResult)
    assert result.name == "GlasHaus"
    assert result.preset_key == "warm_and_curious"
    assert result.base_values == ("be honest", "respect autonomy")
    assert ss.is_initialized()
    state = ss.get()
    assert state.disposition.warmth == DISPOSITION_PRESETS["warm_and_curious"]["warmth"]


def test_wizard_empty_name_defaults_to_glashaus() -> None:
    ss, _ = _new_self_state_store()
    out = io.StringIO()
    reader = _ScriptedReader(["", "2", ""])  # empty name, preset 2, default values
    result = run_wizard(self_state=ss, stdout=out, reader=reader)
    assert result.name == "GlasHaus"


def test_wizard_empty_preset_defaults_to_warm_and_curious() -> None:
    ss, _ = _new_self_state_store()
    out = io.StringIO()
    reader = _ScriptedReader(["X", "", ""])  # any name, empty preset
    result = run_wizard(self_state=ss, stdout=out, reader=reader)
    assert result.preset_key == "warm_and_curious"


def test_wizard_invalid_preset_retries() -> None:
    ss, _ = _new_self_state_store()
    out = io.StringIO()
    reader = _ScriptedReader(["X", "not-a-number", "99", "3", ""])
    result = run_wizard(self_state=ss, stdout=out, reader=reader)
    assert result.preset_key == "sharp_and_dry"
    assert "Please enter a number" in out.getvalue()


def test_wizard_empty_values_uses_defaults() -> None:
    ss, _ = _new_self_state_store()
    out = io.StringIO()
    reader = _ScriptedReader(["X", "2", ""])  # empty on first value prompt
    result = run_wizard(self_state=ss, stdout=out, reader=reader)
    assert result.base_values == ("be honest", "respect autonomy")


def test_wizard_refuses_on_second_run() -> None:
    ss, _ = _new_self_state_store()
    out = io.StringIO()
    run_wizard(
        self_state=ss,
        stdout=out,
        reader=_ScriptedReader(["X", "2", ""]),
    )
    with pytest.raises(RuntimeError, match="already initialized"):
        run_wizard(
            self_state=ss,
            stdout=out,
            reader=_ScriptedReader(["Y", "1", ""]),
        )


def test_wizard_caps_at_five_base_values() -> None:
    ss, _ = _new_self_state_store()
    out = io.StringIO()
    # Six values supplied — only first five should land, sixth ignored.
    reader = _ScriptedReader(["X", "2", "a", "b", "c", "d", "e", "f"])
    result = run_wizard(self_state=ss, stdout=out, reader=reader)
    assert result.base_values == ("a", "b", "c", "d", "e")


# ============================================================================
# inspect_cmd.py — `glashaus self`
# ============================================================================


def test_run_self_returns_1_when_uninitialized(state_dir: Path) -> None:
    out = io.StringIO()
    rc = run_self(argparse_namespace(), stdout=out)
    assert rc == 1
    assert "not initialized" in out.getvalue()


def test_run_self_prints_state_when_initialized(initialized_state: None) -> None:
    out = io.StringIO()
    rc = run_self(argparse_namespace(), stdout=out)
    assert rc == 0
    body = out.getvalue()
    assert "GlasHaus self-state" in body
    assert "warmth:       0.75" in body


# ============================================================================
# inspect_cmd.py — `glashaus memory search` and `inspect`
# ============================================================================


def test_run_memory_search_empty_db(state_dir: Path) -> None:
    out = io.StringIO()
    rc = run_memory_search(argparse_namespace(query="anything", limit=10), stdout=out)
    assert rc == 0
    body = out.getvalue()
    assert "(no episodic results)" in body
    assert "(no semantic results)" in body


def test_run_memory_search_returns_matches(state_dir: Path) -> None:
    conn = open_state_db()
    MigrationRunner(conn).apply_all()
    memory = MemoryStore(conn)
    memory.write_episodic(
        content="austin asked about his thesis defense",
        user_id="austin",
        agent_id="gh",
        affect=Affect(valence=0.2, arousal=0.5, dominant_emotion="warm"),
        salience=0.7,
        topics=("thesis",),
    )
    conn.close()

    out = io.StringIO()
    rc = run_memory_search(argparse_namespace(query="thesis", limit=5), stdout=out)
    assert rc == 0
    assert "austin asked about his thesis" in out.getvalue()


def test_run_memory_inspect_missing_id_returns_1(state_dir: Path) -> None:
    out = io.StringIO()
    rc = run_memory_inspect(argparse_namespace(id="does-not-exist"), stdout=out)
    assert rc == 1
    assert "No episodic with id" in out.getvalue()


def test_run_memory_inspect_found(state_dir: Path) -> None:
    conn = open_state_db()
    MigrationRunner(conn).apply_all()
    memory = MemoryStore(conn)
    ep = memory.write_episodic(
        content="something specific",
        user_id="austin",
        agent_id="gh",
        affect=Affect(valence=0.0, arousal=0.3, dominant_emotion="neutral"),
        salience=0.5,
    )
    conn.close()

    out = io.StringIO()
    rc = run_memory_inspect(argparse_namespace(id=ep.id), stdout=out)
    assert rc == 0
    body = out.getvalue()
    assert ep.id in body
    assert "something specific" in body


# ============================================================================
# argparse routing
# ============================================================================


def test_main_no_args_prints_help_and_returns_zero(capsys: pytest.CaptureFixture[str]) -> None:
    rc = cli_main([])
    assert rc == 0
    out = capsys.readouterr().out
    assert "glashaus" in out.lower()


def test_main_version_flag(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as excinfo:
        cli_main(["--version"])
    assert excinfo.value.code == 0


def test_main_self_command_routes_to_run_self(state_dir: Path) -> None:
    """End-to-end: argparse -> dispatch -> run_self. Uninitialized state
    -> exit code 1."""
    rc = cli_main(["self"])
    assert rc == 1


def test_main_memory_search_command_routes(state_dir: Path) -> None:
    """End-to-end argparse routing for `memory search`."""
    rc = cli_main(["memory", "search", "anything"])
    assert rc == 0


def test_main_memory_without_subcommand_returns_usage() -> None:
    rc = cli_main(["memory"])
    assert rc == 2


def test_parser_chat_has_model_and_temperature_flags() -> None:
    parser = build_parser()
    # The chat subparser should accept --model and --temperature.
    args = parser.parse_args(["chat", "--model", "x", "--temperature", "0.1"])
    assert args.model == "x"
    assert args.temperature == 0.1


# ============================================================================
# chat_cmd.py — end-to-end with a fake runner
# ============================================================================


class _FakeTurnRunner:
    """Minimal stand-in. Records calls and returns canned TurnResults.

    Each run_stream invocation writes a real EpisodicMemory via the
    provided MemoryStore so subsequent runs / restarts see continuity
    (the test that exercises restart-and-resume relies on this).
    """

    def __init__(self, memory: MemoryStore, self_state: SelfStateStore) -> None:
        self.memory = memory
        self.self_state = self_state
        self.calls: list[TurnInput] = []

    def run_stream(
        self,
        turn_input: TurnInput,
        history: Any,
        *,
        on_text_delta: Any,
        on_status: Any = None,
        seed_episodic_ids: Any = (),
    ) -> TurnResult:
        self.calls.append(turn_input)
        on_text_delta("hello back")
        ep = self.memory.write_episodic(
            content=f"agent processed: {turn_input.user_text}",
            user_id=turn_input.user_id,
            agent_id=turn_input.agent_id,
            affect=Affect(valence=0.1, arousal=0.3, dominant_emotion="warm"),
            salience=0.5,
            channel=turn_input.channel,
        )
        return TurnResult(
            episodic=ep,
            response_text="hello back",
            update_applied=False,
            update_error="(test runner skips self-state)",
            apply_report=None,
        )


def test_chat_runs_wizard_on_first_invocation_then_one_turn(
    state_dir: Path,
) -> None:
    """First-run path: wizard prompts, then chat does one turn from the
    injected stdin, then EOF exits."""
    stdin = io.StringIO(
        "GlasHaus\n"  # wizard: name
        "2\n"  # wizard: preset
        "\n"  # wizard: empty -> default base_values
        "hello\n"  # chat: first turn
        # EOF -> chat loop exits
    )
    stdout = io.StringIO()

    fakes: list[_FakeTurnRunner] = []

    def factory(memory: MemoryStore, ss: SelfStateStore, model: str, temp: float) -> Any:
        runner = _FakeTurnRunner(memory, ss)
        fakes.append(runner)
        return runner

    import argparse as _argparse

    args = _argparse.Namespace(model=None, temperature=None)
    rc = run_chat(
        args,
        runner_factory=factory,
        stdin=stdin,
        stdout=stdout,
    )
    assert rc == 0
    assert len(fakes) == 1
    assert len(fakes[0].calls) == 1
    assert fakes[0].calls[0].user_text == "hello"

    output = stdout.getvalue()
    assert "First run" in output or "running first-run setup" in output
    assert "hello back" in output


def test_chat_restart_preserves_self_state_and_memory(state_dir: Path) -> None:
    """Success criterion from §13 Phase 1: run chat, exit, restart,
    have continuity. We verify the persisted state survives across
    two run_chat invocations against the same state_dir."""
    import argparse as _argparse

    args = _argparse.Namespace(model=None, temperature=None)

    # First invocation: wizard + one turn.
    stdin1 = io.StringIO("Continuity\n2\n\nfirst message\n")
    stdout1 = io.StringIO()

    def factory(memory: MemoryStore, ss: SelfStateStore, model: str, temp: float) -> Any:
        return _FakeTurnRunner(memory, ss)

    run_chat(args, runner_factory=factory, stdin=stdin1, stdout=stdout1)

    # Second invocation: wizard should NOT run (state exists), another turn.
    stdin2 = io.StringIO("second message\n")
    stdout2 = io.StringIO()
    run_chat(args, runner_factory=factory, stdin=stdin2, stdout=stdout2)

    out2 = stdout2.getvalue()
    assert "First run" not in out2  # wizard skipped
    assert "running first-run setup" not in out2

    # Self-state from the wizard's name choice persisted.
    conn = open_state_db()
    MigrationRunner(conn).apply_all()
    state = SelfStateStore(conn).get()
    assert state.identity_core.name == "Continuity"
    # Both turns landed episodic records.
    memory_count = conn.execute("SELECT COUNT(*) AS n FROM episodic").fetchone()
    assert memory_count["n"] == 2
    conn.close()


def test_chat_exit_command_leaves_loop(state_dir: Path) -> None:
    """`/exit` typed at the prompt drops out of the loop."""
    import argparse as _argparse

    # Pre-initialize so we skip the wizard.
    conn = open_state_db()
    MigrationRunner(conn).apply_all()
    ss = SelfStateStore(conn)
    now = datetime.now(UTC)
    ss.initialize(
        identity_core=IdentityCore(name="GH", voice="v", base_values=(), updated_at=now),
        disposition=Disposition(
            curiosity=0.5,
            playfulness=0.5,
            reserve=0.5,
            warmth=0.5,
            directness=0.5,
            updated_at=now,
        ),
        current_state=CurrentState(mood="m", energy=0.5, preoccupations=(), updated_at=now),
        relational_stance=RelationalStance(
            trust=0.5,
            familiarity=0.5,
            current_warmth=0.5,
            history_markers=(),
            updated_at=now,
        ),
    )
    conn.close()

    args = _argparse.Namespace(model=None, temperature=None)
    stdin = io.StringIO("/exit\n")
    stdout = io.StringIO()

    def factory(memory: MemoryStore, ss: SelfStateStore, model: str, temp: float) -> Any:
        return _FakeTurnRunner(memory, ss)

    rc = run_chat(args, runner_factory=factory, stdin=stdin, stdout=stdout)
    assert rc == 0


def test_chat_help_command_prints_help_without_calling_runner(
    state_dir: Path,
) -> None:
    """Slash commands don't consume LLM turns."""
    import argparse as _argparse

    conn = open_state_db()
    MigrationRunner(conn).apply_all()
    ss = SelfStateStore(conn)
    now = datetime.now(UTC)
    ss.initialize(
        identity_core=IdentityCore(name="GH", voice="v", base_values=(), updated_at=now),
        disposition=Disposition(
            curiosity=0.5,
            playfulness=0.5,
            reserve=0.5,
            warmth=0.5,
            directness=0.5,
            updated_at=now,
        ),
        current_state=CurrentState(mood="m", energy=0.5, preoccupations=(), updated_at=now),
        relational_stance=RelationalStance(
            trust=0.5,
            familiarity=0.5,
            current_warmth=0.5,
            history_markers=(),
            updated_at=now,
        ),
    )
    conn.close()

    args = _argparse.Namespace(model=None, temperature=None)
    stdin = io.StringIO("/help\n/exit\n")
    stdout = io.StringIO()

    fakes: list[_FakeTurnRunner] = []

    def factory(memory: MemoryStore, ss: SelfStateStore, model: str, temp: float) -> Any:
        runner = _FakeTurnRunner(memory, ss)
        fakes.append(runner)
        return runner

    rc = run_chat(args, runner_factory=factory, stdin=stdin, stdout=stdout)
    assert rc == 0
    # /help printed something; /exit broke the loop. No runner call.
    assert "leave the chat" in stdout.getvalue()
    assert len(fakes[0].calls) == 0


def test_chat_recovers_from_turn_error_and_continues(state_dir: Path) -> None:
    """A failing turn surfaces the error to the user but does NOT crash
    the chat loop — the next prompt is still served."""
    import argparse as _argparse

    conn = open_state_db()
    MigrationRunner(conn).apply_all()
    ss = SelfStateStore(conn)
    now = datetime.now(UTC)
    ss.initialize(
        identity_core=IdentityCore(name="GH", voice="v", base_values=(), updated_at=now),
        disposition=Disposition(
            curiosity=0.5,
            playfulness=0.5,
            reserve=0.5,
            warmth=0.5,
            directness=0.5,
            updated_at=now,
        ),
        current_state=CurrentState(mood="m", energy=0.5, preoccupations=(), updated_at=now),
        relational_stance=RelationalStance(
            trust=0.5,
            familiarity=0.5,
            current_warmth=0.5,
            history_markers=(),
            updated_at=now,
        ),
    )
    conn.close()

    class _ExplodingRunner:
        def __init__(self) -> None:
            self.call_count = 0

        def run_stream(self, *args_: Any, **kwargs: Any) -> TurnResult:
            self.call_count += 1
            if self.call_count == 1:
                raise RuntimeError("provider unreachable")
            on_text_delta = kwargs["on_text_delta"]
            on_text_delta("recovered")
            # Build a minimal valid TurnResult; tests are checking flow.
            conn2 = open_state_db()
            ep = MemoryStore(conn2).write_episodic(
                content="recovered turn",
                user_id="austin",
                agent_id="gh",
                affect=Affect(valence=0.0, arousal=0.0, dominant_emotion="neutral"),
                salience=0.3,
            )
            conn2.close()
            return TurnResult(
                episodic=ep,
                response_text="recovered",
                update_applied=False,
                update_error=None,
                apply_report=None,
            )

    runner_instance = _ExplodingRunner()

    def factory(*_: Any, **__: Any) -> Any:
        return runner_instance

    args = _argparse.Namespace(model=None, temperature=None)
    stdin = io.StringIO("first\nsecond\n/exit\n")
    stdout = io.StringIO()

    rc = run_chat(args, runner_factory=factory, stdin=stdin, stdout=stdout)
    assert rc == 0
    out = stdout.getvalue()
    assert "turn failed" in out  # first turn surfaced the error
    assert "recovered" in out  # second turn succeeded


# ============================================================================
# small helpers
# ============================================================================


def argparse_namespace(**kw: Any) -> Any:
    import argparse as _argparse

    return _argparse.Namespace(**kw)
