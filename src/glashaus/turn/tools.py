"""Canonical tool definitions for the turn loop.

Two tools, both fired in the model's response each turn:

1. `record_turn` — agent's processed memory of the turn. Episode summary
   is the AGENT'S words about what just happened, not the raw user
   transcript. (The verbatim transcript is in conversation history,
   passed via `messages=`.)

2. `update_self_state` — proposed deltas. All top-level fields are
   optional EXCEPT `turn_id` so the model emits only what changed.
   Hard schema rules enforced here:

   - `identity_core` is absent from the schema — turn loop cannot mutate
     it. (Anchor updates happen via SelfStateStore.update_identity_core
     directly, never through this path.)
   - Drift fields (`disposition_drift`, `trust_drift`,
     `familiarity_drift`) are DRIFT INPUTS — direction/magnitude or
     scalar magnitude — never absolute new values. The dynamics module
     applies bounded EWMA.
   - `formed_opinions[*].evidence_ids` has `minItems: 1`. Opinions
     without supporting episodes don't enter the store.
   - Top-level `additionalProperties: false` so anything that
     accidentally tries to land here (e.g., `identity_core`) bounces
     off at schema-validation time.

Both tools share a `turn_id` so a retry of `update_self_state` after a
deferred failure can be deduped against the same record.
"""

from __future__ import annotations

from typing import Final

from glashaus.providers.base import Tool

# Disposition dimensions the schema accepts. Kept here in addition to
# self_state.types.DISPOSITION_FIELDS so the schema constants are local
# to the tools file (no late-binding imports inside the dict literal).
_DISPOSITION_DIMENSION_NAMES: Final[list[str]] = [
    "curiosity",
    "playfulness",
    "reserve",
    "warmth",
    "directness",
]


RECORD_TURN_TOOL: Final[Tool] = Tool(
    name="record_turn",
    description=(
        "Record an episodic memory of this turn. `episode_summary` is "
        "YOUR processed memory of what happened, in your own words — "
        "not a paraphrase of the user. Score salience honestly: most "
        "small-talk turns are ~0.1-0.3; only deeply significant moments "
        "approach 1.0."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "turn_id": {
                "type": "string",
                "description": "Stable id for this turn. Must match the turn_id on update_self_state.",
            },
            "episode_summary": {
                "type": "string",
                "description": "Agent's own-words summary, not raw transcript.",
            },
            "affect": {
                "type": "object",
                "properties": {
                    "valence": {"type": "number", "minimum": -1, "maximum": 1},
                    "arousal": {"type": "number", "minimum": 0, "maximum": 1},
                    "dominant_emotion": {"type": "string"},
                },
                "required": ["valence", "arousal", "dominant_emotion"],
                "additionalProperties": False,
            },
            "salience": {"type": "number", "minimum": 0, "maximum": 1},
            "topics": {
                "type": "array",
                "items": {"type": "string"},
                "default": [],
            },
            "references": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Episodic ids of prior turns this one consciously continues.",
                "default": [],
            },
        },
        "required": ["turn_id", "episode_summary", "affect", "salience"],
        "additionalProperties": False,
    },
)


UPDATE_SELF_STATE_TOOL: Final[Tool] = Tool(
    name="update_self_state",
    description=(
        "Propose self-state updates for this turn. Emit ONLY the fields "
        "that actually changed. Drift fields (disposition_drift, "
        "trust_drift, familiarity_drift) are signals — direction and "
        "magnitude — not new absolute values. The system applies bounded "
        "EWMA. `identity_core` (name, voice, base_values) cannot be "
        "modified through this tool."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "turn_id": {
                "type": "string",
                "description": "Must match the turn_id from record_turn.",
            },
            "current_state": {
                "type": "object",
                "properties": {
                    "mood": {"type": "string"},
                    "energy": {"type": "number", "minimum": 0, "maximum": 1},
                    "preoccupations": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                },
                "additionalProperties": False,
            },
            "relational_stance": {
                "type": "object",
                "properties": {
                    "trust_drift": {
                        "type": "number",
                        "minimum": 0,
                        "maximum": 1,
                        "description": (
                            "Magnitude in [0,1] of this turn's upward "
                            "pull on trust. Pass 0 (or omit) if no pull."
                        ),
                    },
                    "familiarity_drift": {
                        "type": "number",
                        "minimum": 0,
                        "maximum": 1,
                    },
                    "current_warmth": {
                        "type": "number",
                        "minimum": 0,
                        "maximum": 1,
                        "description": (
                            "Absolute new value for current_warmth. "
                            "More volatile than trust/familiarity."
                        ),
                    },
                    "history_marker": {
                        "type": "string",
                        "description": (
                            "Significant-moment marker (e.g. episodic id) "
                            "appended to history_markers."
                        ),
                    },
                },
                "additionalProperties": False,
            },
            "disposition_drift": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "dimension": {
                            "type": "string",
                            "enum": _DISPOSITION_DIMENSION_NAMES,
                        },
                        "direction": {
                            "type": "integer",
                            "enum": [-1, 1],
                        },
                        "magnitude_weight": {
                            "type": "number",
                            "minimum": 0,
                            "maximum": 1,
                        },
                    },
                    "required": ["dimension", "direction", "magnitude_weight"],
                    "additionalProperties": False,
                },
            },
            "formed_opinions": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "claim": {"type": "string"},
                        "evidence_ids": {
                            "type": "array",
                            "items": {"type": "string"},
                            "minItems": 1,  # schema-level enforcement
                        },
                    },
                    "required": ["claim", "evidence_ids"],
                    "additionalProperties": False,
                },
            },
            "quirks": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "pattern": {"type": "string"},
                    },
                    "required": ["pattern"],
                    "additionalProperties": False,
                },
            },
        },
        "required": ["turn_id"],
        # The hard line that keeps identity_core out: anything not
        # explicitly listed here (`identity_name`, `voice`, etc.) is
        # rejected by the schema layer before parse even runs.
        "additionalProperties": False,
    },
)


TURN_TOOLS: Final[tuple[Tool, ...]] = (RECORD_TURN_TOOL, UPDATE_SELF_STATE_TOOL)
