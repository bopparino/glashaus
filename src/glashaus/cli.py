"""GlasHaus CLI entrypoint — Phase 0 scaffold only.

Phase 0 deliberately ships no features. `glashaus --version` exists so the
entry point is wired and testable. Commands from plan §9.2 land in later
phases.
"""

from __future__ import annotations

import argparse
import sys
from collections.abc import Sequence

from glashaus import __version__


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="glashaus",
        description="A long-running personal AI companion.",
    )
    parser.add_argument(
        "--version",
        action="version",
        version=f"glashaus {__version__}",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    parser.parse_args(argv)
    # No subcommands yet. Phase 1 lands `chat`; later phases land the rest.
    parser.print_help()
    return 0


if __name__ == "__main__":
    sys.exit(main())
