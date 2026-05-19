"""argparse dispatcher.

Subcommands attach their handler functions via `set_defaults(func=...)`.
`main` resolves the namespace and calls that. This keeps the command
implementations decoupled from the parser — each handler is reachable
from tests without going through argparse.
"""

from __future__ import annotations

import argparse
import sys
from collections.abc import Sequence

from glashaus import __version__
from glashaus.cli.chat_cmd import run_chat
from glashaus.cli.inspect_cmd import run_memory_inspect, run_memory_search, run_self


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="glashaus",
        description="A long-running personal AI companion.",
    )
    parser.add_argument("--version", action="version", version=f"glashaus {__version__}")

    sub = parser.add_subparsers(dest="command", metavar="<command>")

    # --- chat -----------------------------------------------------------
    chat = sub.add_parser("chat", help="streaming chat session")
    chat.add_argument(
        "--model",
        default=None,
        help="override the chat model (default: kimi-k2.6:cloud)",
    )
    chat.add_argument(
        "--temperature",
        type=float,
        default=None,
        help="override sampling temperature (default: 0.7)",
    )
    chat.set_defaults(func=run_chat)

    # --- self -----------------------------------------------------------
    self_cmd = sub.add_parser("self", help="print current self-state")
    self_cmd.set_defaults(func=run_self)

    # --- memory ---------------------------------------------------------
    memory = sub.add_parser("memory", help="inspect memory store")
    memory_sub = memory.add_subparsers(dest="memory_command", metavar="<sub>")

    search = memory_sub.add_parser("search", help="ranked search across memory")
    search.add_argument("query", help="search query (FTS-style)")
    search.add_argument("--limit", type=int, default=10, help="max results per store (default: 10)")
    search.set_defaults(func=run_memory_search)

    inspect = memory_sub.add_parser("inspect", help="show one episodic by id")
    inspect.add_argument("id", help="episodic id")
    inspect.set_defaults(func=run_memory_inspect)

    # `glashaus memory` without a subcommand falls through to help below.
    memory.set_defaults(func=_memory_help_only)

    return parser


def _memory_help_only(args: argparse.Namespace) -> int:
    sys.stderr.write("usage: glashaus memory {search,inspect} ...\n")
    return 2


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if not hasattr(args, "func"):
        parser.print_help()
        return 0
    rc = args.func(args)
    return int(rc) if rc is not None else 0
