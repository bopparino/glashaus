"""Structured logging skeleton for GlasHaus.

Phase 0 only stands this up; nothing is wired through it yet. The intent
documented in the plan (§12 Observability) is that *every* memory write,
self-state update, dream cycle, and ping decision flows through this and
lands in a local JSONL file (the thesis-time audit trail), with a pretty
renderer for the developer console.

Usage from anywhere in the codebase:

    from glashaus.logging import get_logger
    log = get_logger(__name__)
    log.info("memory.write", episodic_id=..., salience=...)

Configuration is intentionally one call (`configure_logging`) — wired from
the daemon entrypoint in Phase 1+. Until then, callers that import this
module will get a sensible console-pretty default.
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path
from typing import Any

import structlog
from structlog.typing import EventDict, Processor

_configured = False


def configure_logging(
    *,
    level: str = "INFO",
    json_logs: bool = False,
    log_file: Path | None = None,
) -> None:
    """Initialize structlog + stdlib logging.

    - `json_logs=True` is the production shape: one JSON object per line,
      machine-parseable, suitable for the audit trail.
    - `json_logs=False` is the dev shape: colorized console output.
    - `log_file`, if set, additionally writes JSONL to that path regardless
      of console renderer. This is what the daemon will use in Phase 1+.
    """
    global _configured

    timestamper = structlog.processors.TimeStamper(fmt="iso", utc=True)

    shared_processors: list[Processor] = [
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.StackInfoRenderer(),
        timestamper,
    ]

    if json_logs:
        renderer: Processor = structlog.processors.JSONRenderer()
    else:
        renderer = structlog.dev.ConsoleRenderer(colors=sys.stderr.isatty())

    structlog.configure(
        processors=[
            *shared_processors,
            structlog.processors.format_exc_info,
            renderer,
        ],
        wrapper_class=structlog.make_filtering_bound_logger(
            logging.getLevelNamesMapping()[level.upper()]
        ),
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(file=sys.stderr),
        # Don't cache loggers — we want re-calls to configure_logging()
        # (e.g., the chat command muting INFO during interactive use)
        # to take effect on already-imported modules that grabbed a
        # logger at import time. The per-call dict lookup overhead is
        # negligible at chat-loop scale.
        cache_logger_on_first_use=False,
    )

    # If a sink file is configured, also write JSONL there. This is the
    # audit trail referenced in §12 of the plan.
    if log_file is not None:
        log_file.parent.mkdir(parents=True, exist_ok=True)
        _attach_jsonl_sink(log_file, shared_processors)

    _configured = True


def _attach_jsonl_sink(path: Path, shared_processors: list[Processor]) -> None:
    """Attach a stdlib FileHandler that writes JSONL via structlog formatting."""
    handler = logging.FileHandler(path, encoding="utf-8")
    formatter = structlog.stdlib.ProcessorFormatter(
        processor=structlog.processors.JSONRenderer(),
        foreign_pre_chain=shared_processors,
    )
    handler.setFormatter(formatter)

    root = logging.getLogger()
    root.addHandler(handler)
    root.setLevel(logging.INFO)


def get_logger(name: str | None = None, **initial_values: Any) -> structlog.stdlib.BoundLogger:
    """Return a bound logger. Auto-configures on first use if needed."""
    if not _configured:
        configure_logging()
    logger: structlog.stdlib.BoundLogger = structlog.get_logger(name)
    if initial_values:
        return logger.bind(**initial_values)
    return logger


# Re-export for convenience in type signatures.
__all__ = ["EventDict", "configure_logging", "get_logger"]
