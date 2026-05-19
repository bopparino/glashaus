"""First-run wizard — name + disposition preset + 2-3 base values.

Smallest useful wizard per the original Phase-1 decision. Does NOT
handle API key entry (env vars only, with a one-liner pointer to fix),
channel setup (Phase 5), or ping cadence (Phase 3).

The wizard reads from stdin and writes to stdout/stderr by default but
accepts injected streams + reader for unit-testing. Output is plain
text; the banner is the §9.1 ASCII art kept terse.

Idempotency: the wizard refuses to run when self_state is already
initialized (the user has to delete `~/.glashaus/state.db` to re-run,
which is also the only way to wipe state — refusing this protects
against accidental reset).
"""

from __future__ import annotations

import os
import sys
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import TextIO

from glashaus.cli.config import DISPOSITION_PRESETS, PRESET_ORDER
from glashaus.self_state.store import SelfStateStore
from glashaus.self_state.types import (
    CurrentState,
    Disposition,
    IdentityCore,
    RelationalStance,
)

# ----------------------------------------------------------------------------
# Banner — §9.1 ASCII art, "minimal" variant.
# ----------------------------------------------------------------------------

_BANNER = """\
  ____ _           _   _
 / ___| | __ _ ___| | | | __ _ _   _ ___
| |  _| |/ _` / __| |_| |/ _` | | | / __|
| |_| | | (_| \\__ \\  _  | (_| | |_| \\__ \\
 \\____|_|\\__,_|___/_| |_|\\__,_|\\__,_|___/

 ── a personal companion ──────────────────
"""


@dataclass(frozen=True, slots=True)
class WizardResult:
    """What the wizard committed to the store."""

    name: str
    preset_key: str
    base_values: tuple[str, ...]


def run_wizard(
    *,
    self_state: SelfStateStore,
    stdin: TextIO | None = None,
    stdout: TextIO | None = None,
    stderr: TextIO | None = None,
    reader: Callable[[str], str] | None = None,
) -> WizardResult:
    """Run the first-run flow. Raises RuntimeError if already initialized.

    `reader` overrides `input()` for testability — call signature is
    `reader(prompt: str) -> str`. When None, uses `input()` against
    the provided stdin (or builtins.input() if stdin is None).
    """
    if self_state.is_initialized():
        raise RuntimeError(
            "self-state is already initialized; delete ~/.glashaus/state.db "
            "to re-run the wizard (this is intentionally hard so you don't "
            "wipe months of relational context with a typo)"
        )

    out = stdout or sys.stdout
    _ = stderr or sys.stderr  # reserved for future error reporting
    ask = reader if reader is not None else _make_reader(stdin)

    _write(out, _BANNER + "\n")
    _write(
        out,
        "First run. A few questions to anchor the agent's identity.\n"
        "These choices land in identity_core and disposition seeds — they\n"
        "drift over time but never reset. Take your time.\n\n",
    )

    name = _prompt_name(ask, out)
    preset_key = _prompt_preset(ask, out)
    base_values = _prompt_base_values(ask, out)

    _commit(self_state, name=name, preset_key=preset_key, base_values=base_values)
    _report_env(out)
    _write(
        out,
        "\nReady. `glashaus chat` to start a conversation, `glashaus self` to inspect.\n",
    )

    return WizardResult(name=name, preset_key=preset_key, base_values=base_values)


# ----------------------------------------------------------------------------
# Prompts
# ----------------------------------------------------------------------------


def _prompt_name(ask: Callable[[str], str], out: TextIO) -> str:
    _write(out, "What should the agent be called? [GlasHaus] ")
    raw = ask("").strip()
    return raw if raw else "GlasHaus"


def _prompt_preset(ask: Callable[[str], str], out: TextIO) -> str:
    _write(out, "\nPick a disposition seed:\n")
    for i, key in enumerate(PRESET_ORDER, start=1):
        preset = DISPOSITION_PRESETS[key]
        _write(out, f"  {i}. {preset['label']}\n")
        _write(
            out,
            f"     warmth={preset['warmth']}  curiosity={preset['curiosity']}  "
            f"playfulness={preset['playfulness']}\n"
            f"     reserve={preset['reserve']}  directness={preset['directness']}\n",
        )
    while True:
        _write(out, f"\nChoose 1-{len(PRESET_ORDER)} [2]: ")
        raw = ask("").strip()
        if not raw:
            return PRESET_ORDER[1]  # default: warm_and_curious
        try:
            choice = int(raw)
        except ValueError:
            _write(out, "Please enter a number.\n")
            continue
        if 1 <= choice <= len(PRESET_ORDER):
            return PRESET_ORDER[choice - 1]
        _write(out, f"Please enter 1-{len(PRESET_ORDER)}.\n")


def _prompt_base_values(ask: Callable[[str], str], out: TextIO) -> tuple[str, ...]:
    _write(
        out,
        "\nTwo or three base values to anchor identity_core.\n"
        "Short phrases like 'be honest' or 'value rest'. These rarely change.\n"
        "Empty line to finish.\n",
    )
    values: list[str] = []
    while len(values) < 5:
        _write(out, f"  value {len(values) + 1}: ")
        raw = ask("").strip()
        if not raw:
            if not values:
                # Defaults so the wizard always lands a non-empty list.
                return ("be honest", "respect autonomy")
            break
        values.append(raw)
    return tuple(values)


# ----------------------------------------------------------------------------
# Commit + environment check
# ----------------------------------------------------------------------------


def _commit(
    self_state: SelfStateStore,
    *,
    name: str,
    preset_key: str,
    base_values: tuple[str, ...],
) -> None:
    preset = DISPOSITION_PRESETS[preset_key]
    now = datetime.now(UTC)
    self_state.initialize(
        identity_core=IdentityCore(
            name=name,
            voice=str(preset["voice"]),
            base_values=base_values,
            updated_at=now,
        ),
        disposition=Disposition(
            curiosity=float(preset["curiosity"]),
            playfulness=float(preset["playfulness"]),
            reserve=float(preset["reserve"]),
            warmth=float(preset["warmth"]),
            directness=float(preset["directness"]),
            updated_at=now,
        ),
        current_state=CurrentState(
            mood="settling in",
            energy=0.5,
            preoccupations=(),
            updated_at=now,
        ),
        relational_stance=RelationalStance(
            trust=0.5,
            familiarity=0.05,
            current_warmth=0.5,
            history_markers=(),
            updated_at=now,
        ),
    )


def _report_env(out: TextIO) -> None:
    _write(out, "\nEnvironment check:\n")
    if os.environ.get("OLLAMA_API_KEY"):
        _write(out, "  OLLAMA_API_KEY: set (cloud API direct)\n")
    else:
        _write(
            out,
            "  OLLAMA_API_KEY: not set — assuming local daemon at "
            "$OLLAMA_HOST or http://localhost:11434\n",
        )
    if os.environ.get("OPENAI_API_KEY"):
        _write(out, "  OPENAI_API_KEY: set (embeddings enabled)\n")
    else:
        _write(
            out,
            "  OPENAI_API_KEY: not set — embeddings disabled (retrieval\n"
            "    falls back to FTS + temporal + affective + salience).\n"
            "    To enable: export OPENAI_API_KEY=sk-...\n",
        )


# ----------------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------------


def _make_reader(stdin: TextIO | None) -> Callable[[str], str]:
    if stdin is None:
        return input

    # `input()` doesn't accept a stream argument, so emulate.
    def _read(prompt: str) -> str:
        if prompt:
            sys.stdout.write(prompt)
            sys.stdout.flush()
        line = stdin.readline()
        # `input()` raises EOFError on closed stdin; mimic that here so
        # callers can handle both code paths the same way.
        if line == "":
            raise EOFError
        return line.rstrip("\n").rstrip("\r")

    return _read


def _write(out: TextIO, text: str) -> None:
    out.write(text)
    out.flush()
