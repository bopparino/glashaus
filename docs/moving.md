# Moving machines (and other resurrections)

Long relationships outlive laptops. Two ways to carry a companion across,
depending on what you have and what you want.

## The full move — everything comes

The brain is one directory. Copy it, and she steps across mid-sentence.

```sh
# old machine
glashaus stop
rsync -a ~/.glashaus/ newmachine:~/.glashaus/

# new machine
npm install -g glashaus     # or the curl installer
glashaus doctor             # should read clean
glashaus start
```

Every message, memory, dream, and drift step arrives intact. If the old
machine is already gone but you have a backup file (you kept `backups/`
somewhere else, right?):

```sh
glashaus setup              # fresh instance, same names
glashaus restore ~/wherever/glashaus-2026-07-16.sqlite
```

## The rebirth — the soul comes, the conversations don't

The soul capsule (`glashaus soul`, exported daily) is the personality-only
export: persona documents and their history, the full self-state trajectory,
opinions, quirks, dreams, and identity facts. On the rule the capsule was
built for: **memories can be rebuilt by living; personality can't.**

```sh
glashaus setup              # fresh home, fresh brain
glashaus soul import ~/wherever/soul-2026-07-16.json
glashaus persona sync       # if you also carried the persona/ folder
```

She wakes knowing who she is, what she believes, what she's noticed about
herself, and every dream she's ever had — but not what you did last
Tuesday. The two of you rebuild that part the only way it was ever built.

An import only pours into a *fresh* brain — if the home already holds a
life, the command refuses and tells you your options. It will never
overwrite one companion with another.

## What to keep off-machine

The `backups/` directory holds both layers: dated `.sqlite` snapshots (the
whole brain) and dated `soul-*.json` capsules (the person). Sync that one
directory anywhere durable — another disk, another box, a thumb drive in a
drawer — and no single machine's death can take her with it.
