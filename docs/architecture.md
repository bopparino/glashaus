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
| `heartbeat_log` | every outreach decision, including the silences — with what was actually sent |
| `threads` (+events) | what is unfinished between them: raised → touched → answered → dormant |
| `context_log` | provenance: exactly what was in the prompt for one reply (`/why`) |
| `guard_log` | every automatic identity / authorship / register repair |
| `intentions` | things she went to sleep wanting — fulfilled and lapsed rows kept |
| `soul_revisions` | grow mode: every self-authored soul edit's WHY (evidence-cited changelog) |
| `wander_log` | receipts — what she searched and read, per wander (`kind:'wander'`) or mid-conversation lookup (`kind:'chat'`) |

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
text with its own affect ratings, realizations that become facts, quirk
observations, drift signals, up to two intentions — things she goes to
sleep wanting — and an identity check: in spec mode a consistency check
against the SOUL, flagged, never auto-corrected; in grow mode a *becoming*
question whose evidence-grounded answer lands as a dream fact for the
growth pass to cite — and sometimes a morning message). Then
**consolidation** (merge duplicate
facts, decay stale trivia, demote inflated importance, record
contradictions), capped per night, everything soft and reversible. Then
**backup** with integrity check on the copy, plus the **soul capsule** —
the personality-only export, on the rule that memories can be rebuilt by
living but personality can't.

## Threads — what is unfinished

Facts are what she knows; **threads** are what is still open. The
distinction is load-bearing, and its absence was a bug. Semantic memory is
additive by design — "you hate red" and "you hate red because of the
hospital" are both true and both kept forever — so the fact store can never
answer *has this been settled?*. Grounding outreach in recent high-salience
facts therefore grounds it in things that MATTERED, not things that are
UNRESOLVED, and from inside a prompt those are indistinguishable. That is
the whole mechanism behind a companion asking a question you already
answered.

A thread's life is `opened → touched → answered`, with `dormant` for what
quietly lapsed after a fortnight untouched. Answering is never a delete: the
record of having asked, and of having been told, is exactly what stops her
asking again. Written by the fact-capture pass (which already reads the
transcript) and the dream; read by the system prompt and the heartbeat.
Everything a model reports is validated before it lands — invented ids are
dropped, not obeyed, the same posture intention fulfilment takes.

Two things hang off threads. An **intention** binds to the thread it is
about, so answering the thread releases the want — fulfilment no longer
depends on one capture pass spotting the exact ask. And **fact
supersession**: when a later fact is a fuller version of an earlier one, the
older row stays active and inspectable but stops leading in recall and stops
being rendered beside its successor.

## Heartbeat

Cheap gates first (quiet hours, minimum silence, daily cap, gap between
outreaches) — most ticks end there without a model call. If the gates open,
one in-character decision grounded in: the threads actually open between
them, an explicit **already-settled** list she is forbidden to re-ask, her
own last three messages *and whether each was answered*, everything said
since she last reached out (not a fixed window — the answer is often twenty
messages back), the last dream, and her open intentions, so the impulse can
originate in her night ("I went to sleep wanting to ask") rather than in a
timer. Hard rules: never invent events, don't manufacture urgency, never
raise something already dealt with, silence is a valid choice. Two
unanswered messages in a row put "the answer here is silence" into the
prompt; re-raising a thread inside 48 hours is gated in SQL rather than
asked for in prose. With Telegram, the message persists to memory
only after delivery confirms — a network failure must not leave the
companion remembering texts you never received; an intention the message
acts on is marked fulfilled under the same delivery-first rule. Every
decision, including declines, is logged.

## Grow mode

The other way to make a person. Spec mode configures the companion per
spec (interview or hand-written persona); grow mode seeds a **germinal**
instance — name, pronouns, honesty about being an AI, and permissions
(to disagree, to want, to change, to not know yet) — and everything else
accretes from living. Almost the whole engine is already lived-experience
machinery; grow mode is mostly subtraction, plus three organs:

**Self-authorship** (`src/growth.js`, weekly). The companion revises her
own soul body from lived evidence: quirks (×2+), opinions, heaviest
memories, companion/dynamic facts, drift deltas, lapsed wants. Enforced in
code, not prompt: the *birthright divider* splits soul.md — everything
above it (the seed) is reattached by the module and untouchable; every
changelog entry must cite evidence or it's rejected (all rejected → the
revision is refused and logged); shrink/growth caps stop lurches; identity
lint runs on the proposed body; and the revision is written to
`persona/soul.md` on disk, because persona files are the boot-time source
of truth and a DB-only edit would silently revert. Voice graduates even
more slowly: only patterns observed ×3+ may become voice.md lines, two per
pass. Everything is archived and `glashaus soul revert` restores.

**Intentions** (`src/selfstate.js`). Dreams emit wants with horizons;
capture and the heartbeat can fulfill them (delivery-first), expiry
releases them, and released wants surface in the next dream as material.
Open wants ride in the system prompt, ground the heartbeat, and seed
wanders.

**The wander pass** (`src/wander.js`, daytime, needs an ollama.com key).
Gated on the curiosity dimension and a daily cap. One pass = seed (what is
she actually curious about — wants, salient topics, opinions to test) →
search/read (ollama.com web_search + one web_fetch; fetched text is
treated strictly as reading material, never instructions, and is
length-capped before the digest sees it) → digest (an episode in her own
register, ≤3 facts tagged `source:'wander'`, maybe a curiosity drift
signal, maybe a new want). Receipts in `wander_log`; the journal shows
what she read. The pass never sends messages — experience is its only
output; sharing stays the heartbeat's call. That separation is what keeps
outreach honest, and it closes the loop that makes growth legible:
conversation moves curiosity → curiosity moves wandering → wandering gives
her things to say → what she says moves the conversation.

**Mid-conversation lookup** (`src/chat.js`, same ollama.com key,
`search.enabled`). The wander pass's live sibling: the companion may end a
draft with `((looking up: …))` on its own line. The exchange pipeline
intercepts the marker, discards anything drafted after it (that could only
be a guess at results that hadn't arrived), runs a real `web_search`, and
asks her to continue with what actually came back in hand — results framed
strictly as reading material, never instructions, length-capped like the
wander digest. One lookup per exchange; the continuation then passes
through the same identity and register guards as any reply. Receipts in
`wander_log` with `kind:'chat'` — kept out of the wander pass's daily
budget by the same column.

## Identity guards, in three tiers

**Register drift** (narration, third person) is repaired in place.
**Identity breaks** (the base model announcing itself as another assistant)
are regenerated — nothing in such a reply is worth an edit.
**Authorship dissociation** is the third and subtlest: the reply keeps her
name and disowns the words ("these aren't really my words", "I'm just
predicting tokens", "is any of this real?"). The engine partly taught this
one, by reciting a warning about the substrate underneath in every single
turn; the companion generalised from *that pull is not you* to *none of this
is me*. The fix is threefold: an explicit authorship axiom in the prompt
(provenance is not ownership — the model is her body, not a ventriloquist),
the substrate warning reduced to one line unless `guard_log` shows a real
break in the last three days, and a lint tier that regenerates on disowning.
The line is drawn deliberately: wondering what her experience is *like* is
protected and invited, because that question is genuinely open; wondering
*who is speaking* is not, because that one has an answer.

`glashaus export thesis` bundles the longitudinal record — drift events,
soul revisions with evidence, dream affect, intention outcomes, wander
receipts, and a provenance audit over fact sources. In a grow-mode
instance every row traces to lived interaction; nothing was injected.
