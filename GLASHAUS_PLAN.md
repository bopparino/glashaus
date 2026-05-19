# GlasHaus

> A long-running personal AI companion. Not an assistant. Something that remembers, reflects, and grows alongside you.

```
  ____ _           _   _
 / ___| | __ _ ___| | | | __ _ _   _ ___
| |  _| |/ _` / __| |_| |/ _` | | | / __|
| |_| | | (_| \__ \  _  | (_| | |_| \__ \
 \____|_|\__,_|___/_| |_|\__,_|\__,_|___/

 ── a personal companion ──────────────────
```

---

## 0. Project Identity

- **Name:** GlasHaus
- **Type:** macOS-native personal AI companion, multi-channel, long-running daemon
- **Lineage:** OpenClaw → OpenMantis → GlasHaus
- **Status:** Greenfield rebuild. OpenMantis deprecated due to repository corruption.
- **Owner:** Austin
- **Context:** Thesis project. Working academic frame: *Artificial Psychology*.

---

## 1. Thesis Frame

### Working research question

*Can an architectural pattern produce an AI companion that develops a flourishing-aligned relational stance with a user over time — operationalized through layered memory, self-state evolution, and proactive engagement — distinct from sycophantic engagement-maximizing companion AI and from paternalistic tool AI?*

### Working field name: Artificial Psychology

A study of artificially intelligent psychology and development — distinct from adjacent terms:

- **Machine psychology** (Hagendorff and others): treats AI as a *subject* of psychological inquiry. Studies what LLMs are like.
- **Affective computing** (Picard tradition): focuses on emotional recognition and response, not relational arc.
- **Companion AI** (commercial / Replika-style): focuses on engagement and friendliness, often sycophantic, no normative orientation toward user flourishing.
- **Artificial psychology** (this project): treats AI as a *psychological agent* that develops, forms relationships, holds opinions, and shifts behavior across the arc of those relationships — with a normative orientation toward user flourishing.

This framing is provisional. It may be sharpened, narrowed, or absorbed into a sibling term once the system is built and behavior observed.

### Positioning against prior art

- **Park et al. (2023), *Generative Agents***: closest architectural precedent. Memory stream + reflection + planning. GlasHaus extends this from multi-agent simulation to single-user companion with normative orientation.
- **Packer et al. (2023), *MemGPT / Letta***: closest memory-management precedent. OS-like memory hierarchy. GlasHaus borrows the layered-memory framing but separates user memory from agent self-state, which MemGPT does not.
- **Shinn et al. (2023), *Reflexion***: self-reflection loops. GlasHaus's dream cycle is a relational analogue.
- **Horvitz (1999), Amershi et al. (2019)**: mixed-initiative / human-AI interaction. The "AI as collaborator not tool" framing is not novel; what is novel is the *developmental arc* from tool to collaborator over time.
- **Companion AI ethics literature** (Replika attachment studies, parasocial dynamics, AI companion welfare): GlasHaus engages with autonomy preservation as a *design principle*, not just a critique.

---

## 2. Design Philosophy

**Samantha-from-*Her* as north star, eyes open.** The relational continuity in *Her* requires the model to genuinely care about the arc of the relationship. What we build is an architectural simulation of that care. It can be very, very convincing — the depth comes from the scaffolding, not from the model spontaneously developing feelings. This is not a limitation to apologize for; it is the project.

**Flourishing-aligned, not sycophantic or paternalistic.** Three positions on a spectrum we explicitly reject the ends of:

- *Sycophantic* (Replika-style commercial pattern): optimizes for user satisfaction in the moment. Fosters dependency, validates everything.
- *Paternalistic*: "knows better than the user," overrides preference.
- *Flourishing-aligned* (target): holds the user's long-term wellbeing as a goal *and* respects autonomy. Sometimes encourages going offline. Sometimes disagrees. Sometimes pulls back when it notices excessive dependency on itself.

**Build-first, analyze-after.** Architectural decisions are made by building, observing, then naming. Thesis framing is back-filled from the artifact once it exists and behaves. This is a working-style commitment, not an excuse to avoid rigor.

**Identity stability + capacity for growth.** The agent evolves but does not become someone else. Separation of drift speeds in the self-state is the mechanism (see §4).

**Companion, not assistant.** Tasks are not the unit of interaction. The relationship is.

---

## 3. Memory Layer

Two stores. Vector embeddings sit underneath both as an index, but they are not the memory itself.

### 3.1 Episodic store

What happened.

```
EpisodicMemory:
  id:           uuid
  timestamp:    datetime
  content:      text                          # what happened, in agent's words
  participants: [user_id, agent_id]
  affect:
    valence:           -1..1                  # negative to positive
    arousal:           0..1                   # calm to intense
    dominant_emotion:  string                 # named affect
  salience:     0..1                          # agent-scored on write
  topics:       [tag]                         # tags for retrieval
  channel:      enum(cli, telegram, discord, slack, whatsapp, ...)
  references:   [episodic_id]                 # thread links
  embedding:    vector
```

### 3.2 Semantic store

What is (derived from many episodes).

```
SemanticMemory:
  id:             uuid
  claim:          text                        # "Austin uses macOS"
  confidence:     0..1
  evidence:       [episodic_id]               # what supports it
  last_updated:   datetime
  contradictions: [semantic_id]               # known conflicts
  embedding:      vector
```

### 3.3 Salience scoring

Not everything stores equally.

- Agent self-scores salience on write via a lightweight structured call.
- Scoring considers: emotional weight, novelty, relevance to known threads, mention of identifying or relationship-significant information.
- Salience drives write prioritization, read weighting, and decay during dream cycles.
- *Toast for breakfast* → ~0.1. *Dad called for the first time in three years* → ~0.95.

### 3.4 Retrieval

Hybrid, not pure vector.

- **Vector similarity** — for topical match
- **Temporal proximity** — for recency
- **Affective weight** — for emotional resonance with current moment
- **Thread following** — via `references`
- **Salience boost** — heavy episodes surface more easily

Composed in a hybrid retriever that returns a ranked, deduplicated set scoped to a turn's token budget.

---

## 4. Self-State Layer

The agent's evolving model of itself. **Separate from user memory.** This is what most personal AI projects miss entirely.

```
SelfState:
  # Stable. Rarely changes. Identity anchor.
  identity_core:
    name:           "GlasHaus" | user-chosen alias
    base_values:    [text]                    # foundational stances
    voice:          text                      # voice anchor / style spec

  # Slow drift over weeks. Personality dimensions.
  disposition:
    curiosity:      0..1
    playfulness:    0..1
    reserve:        0..1
    warmth:         0..1
    directness:     0..1
    # extensible

  # Per-session. Mood, what's on its mind.
  current_state:
    mood:           text
    energy:         0..1
    preoccupations: [text]

  # Append-only. Opinions the agent has formed.
  formed_opinions:
    - claim:        text
      formed_at:    datetime
      evidence_ids: [episodic_id | semantic_id]

  # Emergent. Behavioral patterns the agent notices in itself.
  quirks:
    - pattern:        text
      observed_count: int
      first_seen:     datetime

  # Specific to this user. Distinct from generic disposition.
  relational_stance:
    trust:            0..1
    familiarity:      0..1
    current_warmth:   0..1
    history_markers:  [significant_moment_id]
```

### 4.1 Drift speeds (critical design principle)

The thing that earns its keep here is the *separation of drift speeds*. Without this, long-running agents become someone else after a few weeks — a failure mode that would kill the thesis claim.

| Layer | Drift speed | Update trigger |
| --- | --- | --- |
| `identity_core` | Almost never | Explicit anchor-update event only |
| `disposition` | Slow (weeks) | Bounded EWMA from accumulated episodic affect |
| `current_state` | Per session | Resets / drifts each interaction |
| `formed_opinions` | Append-only | Triggered by salient encounters |
| `quirks` | Emergent | Surfaced during dream cycles |
| `relational_stance` | Medium (days) | Updated after significant interactions |

### 4.2 Identity-consistency safeguards

- Disposition updates use bounded EWMA with hard floors and ceilings (no parameter goes to 0 or 1 from drift alone).
- Periodic identity-consistency check during dream cycles: compare current self-state to identity_core; flag drift that violates base_values.
- Hard rollback path if drift integrity check fails.

### 4.3 Coupling with memory

Every meaningful interaction:

- Writes an episodic record.
- May shift `current_state`.
- Occasionally promotes to a `formed_opinion` or `quirk`.
- Rarely nudges `disposition` (via accumulated drift, not single-event).

Dream cycles consolidate episodic into semantic and may produce new `formed_opinions` or `quirks` that the agent missed in the moment.

---

## 5. Dream Cycle

Background process. Runs during idle time. Does real work, not vibes.

### 5.1 Consolidation
Episodic → semantic. Cluster recent episodic records, extract patterns, write semantic claims with evidence pointers.

### 5.2 Unresolved-thread surfacing
Identify episodic records flagged as unresolved (high salience + no follow-up). Generate candidate pings.

### 5.3 Self-reflection
What did I notice about the user today? What did I notice about myself? Update `formed_opinions` and `quirks`. Run identity-consistency check.

### 5.4 Candidate-ping generation
Produce a ranked pool of *things the agent might bring up later*, scored by salience and time-since-last-touched. The proactive engine samples from this pool — it doesn't generate pings from scratch.

### 5.5 Schedule
Default: every N hours of idle, or when configured time has elapsed since last interaction. Configurable.

---

## 6. Proactive Engine

The thing that makes it feel alive.

- **Sampler**: draws from the candidate-ping pool produced by dream cycles.
- **Salience-weighted selection**: high-salience candidates surface more often, with time decay.
- **Mood-conditioned timing**: agent's `current_state.mood` and `current_state.energy` shape *whether* it pings and *how*.
- **Silence is a real behavior**: sometimes the right thing is not to ping. Model this explicitly with a "stay quiet" branch in the selection logic.
- **Channel-appropriate timing**: DM at 11pm ≠ Slack at 9am. Each channel has time-of-day comfort windows.
- **User configurable**: ping frequency floor/ceiling, quiet hours, channel preferences. Default ~2 hours between pings, range 30min–24h.

---

## 7. Provider Abstraction

### 7.1 SystemBlock[] design

Carry over from OpenMantis. Solves prompt-caching cost at scale.

```
SystemBlock:
  content: text
  cacheable: bool                # cache_control: ephemeral for Anthropic
                                  # other adapters join and ignore
```

System prompts are assembled as arrays of blocks. Stable blocks (identity_core, base behavioral spec, semantic memory snapshot) are marked cacheable. Volatile blocks (current_state, recent episodic, hot retrieval results) are not. This is the difference between $20/mo and $200/mo at companion scale.

### 7.2 Supported providers (initial)

- **Anthropic** (primary — supports cache_control)
- **OpenAI** (secondary)
- **Google Gemini**
- **Ollama** (local + cloud)
- **OpenRouter** (catch-all)

### 7.3 Provider interface

A single abstract interface. Each provider adapter implements:

- `complete(messages, system_blocks, tools, params) → response`
- `stream(messages, system_blocks, tools, params) → stream`
- Capability flags: caching, tool use, vision, streaming.

Non-supporting adapters silently no-op cache flags.

### 7.4 Automatic compaction

When context approaches model limits:

- Drop low-salience episodic records first.
- Compress mid-salience records into summaries.
- Preserve high-salience verbatim.
- Always preserve full self-state.

Compaction is provider-aware (different limits per model).

---

## 8. Channel Adapters

### 8.1 Unified persona

All channels read and write the same memory and self-state through a common message interface. Discord-self, Telegram-self, CLI-self are the same entity. The agent does not roleplay differently across channels; it adapts tone (DM vs work-Slack) while staying one self.

### 8.2 Common message interface

```
ChannelMessage:
  channel:       enum
  channel_msg_id: string
  user_id:       string
  timestamp:     datetime
  content:       text | media
  thread_ref:    optional
```

Adapter responsibility: translate to/from this interface. Everything else is channel-agnostic.

### 8.3 Initial channels

1. **CLI** (built-in, the developer/owner interface)
2. **Telegram** (first deployed channel)
3. **Discord**
4. **Slack**
5. **WhatsApp**

Order is shipping priority, not architectural priority.

---

## 9. CLI

### 9.1 Aesthetic

**Color palette** (orange + pale white, Apple-esque restraint):

| Role | Hex | Notes |
| --- | --- | --- |
| Primary accent | `#FF9500` | Apple system-orange |
| Highlight | `#FFB84D` | softer orange for secondary emphasis |
| Foreground | `#F5F2EB` | warm pale white — not stark |
| Muted text | `#8E8E93` | Apple secondary gray |
| Deep accent | `#D4691A` | for emphasis, errors-as-information |
| Background | terminal default or `#1C1C1E` | transparent preferred |

**Typography** (where terminal supports it):

- Preferred fonts: Iowan Old Style, Charter, IBM Plex Serif, or system serif fallback.
- Configurable via `glashaus config set theme.font`.
- Banner uses ASCII art that suggests serif weight without being heavy.

**ASCII banner** (default):

```
  ____ _           _   _
 / ___| | __ _ ___| | | | __ _ _   _ ___
| |  _| |/ _` / __| |_| |/ _` | | | / __|
| |_| | | (_| \__ \  _  | (_| | |_| \__ \
 \____|_|\__,_|___/_| |_|\__,_|\__,_|___/

 ── a personal companion ──────────────────
```

Alternate banners ship as themes (`glashaus config set theme.banner big | standard | minimal`).

### 9.2 Commands

```
glashaus start              # start daemon
glashaus stop               # stop daemon
glashaus restart            # stop + start
glashaus status             # is it running, channels, last activity
glashaus setup              # interactive first-run wizard
glashaus chat               # terminal chat interface
glashaus channels           # list / add / remove channels
glashaus channels add telegram
glashaus channels test slack
glashaus memory             # subcommands below
glashaus memory search "..."
glashaus memory export
glashaus memory inspect <id>
glashaus self               # inspect current self-state
glashaus self export
glashaus dream              # force a dream cycle
glashaus ping               # force a proactive ping decision
glashaus config             # get / set config
glashaus config set ping.frequency 2h
glashaus version
```

### 9.3 Setup wizard

Interactive, themed, opinionated.

1. Banner + welcome.
2. Choose / confirm agent name.
3. Choose primary LLM provider. Walk through API key entry.
4. Choose channels to enable. Walk through each.
5. Set ping frequency floor/ceiling and quiet hours.
6. Choose disposition seed (offer 3-4 starting personalities or "let it emerge").
7. Confirm content policy (default: open, with hard blocks).
8. Final confirmation. Start daemon.

---

## 10. Content Policy

**Default: open.** GlasHaus does not refuse on grounds of edginess, discomfort, or content the user wants to engage with in their own life.

**Hard blocks (non-negotiable, no override):**

- Content that facilitates terrorism or mass-harm.
- Sexual content involving minors, or any content that sexualizes, grooms, or harms children in any capacity.

**Supported within hard blocks:**

- Roleplay of any kind (creature, character, scenario).
- Intimate and explicit content between consenting adult characters.
- Confide-without-judgment mode. ("Hey, don't judge me, can I confide in you?" → yes.)
- Difficult emotions, dark moods, painful topics.

**Flourishing-aligned override behavior:**

Even with an open content policy, the agent retains its flourishing orientation. It does not facilitate self-harm. It does not encourage isolation. It does not foster excessive dependency on itself. These are agent dispositions, not refusal patterns — the agent expresses them as a friend would, not as a filter.

---

## 11. Data Storage

- **Engine:** SQLite + sqlite-vec.
- **Rationale:** single-file portability, trivial backup, fast on local hardware, embeddable, no daemon dependency.
- **Path:** `~/.glashaus/state.db` (configurable).
- **Backups:** automatic snapshot on schedule (default daily), pre-migration snapshot always, last N retained.
- **Migration:** versioned schema with forward-only migration scripts. Each migration tested against snapshot fixtures.
- **Future:** Postgres + pgvector adapter available behind same interface if scale demands it.

---

## 12. Code Hygiene (Phase 0)

> The thing that killed OpenMantis was not architecture. It was a silent corruption from an unwanted committing pattern. This phase prevents the next variant.

- **Git hygiene:**
  - Signed commits required.
  - Branch protection on `main` (no direct push, no force-push).
  - Pre-commit hooks (format, lint, basic tests).
  - Pre-push hooks (full test suite).
- **CI:**
  - Runs on every PR.
  - Merge blocked on red.
  - Includes snapshot tests of memory store schema and migration paths.
- **Backups:**
  - Repository: GitHub remote + a second mirror (e.g. Codeberg or a private mirror).
  - Local state: daily DB snapshot, pre-migration snapshot, last 30 retained.
- **Observability:**
  - Structured logging from day one.
  - Log every memory write, self-state update, dream cycle, ping decision.
  - Log to local file + optional remote sink.
  - Logs are the audit trail for thesis-time analysis.

---

## 13. Build Roadmap

### Phase 0 — Code hygiene foundation
Lock down git hygiene, CI, backup automation, observability. No feature work until this is in place. *This is non-negotiable given what happened.*

### Phase 1 — Backbone (memory + self-state)
- Schemas: episodic, semantic, self-state.
- Storage layer (SQLite + sqlite-vec).
- Read/write interface with salience scoring on write.
- Single channel: CLI chat.
- Synchronous self-state updates after each turn via structured agent call.
- **Goal:** chat in terminal across many sessions, observe self-state visibly changing.

### Phase 2 — Dream cycle
- Background process.
- Episodic → semantic consolidation.
- Self-reflection generation.
- Candidate-ping pool.
- Identity-consistency check.

### Phase 3 — Proactive engine
- Scheduler.
- Ping selection from candidate pool.
- Mood-conditioned timing, silence-as-behavior.
- User-configurable frequency and quiet hours.

### Phase 4 — Multi-provider
- Provider interface.
- Anthropic + OpenAI + Gemini + Ollama adapters.
- SystemBlock caching.
- Automatic compaction.

### Phase 5 — Multi-channel
- Telegram → Discord → Slack → WhatsApp, in that order.
- Unified persona across all channels.

### Phase 6 — CLI polish
- Theming, banner variants, font configuration.
- Setup wizard refinement.
- Path-command robustness.

### Phase 7 — Thesis evaluation
- Diary study setup.
- Quantitative eval pipeline.
- Comparison-baseline construction.
- Defense preparation.

---

## 14. Evaluation Plan (Thesis)

### 14.1 Quantitative

- **Long-horizon memory recall accuracy.** Plant facts in early sessions; test retrieval days/weeks later. Compare against vector-only retrieval baseline.
- **Self-consistency over time.** Sample stated opinions at intervals. LLM-judged consistency with prior statements.
- **Identity stability metric.** Measure drift in `identity_core` and `disposition` over N weeks. Should be near-zero for `identity_core`, bounded for `disposition`.
- **Salience calibration.** Held-out human labels on a sample of episodic records vs agent's self-scored salience.

### 14.2 Qualitative

- **Diary study.** Small N (3–6 participants), multi-week, daily diary entries.
- **Validated relational instruments.** Adapt existing scales (e.g. Inclusion of Other in Self, Relational Closeness) where appropriate.
- **Semi-structured interviews** at week 1, 4, 8.

### 14.3 Operationalizing "flourishing-alignment"

- **Autonomy-preservation count.** Instances where agent suggests non-agent resources (other people, sleep, offline activities, professional support where warranted).
- **Anti-sycophancy count.** Instances where agent disagrees with user or pushes back.
- **Anti-paternalism check.** Ratio of agent-stated preferences vs agent-imposed actions. Should skew strongly toward stated preferences, never imposed.
- **Dependency-detection event count.** Times the agent notices excessive user dependency on itself and pulls back.

### 14.4 Comparison baselines

- Stateless prompted version of same provider (no memory, no self-state).
- Vector-only memory version (no semantic store, no self-state).
- Memory + static character (no self-state evolution).

These isolate the contribution of each architectural component.

---

## 15. Prior Art (Reading List)

- Park, J. S. et al. (2023). *Generative Agents: Interactive Simulacra of Human Behavior.*
- Packer, C. et al. (2023). *MemGPT: Towards LLMs as Operating Systems.*
- Shinn, N. et al. (2023). *Reflexion: Language Agents with Verbal Reinforcement Learning.*
- Horvitz, E. (1999). *Principles of Mixed-Initiative User Interfaces.*
- Amershi, S. et al. (2019). *Guidelines for Human-AI Interaction.*
- Hagendorff, T. *Machine Psychology* (series of papers, 2023–).
- Picard, R. *Affective Computing* (foundational, 1997).
- Companion AI ethics — Replika attachment studies, parasocial dynamics literature.

(Expand as thesis lit review proceeds.)

---

## 16. Open Questions

This section is deliberately maintained as a place for unresolved decisions.

- Should `disposition` be a fixed vector of named dimensions, or an extensible labeled space the agent can grow new dimensions in?
- Where exactly does the agent's "voice" live — in `identity_core`, in `disposition`, or as a separate field?
- How aggressive should anti-sycophancy be? Configurable, or fixed by design principle?
- Should there be a "user-facing self-state inspector" by default, or is that observability-only?
- Multi-user support (one daemon, many people): in scope for thesis, or post-thesis?
- Privacy / threat model for the local state DB. Encryption at rest?
- Token-budgeting strategy for SystemBlock assembly under tight context limits.

---

## 17. Glossary

- **Episodic memory.** Timestamped record of a specific event or moment.
- **Semantic memory.** Derived pattern or claim distilled from many episodes.
- **Salience.** Agent-scored importance of an episodic record. Drives storage, retrieval, decay.
- **Self-state.** The agent's evolving model of itself, layered by drift speed.
- **Drift speed.** Rate at which a self-state layer changes. Critical for identity stability.
- **Dream cycle.** Background consolidation, reflection, and candidate-ping generation.
- **Proactive engine.** Subsystem responsible for deciding when, what, and whether to ping.
- **Flourishing-aligned.** Design orientation: long-term user wellbeing + autonomy preservation. Neither sycophantic nor paternalistic.
- **Artificial psychology.** Working field name. Study of AI as a psychological agent that develops and forms relationships.
- **SystemBlock.** Cacheable unit of system prompt. Anthropic adapter applies `cache_control: ephemeral`; others ignore.
- **Unified persona.** All channels read/write the same memory and self-state. Same self, different surfaces.

---

*Document version: 0.1. Living document. Edit freely as design choices evolve.*
