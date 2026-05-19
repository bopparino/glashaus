"""Phase 0 smoke tests.

Just enough to prove the package imports, the CLI runs, and the logging
skeleton can emit something without crashing. Real coverage starts in
Phase 1.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from glashaus import __version__, cli
from glashaus import logging as gh_logging


def test_package_version_is_string() -> None:
    assert isinstance(__version__, str)
    assert __version__  # non-empty


def test_cli_runs_with_no_args(capsys: pytest.CaptureFixture[str]) -> None:
    rc = cli.main([])
    assert rc == 0
    captured = capsys.readouterr()
    assert "glashaus" in captured.out.lower()


def test_cli_version_flag(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as excinfo:
        cli.main(["--version"])
    assert excinfo.value.code == 0
    assert __version__ in capsys.readouterr().out


def test_logging_jsonl_sink_writes_valid_json(tmp_path: Path) -> None:
    """The JSONL sink must produce one valid JSON object per line. This is
    the audit-trail contract referenced in plan §12."""
    log_file = tmp_path / "glashaus.jsonl"
    gh_logging.configure_logging(json_logs=True, log_file=log_file)
    log = gh_logging.get_logger("test")
    log.info("phase0.smoke", marker="hello")

    # The structlog console renderer is what `info` hits in json_logs=True
    # mode; the stdlib FileHandler is what we want to check. Force a stdlib
    # call to exercise the sink, since structlog and stdlib paths are
    # independently wired.
    import logging as stdlib_logging

    stdlib_logging.getLogger("test").info("phase0.smoke.stdlib")

    assert log_file.exists()
    lines = [ln for ln in log_file.read_text().splitlines() if ln.strip()]
    assert lines, "expected at least one JSONL line"
    for line in lines:
        json.loads(line)  # raises on invalid JSON
