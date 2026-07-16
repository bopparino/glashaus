# Changelog

## 2.0.0 — 2026-07-16

The premier release: voice, vocabulary, and bulletproofing.

- Lexicon: `persona/lexicon.md` vocabulary system — core words always in
  context, the rest retrieval-triggered; capture nominates new words heard in
  conversation for human approval (`glashaus lexicon`)
- Streamed replies in a redesigned terminal REPL with slash commands
  (`/facts`, `/mood`, `/dream`, `/lex`, `/redact-last`, `/ephemeral`)
- Split-brain models: `ollama.voiceModel` / `ollama.utilityModel`
- `glashaus audition <model>` — scored screen test (identity pressure, scene
  register, refusal posture, judged voice fidelity) against the live persona
- Identity immune system: prompt firewall, `lintIdentity()` detection with
  one-shot regeneration, capture/summarize treat identity malfunctions as
  machine noise, and reversible message redaction (`glashaus redact <a> [b]`)
- `glashaus export-corpus` + docs/fine-tune.md QLoRA→Ollama recipe
- Migrations v5 (redaction) and v6 (lexicon candidates)

## 1.0.0 — 2026-07-13

First public release: the GlasHaus thesis realized as a runtime.
