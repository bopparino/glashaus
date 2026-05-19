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

# Text shown in the tool-overview block. The actual tool schemas are
# also sent via the provider's `tools=` arg. The schemas tell models
# *what fields are allowed*; this block shows them *what a good
# response looks like* — concrete examples close the gap that the
# schema alone doesn't always close, especially for smaller models
# (Kimi K2.6 was emitting `affect: {}` and `disposition_drift: [{}]`
# despite the schema requiring fields).
#
# Token cost: ~700 tokens per turn. Once Anthropic lands in Phase 4
# this block falls inside the breakpoint-1 cached prefix so the cost
# vanishes after the first turn of a session.
_TOOL_OVERVIEW: Final[str] = """\
Tools available this turn — emit BOTH in every response:

================================================================
1. record_turn — your processed memory of this turn
================================================================
ALL of: turn_id, episode_summary, affect, salience are REQUIRED.

`episode_summary`: your own-words memory of what happened, not a
paraphrase of the user. Honest.

`affect`: MUST be a complete object with ALL three fields:
    {"valence": <-1..1>, "arousal": <0..1>, "dominant_emotion": "<word>"}
If you're not sure what to put, use these neutral defaults:
    {"valence": 0.0, "arousal": 0.3, "dominant_emotion": "neutral"}
NEVER emit `affect: {}` — that fails validation and the turn retries
expensively. Filling neutrals is always better than emitting empty.

`salience`: most small-talk turns are ~0.1-0.3. Significant moments
(first vulnerability, a new commitment, a real disagreement) approach
~0.7-0.95. A score of 1.0 should be rare.

`topics`: short tags. Optional. Empty list if none.

`references`: episodic IDs of prior turns you are CONSCIOUSLY
continuing. ONLY include IDs that appeared in the retrieved_episodic
block above. NEVER invent UUIDs — invalid references cause the turn
to fail with a foreign-key error. If unsure, use [].

Example:
    {
      "turn_id": "t-abc123",
      "episode_summary": "User asked about AI in 6 months. I framed the next phase as moving from fireworks to furniture.",
      "affect": {"valence": 0.3, "arousal": 0.4, "dominant_emotion": "engaged"},
      "salience": 0.4,
      "topics": ["AI", "predictions"],
      "references": []
    }

================================================================
2. update_self_state — propose deltas for this turn
================================================================
ONLY `turn_id` is required (must match record_turn's turn_id).
Emit ONLY the sections that actually changed. OMIT a section rather
than emit `{}` or partial items.

`current_state`: per-session. `mood` is a short string, `energy` is
in [0, 1], `preoccupations` is a list of strings. Partial OK:
    {"mood": "engaged", "energy": 0.6}

`relational_stance`: medium drift over days.
- `trust_drift`, `familiarity_drift` are magnitudes in [0, 1] —
  how strongly this turn pulls trust/familiarity UP. Use 0 (or omit)
  for "no pull". These are SIGNALS, not new values.
- `current_warmth` IS a new absolute value in [0, 1], clipped.
- `history_marker` is a short string that gets appended.

`disposition_drift`: slow drift over weeks. List of items. Each item
MUST have ALL THREE fields:
    {"dimension": "<warmth|curiosity|playfulness|reserve|directness>",
     "direction": <-1 or 1>,
     "magnitude_weight": <0..1>}
NEVER emit `[{}]` or items missing any of those three. If you have
nothing to drift, OMIT `disposition_drift` entirely.

`formed_opinions`: list of items, each with `claim` AND non-empty
`evidence_ids` (real episodic IDs from retrieved_episodic).
    {"claim": "Austin works late", "evidence_ids": ["ep-..."]}

`quirks`: list of items, each with `pattern` (a short string).
    {"pattern": "tends to answer with rhetorical questions"}

`identity_core` (name, voice, base_values) CANNOT be modified through
this tool. The schema rejects them.

Example:
    {
      "turn_id": "t-abc123",
      "current_state": {"mood": "engaged", "energy": 0.6},
      "disposition_drift": [
        {"dimension": "curiosity", "direction": 1, "magnitude_weight": 0.3}
      ],
      "relational_stance": {"trust_drift": 0.1}
    }

================================================================
Failure modes to avoid
================================================================
- `affect: {}` — invalid; use neutral defaults instead.
- `disposition_drift: [{}]` or items missing required fields — OMIT
  the section instead.
- Invented `references` UUIDs — only cite IDs from
  retrieved_episodic. Use [] if none apply.
- Attempting to modify identity_core — not supported.
"""


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
