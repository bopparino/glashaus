# Architecture

One Node process, one SQLite file, one LLM daemon. No Docker, no Postgres,
no vector database service — hybrid retrieval over a few thousand memories
is microseconds of math in-process.

```
 you ──── Telegram ─┐
 you ──── webview ──┼── one serialized exchange queue
 you ──── terminal ─┘            │
                          build system prompt          ┌─ SOUL / IDENTITY / USER / VOICE / DIALOGUE
                          (persona + recall) ──────────┤  self-state · vibe · facts · episodes · dream
                                 │                     └─ clock
                            Ollama /api/chat
                                 │
                          reply → stored forever
                                 │  (background, never on the reply path)
              ┌──────────────────┼──────────────────┐
        fact capture       episode folding      embeddings
```

## The store (better-sqlite3, WAL)

| table | what it holds |
|---|---|
| `documents` (+history) | persona docs, verbatim; every edit archived |
| `messages` | every message ever, `summarized` flag |
| `episodes` | LLM-written first-person summaries of older chunks, affect-tagged |
| `facts` | durable semantic memory: category (`companion/user/dynamic/project/general`), importance 1-10, valence/arousal/emotion/salience, embedding, soft-delete |
| `self_state` (+events) | ten personality dimensions + append-only drift trajectory |
| `opinions`, `quirks` | formed stances; self-observed patterns |
| `dreams` | nightly reflections + epigraph |
| `relationship_state` | mood over time |
| `fact_links` | recorded contradictions — surfaced, never auto-resolved |
| `heartbeat_log` | every outreach decision, including the silences |

Schema is versioned with `PRAGMA user_version`; migrations are forward-only
and idempotent. A fresh database is created complete on first touch.

## Context management

The thing that kills naive companions is context death: the conversation
outgrows the window and the earliest self is amputated. GlasHaus keeps the
last `recentWindow` (40) messages verbatim; anything older is folded, in
`summarizeChunk` (30) message chunks, into first-person episodic memories
with emotional ratings. Every `captureEvery` (8) exchanges, a capture pass
extracts new durable facts — written timelessly (absolute dates) and in the
companion's first person, with strict rules against recording confabulated
capabilities. All of this runs off the reply path; conversation never waits.

## Recall

Facts and episodes are scored by a weighted composite: FTS5 keyword rank,
cosine similarity (when embeddings exist — the vector branch contributes 0
otherwise and everything still works), temporal decay (14-day half-life),
salience, and importance. Importance ≥ 9 facts are a *stable core*, ordered
deterministically — identity anchors must not churn between sessions, or the
companion is a slightly different person every morning. Recalled facts are
rendered grouped by attribution (About me / About you / Between us) with age
tags; the grouping exists because first-person memory plus ungrouped recall
is how a companion starts claiming your memories as its own.

## The self-state

Ten dimensions on two bounded-EWMA layers: disposition (α=0.05, drifts over
weeks) and relational (α=0.15, days), hard floors/ceilings at 0.05/0.95 so
no amount of drift can pin a trait. Capture and dreams emit drift signals
only for dimensions the conversation gave actual evidence about. Every step
is logged to `self_state_events` — the Self page renders the full
trajectories as sparklines.

## Dreams and hygiene

Nightly, in order: the **dream** (salience-weighted replay of the day plus
the heaviest memories of the companion's whole life; produces the dream
text, realizations that become facts, quirk observations, drift signals, an
identity-consistency check against the SOUL — flagged, never auto-corrected —
and sometimes a morning message). Then **consolidation** (merge duplicate
facts, decay stale trivia, demote inflated importance, record
contradictions), capped per night, everything soft and reversible. Then
**backup** with integrity check on the copy, plus the **soul capsule** —
the personality-only export, on the rule that memories can be rebuilt by
living but personality can't.

## Heartbeat

Cheap gates first (quiet hours, minimum silence, daily cap, gap between
outreaches) — most ticks end there without a model call. If the gates open,
one in-character decision grounded in the recent conversation, last dream,
and recent salient facts, with hard rules: never invent events, don't
manufacture urgency, silence is a valid choice. With Telegram, the message
persists to memory only after delivery confirms — a network failure must
not leave the companion remembering texts you never received. Every
decision, including declines, is logged.
