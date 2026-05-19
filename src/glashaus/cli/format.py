"""Output formatters for `glashaus self`, `glashaus memory inspect`,
and `glashaus memory search`.

Pure functions returning strings — testable without touching stdout.
The CLI handlers print the returned string and add no extra framing.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, datetime

from glashaus.memory.types import EpisodicMemory, SemanticMemory
from glashaus.self_state.types import SelfState


def format_self_state(state: SelfState, *, now: datetime | None = None) -> str:
    now = now or datetime.now(UTC)
    ic = state.identity_core
    d = state.disposition
    cs = state.current_state
    rs = state.relational_stance

    base_values = "\n".join(f"  - {v}" for v in ic.base_values) if ic.base_values else "  (none)"
    preoccupations = (
        "\n".join(f"  - {p}" for p in cs.preoccupations) if cs.preoccupations else "  (none)"
    )
    history_markers = (
        "\n".join(f"  - {m}" for m in rs.history_markers) if rs.history_markers else "  (none)"
    )
    opinions = (
        "\n".join(
            f"  - {o.claim}  [formed {o.formed_at.date().isoformat()}, "
            f"{len(o.evidence_ids)} evidence]"
            for o in state.formed_opinions
        )
        if state.formed_opinions
        else "  (none yet)"
    )
    quirks = (
        "\n".join(f"  - {q.pattern}  ({q.observed_count}x)" for q in state.quirks)
        if state.quirks
        else "  (none yet)"
    )

    return (
        f"{ic.name} self-state @ {now.strftime('%Y-%m-%d %H:%M UTC')}\n"
        f"\n"
        f"identity_core (anchor — drifts almost never):\n"
        f"  name:  {ic.name}\n"
        f"  voice: {ic.voice}\n"
        f"  base_values:\n{base_values}\n"
        f"\n"
        f"disposition (slow drift, weeks):\n"
        f"  curiosity:    {d.curiosity:.2f}\n"
        f"  playfulness:  {d.playfulness:.2f}\n"
        f"  reserve:      {d.reserve:.2f}\n"
        f"  warmth:       {d.warmth:.2f}\n"
        f"  directness:   {d.directness:.2f}\n"
        f"\n"
        f"current_state (per-session):\n"
        f"  mood:    {cs.mood}\n"
        f"  energy:  {cs.energy:.2f}\n"
        f"  preoccupations:\n{preoccupations}\n"
        f"\n"
        f"relational_stance (medium drift, days):\n"
        f"  trust:           {rs.trust:.2f}\n"
        f"  familiarity:     {rs.familiarity:.2f}\n"
        f"  current_warmth:  {rs.current_warmth:.2f}\n"
        f"  history_markers:\n{history_markers}\n"
        f"\n"
        f"formed_opinions:\n{opinions}\n"
        f"\n"
        f"quirks:\n{quirks}\n"
    )


def format_episodic_brief(ep: EpisodicMemory) -> str:
    """One-line-ish brief used by `memory search`."""
    topics = ", ".join(ep.topics) if ep.topics else "—"
    snippet = ep.content if len(ep.content) <= 80 else ep.content[:77] + "..."
    return (
        f"{ep.id}  {ep.ts.date().isoformat()}  "
        f"salience={ep.salience:.2f}  {ep.channel}\n"
        f"  {snippet}\n"
        f"  topics: {topics}  affect: {ep.affect.dominant_emotion} "
        f"v={ep.affect.valence:+.1f} a={ep.affect.arousal:.1f}"
    )


def format_episodic_full(ep: EpisodicMemory) -> str:
    """Long form used by `memory inspect`."""
    topics = "\n".join(f"  - {t}" for t in ep.topics) if ep.topics else "  (none)"
    references = "\n".join(f"  - {r}" for r in ep.references) if ep.references else "  (none)"
    return (
        f"EpisodicMemory {ep.id}\n"
        f"  ts:        {ep.ts.isoformat()}\n"
        f"  user_id:   {ep.user_id}\n"
        f"  agent_id:  {ep.agent_id}\n"
        f"  channel:   {ep.channel}\n"
        f"  salience:  {ep.salience:.3f}\n"
        f"  affect:\n"
        f"    valence:           {ep.affect.valence:+.3f}\n"
        f"    arousal:           {ep.affect.arousal:.3f}\n"
        f"    dominant_emotion:  {ep.affect.dominant_emotion}\n"
        f"  topics:\n{topics}\n"
        f"  references:\n{references}\n"
        f"  has_embedding: {ep.has_embedding}\n"
        f"  content:\n"
        f"    {ep.content}\n"
    )


def format_semantic_brief(sm: SemanticMemory) -> str:
    when = sm.last_updated.date().isoformat() if sm.last_updated else "—"
    return f"{sm.id}  {when}  confidence={sm.confidence:.2f}\n  {sm.claim}"


def format_episodic_search_results(eps: Sequence[EpisodicMemory]) -> str:
    if not eps:
        return "(no episodic results)"
    blocks = [format_episodic_brief(ep) for ep in eps]
    header = f"{len(eps)} episodic result{'s' if len(eps) != 1 else ''}:\n"
    return header + "\n\n".join(blocks) + "\n"


def format_semantic_search_results(sms: Sequence[SemanticMemory]) -> str:
    if not sms:
        return "(no semantic results)"
    blocks = [format_semantic_brief(sm) for sm in sms]
    header = f"{len(sms)} semantic result{'s' if len(sms) != 1 else ''}:\n"
    return header + "\n\n".join(blocks) + "\n"
