"""Build the system-block array per the chunk 5 cache-block layout.

Twelve canonical positions. Positions 11 and 12 (conversation history
and the current user message) belong in the `messages=` argument, not
the system blocks — so this function returns positions 1-10.

Cache breakpoints are placed at positions 2 (end of base+tools-overview),
3 (end of identity_core), and 6 (end of the slow-drift identity layer
including disposition / opinions / quirks). TTL is 1 hour = 3600s.

Provider-side behavior:

- Anthropic adapter (Phase 4): emits `cache_control` markers at the
  breakpoint blocks. Blocks between breakpoints share the cached
  prefix above.
- Ollama (Phase 1): concatenates all blocks as plain text. Markers are
  ignored, but the assembly order is still meaningful — putting stable
  content first ensures the most expensive context is at the top of
  the prompt where models attend most.

This module is pure: takes a SelfState and optional retrieved memory,
returns a list of SystemBlocks. No I/O, no provider calls.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Final

from glashaus.memory.types import EpisodicMemory, SemanticMemory
from glashaus.providers.base import SystemBlock
from glashaus.self_state.types import (
    CurrentState,
    Disposition,
    FormedOpinion,
    IdentityCore,
    Quirk,
    RelationalStance,
    SelfState,
)

# TTL constant for all three breakpoints. 1 hour matches the chunk 5
# spec; configurable later via the chat config.
CACHE_TTL_SECONDS: Final[int] = 3600

# Text shown in the tool-overview block. The actual tool schemas go
# via the provider's `tools=` arg; this block reminds the model what
# they're for. Kept terse on purpose — long tool prose doesn't help
# tool use and bloats the cached prefix.
_TOOL_OVERVIEW: Final[str] = (
    "Tools available this turn:\n"
    "- record_turn: write your processed memory of this turn (episode_summary, "
    "affect, salience, topics, references). Use your own words; do not "
    "paraphrase the user. Score salience honestly.\n"
    "- update_self_state: propose deltas to current_state, relational_stance, "
    "disposition, formed_opinions, quirks. Emit only fields that actually "
    "changed. Drift fields are signals, not new absolute values. "
    "identity_core cannot be modified through this tool."
)


def assemble_system_blocks(
    *,
    base_spec: str,
    self_state: SelfState,
    semantic_hot_set: Sequence[SemanticMemory] = (),
    episodic_results: Sequence[EpisodicMemory] = (),
) -> list[SystemBlock]:
    """Build positions 1-10 of the system array.

    Position layout (per chunk 5 spec):

    1. base agent spec / persona
    2. tool definitions                       [breakpoint, ttl=3600]
    3. identity_core                          [breakpoint, ttl=3600]
    4. disposition
    5. formed_opinions (full set)
    6. quirks (full set)                      [breakpoint, ttl=3600]
    7. current_state
    8. relational_stance
    9. semantic memory hot-set                (omitted if empty)
    10. episodic retrieval results            (omitted if empty)
    """
    blocks: list[SystemBlock] = [
        # 1.
        SystemBlock(content=base_spec.strip()),
        # 2. [breakpoint 1]
        SystemBlock(
            content=_TOOL_OVERVIEW,
            cache_breakpoint_ttl_seconds=CACHE_TTL_SECONDS,
        ),
        # 3. [breakpoint 2]
        SystemBlock(
            content=_format_identity_core(self_state.identity_core),
            cache_breakpoint_ttl_seconds=CACHE_TTL_SECONDS,
        ),
        # 4.
        SystemBlock(content=_format_disposition(self_state.disposition)),
        # 5.
        SystemBlock(content=_format_opinions(self_state.formed_opinions)),
        # 6. [breakpoint 3]
        SystemBlock(
            content=_format_quirks(self_state.quirks),
            cache_breakpoint_ttl_seconds=CACHE_TTL_SECONDS,
        ),
        # 7.
        SystemBlock(content=_format_current_state(self_state.current_state)),
        # 8.
        SystemBlock(content=_format_relational_stance(self_state.relational_stance)),
    ]
    # 9. semantic hot-set — omitted entirely when empty so the prompt
    # doesn't carry an empty section that confuses small models.
    if semantic_hot_set:
        blocks.append(SystemBlock(content=_format_semantic(semantic_hot_set)))
    # 10. episodic retrieval results
    if episodic_results:
        blocks.append(SystemBlock(content=_format_episodic(episodic_results)))
    return blocks


# ============================================================================
# Section formatters — plain text, deterministic, easy to diff in logs.
# ============================================================================


def _format_identity_core(ic: IdentityCore) -> str:
    values_block = (
        "\n".join(f"- {v}" for v in ic.base_values) if ic.base_values else "(none recorded)"
    )
    return (
        f"# identity_core (rarely changes — anchor)\n"
        f"name: {ic.name}\n"
        f"voice: {ic.voice}\n"
        f"base_values:\n{values_block}"
    )


def _format_disposition(d: Disposition) -> str:
    return (
        "# disposition (slow drift over weeks)\n"
        f"curiosity:    {d.curiosity:.2f}\n"
        f"playfulness:  {d.playfulness:.2f}\n"
        f"reserve:      {d.reserve:.2f}\n"
        f"warmth:       {d.warmth:.2f}\n"
        f"directness:   {d.directness:.2f}"
    )


def _format_opinions(opinions: Sequence[FormedOpinion]) -> str:
    if not opinions:
        return "# formed_opinions\n(none formed yet)"
    body = "\n".join(
        f"- {op.claim}  [formed {op.formed_at.date().isoformat()}, {len(op.evidence_ids)} evidence]"
        for op in opinions
    )
    return f"# formed_opinions\n{body}"


def _format_quirks(quirks: Sequence[Quirk]) -> str:
    if not quirks:
        return "# quirks\n(none observed yet)"
    body = "\n".join(f"- {q.pattern}  (observed {q.observed_count}x)" for q in quirks)
    return f"# quirks\n{body}"


def _format_current_state(cs: CurrentState) -> str:
    preoccupations = (
        "\n".join(f"- {p}" for p in cs.preoccupations) if cs.preoccupations else "(none)"
    )
    return (
        "# current_state (per-session)\n"
        f"mood: {cs.mood}\n"
        f"energy: {cs.energy:.2f}\n"
        f"preoccupations:\n{preoccupations}"
    )


def _format_relational_stance(rs: RelationalStance) -> str:
    markers = "\n".join(f"- {m}" for m in rs.history_markers) if rs.history_markers else "(none)"
    return (
        "# relational_stance (medium drift over days)\n"
        f"trust:          {rs.trust:.2f}\n"
        f"familiarity:    {rs.familiarity:.2f}\n"
        f"current_warmth: {rs.current_warmth:.2f}\n"
        f"history_markers:\n{markers}"
    )


def _format_semantic(sem: Sequence[SemanticMemory]) -> str:
    body = "\n".join(f"- [{s.confidence:.2f}] {s.claim}" for s in sem)
    return f"# semantic_hot_set\n{body}"


def _format_episodic(eps: Sequence[EpisodicMemory]) -> str:
    body = "\n".join(
        f"- [{ep.ts.date().isoformat()} salience={ep.salience:.2f}] {ep.content[:200]}"
        for ep in eps
    )
    return f"# retrieved_episodic\n{body}"
