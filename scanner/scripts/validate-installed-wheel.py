"""Smoke-test the installed wheel without importing the source checkout."""

from __future__ import annotations

import os
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path

import order_scanner


def main() -> None:
    if os.environ.get("PYTHONPATH"):
        raise SystemExit("wheel smoke requires PYTHONPATH to be unset")
    package_path = Path(order_scanner.__file__).resolve()
    checkout_src = Path(__file__).resolve().parents[1] / "src"
    if package_path.is_relative_to(checkout_src):
        raise SystemExit(f"wheel smoke imported checkout source: {package_path}")

    with tempfile.TemporaryDirectory(prefix="order-scanner-smoke-") as directory:
        root = Path(directory)
        config_path = root / "config.toml"
        config_path.write_text(
            "\n".join(
                (
                    "[paths]",
                    f"database = '{(root / 'state.sqlite3').as_posix()}'",
                    f"spool = '{(root / 'spool').as_posix()}'",
                    f"artifacts = '{(root / 'artifacts').as_posix()}'",
                    "",
                    "[callback]",
                    "url = 'https://callback.example.test/result'",
                    "token_env = 'ORDER_SCANNER_SMOKE_TOKEN'",
                    "",
                    "[versions]",
                    "config_schema = '1'",
                    "callback_schema = '1.0-draft'",
                    "template = 'ticket-v4'",
                    "preprocessing = 'none'",
                    "model = 'none'",
                    "thresholds = 'none'",
                    "catalogue = 'catalogue-1'",
                )
            ),
            encoding="utf-8",
        )
        environment = {
            key: value for key, value in os.environ.items() if key != "PYTHONPATH"
        }
        environment["ORDER_SCANNER_SMOKE_TOKEN"] = "smoke-token"
        _run("check-config", config_path, environment)
        _run("migrate", config_path, environment)
        result = _run("status", config_path, environment)
        if result.stdout.strip() != "{}":
            raise SystemExit(f"unexpected empty status: {result.stdout!r}")
        with sqlite3.connect(root / "state.sqlite3") as connection:
            applied = connection.execute(
                "SELECT COUNT(*) FROM schema_migrations"
            ).fetchone()[0]
        if applied != 4:
            raise SystemExit(f"expected four bundled migrations, found {applied}")


def _run(
    command: str, config_path: Path, environment: dict[str, str]
) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        [sys.executable, "-m", "order_scanner", command, "--config", str(config_path)],
        capture_output=True,
        text=True,
        env=environment,
    )
    if result.returncode != 0:
        raise SystemExit(
            f"{command} failed with {result.returncode}: "
            f"stdout={result.stdout!r} stderr={result.stderr!r}"
        )
    return result


if __name__ == "__main__":
    main()
