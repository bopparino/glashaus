"""Read-only commands: `glashaus self`, `glashaus memory search/inspect`.

All three open the state DB read-only-ish (the open_state_db factory
applies the same WAL+vec config as chat), fetch what's needed, and
print. No interactivity, no provider calls.

These commands are safe to invoke during an active chat session — WAL
mode means concurrent readers don't block the writer.
"""

from __future__ import annotations

import argparse
import sys
from typing import TextIO

from glashaus.cli.format import (
    format_episodic_full,
    format_episodic_search_results,
    format_self_state,
    format_semantic_search_results,
)
from glashaus.memory.store import MemoryStore
from glashaus.retrieval.retriever import HybridRetriever
from glashaus.retrieval.types import RetrievalConfig, RetrievalContext
from glashaus.self_state.store import SelfStateStore
from glashaus.storage import open_state_db
from glashaus.storage.runner import MigrationRunner


def run_self(args: argparse.Namespace, *, stdout: TextIO | None = None) -> int:
    out = stdout or sys.stdout
    conn = open_state_db()
    MigrationRunner(conn).apply_all()
    self_state = SelfStateStore(conn)
    if not self_state.is_initialized():
        out.write(
            "self-state not initialized yet. Run `glashaus chat` to start the first-run wizard.\n"
        )
        return 1
    out.write(format_self_state(self_state.get()))
    return 0


def run_memory_search(args: argparse.Namespace, *, stdout: TextIO | None = None) -> int:
    out = stdout or sys.stdout
    conn = open_state_db()
    MigrationRunner(conn).apply_all()

    # Search runs the retriever directly — no LLM, no embedder. Vec
    # branch falls back to 0 as designed; FTS + temporal + salience do
    # the work.
    config = RetrievalConfig(
        episodic_limit=args.limit,
        semantic_limit=args.limit,
    )
    retriever = HybridRetriever(conn, config=config)
    ctx = RetrievalContext(user_query=args.query)

    eps_scored = retriever.retrieve_episodic(ctx)
    sms_scored = retriever.retrieve_semantic(ctx)

    out.write(format_episodic_search_results([s.memory for s in eps_scored]))
    out.write("\n")
    out.write(format_semantic_search_results([s.memory for s in sms_scored]))
    return 0


def run_memory_inspect(args: argparse.Namespace, *, stdout: TextIO | None = None) -> int:
    out = stdout or sys.stdout
    conn = open_state_db()
    MigrationRunner(conn).apply_all()
    memory = MemoryStore(conn)

    ep = memory.get_episodic(args.id)
    if ep is None:
        out.write(f"No episodic with id {args.id!r}\n")
        return 1
    out.write(format_episodic_full(ep))
    return 0
