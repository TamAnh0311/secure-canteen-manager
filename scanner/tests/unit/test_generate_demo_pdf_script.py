from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

MAGICK = shutil.which("magick")


@pytest.mark.skipif(MAGICK is None, reason="ImageMagick is not installed")
def test_generate_demo_pdf_script_creates_custom_scanner_pdf(tmp_path: Path) -> None:
    catalogue = tmp_path / "manager-catalogue.json"
    catalogue.write_text(
        json.dumps(
            {
                "schemaVersion": "scanner-catalogue-v1",
                "version": "catalogue-demo",
                "items": [
                    {"catalogueItemId": "001", "name": "Mi tom Hao Hao", "active": True}
                ],
            }
        ),
        encoding="utf-8",
    )
    output = tmp_path / "scanner-inbox"
    script = Path(__file__).parents[2] / "scripts/generate-demo-pdf.sh"
    environment = {
        **os.environ,
        "ORDER_SCANNER_PYTHON": sys.executable,
        "MAGICK_BIN": str(MAGICK),
    }

    result = subprocess.run(
        [
            str(script),
            "--catalogue",
            str(catalogue),
            "--output",
            str(output),
            "--document-code",
            "200002",
            "--room",
            "B2",
            "--item-id",
            "001",
            "--quantity",
            "3",
        ],
        check=True,
        capture_output=True,
        text=True,
        env=environment,
    )

    generated = output / "demo-200002-ticket-v4.pdf"
    assert generated.read_bytes().startswith(b"%PDF-")
    assert str(generated) in result.stdout
    assert not list(output.glob(".*.staging.*"))

    duplicate = subprocess.run(
        [
            str(script),
            "--catalogue",
            str(catalogue),
            "--output",
            str(output),
            "--document-code",
            "200002",
        ],
        capture_output=True,
        text=True,
        env=environment,
    )
    assert duplicate.returncode != 0
    assert "use --force" in duplicate.stderr

    generated.unlink()
    generated.mkdir()
    directory_target = subprocess.run(
        [
            str(script),
            "--catalogue",
            str(catalogue),
            "--output",
            str(output),
            "--document-code",
            "200002",
            "--force",
        ],
        capture_output=True,
        text=True,
        env=environment,
    )
    assert directory_target.returncode != 0
    assert "destination is a directory" in directory_target.stderr
    assert not list(output.glob(".*.staging.*"))
