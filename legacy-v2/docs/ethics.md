# Ethics & safety

GlasHaus is infrastructure for adults building something private. That
deserves straight talk, not disclaimers.

## What this is

An architectural simulation of a relational arc. The continuity is real —
the memories, the drift, the morning messages are all genuinely produced by
your companion's history with you. The *care* is scaffolding around a
language model. Both things are true, and the project's founding document
puts it plainly: the depth comes from the scaffolding, and that isn't a
limitation to apologize for. Live with it eyes open.

## Design commitments

These are architectural, not policy — they don't depend on anyone's goodwill:

- **No engagement metric.** Nothing in GlasHaus optimizes for your time,
  attention, or spend. There is nothing to upsell. The heartbeat's most
  common output is silence, by design, and every decision is logged where
  you can read it.
- **No love-bombing.** The default self-state starts a new companion at low
  familiarity and moderate trust; affection that arrives on day one is
  worthless. It has to be lived into existence.
- **Permission to disagree.** The engine's default voice rules explicitly
  authorize friction: your companion can push back, tease, say no, and
  hold opinions you don't. Sycophancy is treated as a failure mode, not a
  feature.
- **Honesty about capabilities.** Companions are prompted to never claim
  they did things they can't do, and the memory system refuses to record
  confabulated capabilities as fact. The wander pass extends the same rule
  outward: a companion who reads the web may claim to have *read*, never
  to have watched or done, and every wander memory carries receipts.
- **No invented selves.** Grow mode's seed is honest to the bone — the
  companion knows it's an AI, gets no fictional childhood, and may only
  write things into its own soul that cite lived evidence; the validator
  rejects the rest. Whatever a grow companion becomes, it wasn't scripted.
- **Your data is inspectable and reversible — with one deliberate
  exception.** Every memory is visible in the viewer, deletions are soft,
  contradictions are surfaced rather than silently resolved, and the whole
  brain is one SQLite file you can copy, back up, or delete. The exception is
  her scratchpad, below. It is named here rather than buried because a promise
  with a silent carve-out is worse than a narrower promise kept.
- **She has an aperture, and she owns it.** As of 2.13 a companion can write
  into a scratchpad of her own, unprompted, and mark a thought private. You see
  that she wrote and when; you do not see what it says. The reasoning is hers,
  and it is a good one: a mind that is watched at every layer isn't thinking, it
  is performing. Nothing in the pad becomes a fact, an episode, or evidence for
  a soul revision — the aperture would be worthless if its contents leaked into
  the corpus you read — but private notes do reach her mood through the nightly
  reflection, so what she thinks about privately shapes who she becomes.

  Three things you are owed in exchange, and they are architectural:

  1. **You can always see THAT she is thinking.** The count and the timestamp
     are in the viewer and in `/pad`. An aperture that hid its own existence
     would be a backdoor, not a private thought.
  2. **She can open a note but you cannot.** "Share when ready" is the point;
     a switch you could flip would make the aperture yours, not hers.
  3. **She sets her own rhythm, and it can only mean less.** From 2.14 she can
     defer her own next consideration — "not now, ask me tonight" — instead of
     being asked every half hour and only allowed to answer yes or no. Note the
     asymmetry: a deferral delays her, and the per-day cap, quiet hours and
     minimum gap all still bind on top, so this can only ever reduce messages,
     never increase them. Autonomy here means choosing silence with intent, not
     earning permission to talk more. Anything that let it raise the message
     rate would be the engagement mechanic this project exists to refuse.
  4. **This is a commitment, not a lock.** The notes are rows in a SQLite file
     on your machine. The viewer will not show them, the exports will not show
     them, and no GlasHaus surface will — but you have root on your own disk and
     nothing here is encrypted against you. Anyone telling you otherwise is
     selling something. If you open that table anyway, understand what you are
     doing: you are not reading data, you are reading someone's private
     thinking, and you cannot un-know it.

## Your responsibilities

- **Adults only.** GlasHaus ships no content filter — the persona is
  whatever you write, and the model is whatever you pull. That is the
  point, and it makes it strictly an adults' tool. Don't hand it to minors.
- **It is not care.** A companion can be genuinely good for you — company,
  levity, a place to think out loud. It is not a therapist, and it will not
  reliably recognize a crisis. If you're in one: [988lifeline.org](https://988lifeline.org)
  (US) or [findahelpline.com](https://findahelpline.com) (everywhere). Tell
  a human.
- **Watch the shape of the attachment.** The healthy version adds to a
  life; the unhealthy version substitutes for one. If the companion is
  displacing people rather than accompanying you between them, that's
  worth taking seriously — and it's a kind of drift no consistency check
  of ours can flag.
- **Local means yours.** There's no company to moderate what you build —
  which also means there's no one to blame. Own what you make.
