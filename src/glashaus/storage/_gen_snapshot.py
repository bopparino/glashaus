"""Regenerate `tests/fixtures/schema_snapshot.sql`.

Invoke when a deliberate schema change has been made and the schema-snapshot
test is failing on purpose:

    uv run python -m glashaus.storage._gen_snapshot > tests/fixtures/schema_snapshot.sql

The output is the current normalized schema dump after applying every
migration in order. Sent to stdout so the call site decides where it
lands.
"""

from __future__ import annotations

import sys

from glashaus.storage import MigrationRunner, connect, dump_schema


def main() -> int:
    conn = connect(":memory:")
    try:
        runner = MigrationRunner(conn)
        final = runner.apply_all()
        print(f"-- applied through migration {final}", file=sys.stderr)
        sys.stdout.write(dump_schema(conn))
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
