"""Turn loop: the per-turn orchestration that ties memory, self-state,
and the chat provider together.

Layered like the rest of Phase 1:

- [`tools`][glashaus.turn.tools] — the two canonical Tool definitions
  (`record_turn`, `update_self_state`) with strict JSON schemas. The
  schemas exclude identity_core entirely, enforce `evidence_ids`
  non-empty for formed_opinions, and treat disposition / relational
  drifts as *signals* (direction + magnitude), not absolute values.
- [`parse`][glashaus.turn.parse] — typed dataclasses + parsers that
  validate beyond the JSON schema (enum membership, numeric ranges,
  required-but-non-empty). Failure here = ToolCallParseError so the
  provider retry loop fires.
- [`assemble`][glashaus.turn.assemble] — builds the 12-position system-
  block array per the chunk 5 cache-block layout. Cache breakpoints at
  positions 2 / 3 / 6 with ttl=3600.
- [`apply`][glashaus.turn.apply] — translates parsed deltas into store
  writes. Calls dynamics for drift math. Never returns "I succeeded"
  if it didn't — exceptions propagate.
- [`loop`][glashaus.turn.loop] — the orchestrator. Streams text to a
  callback, processes tool calls post-stream, retries record_turn,
  defers update_self_state failures.
"""

from glashaus.turn.apply import apply_record_turn, apply_self_state_update
from glashaus.turn.assemble import assemble_system_blocks
from glashaus.turn.loop import TurnInput, TurnResult, TurnRunner
from glashaus.turn.parse import (
    CurrentStateDelta,
    DispositionDriftSignal,
    OpinionDelta,
    QuirkDelta,
    RelationalStanceDelta,
    SelfStateUpdate,
    TurnRecord,
    parse_record_turn,
    parse_update_self_state,
)
from glashaus.turn.tools import (
    RECORD_TURN_TOOL,
    TURN_TOOLS,
    UPDATE_SELF_STATE_TOOL,
)

__all__ = [
    "RECORD_TURN_TOOL",
    "TURN_TOOLS",
    "UPDATE_SELF_STATE_TOOL",
    "CurrentStateDelta",
    "DispositionDriftSignal",
    "OpinionDelta",
    "QuirkDelta",
    "RelationalStanceDelta",
    "SelfStateUpdate",
    "TurnInput",
    "TurnRecord",
    "TurnResult",
    "TurnRunner",
    "apply_record_turn",
    "apply_self_state_update",
    "assemble_system_blocks",
    "parse_record_turn",
    "parse_update_self_state",
]
