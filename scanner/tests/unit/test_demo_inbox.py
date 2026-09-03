from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


def test_generate_demo_inbox_uses_catalogue_item_and_seed_identity(tmp_path: Path) -> None:
    catalogue = tmp_path / "catalogue.json"
    catalogue.write_text(
        json.dumps(
            {
                "schemaVersion": "scanner-catalogue-v1",
                "version": "catalogue-demo",
                "items": [{"catalogueItemId": "001", "name": "Mì tôm Hảo Hảo", "active": True}],
            }
        ),
        encoding="utf-8",
    )
    output = tmp_path / "inbox"
    scanner_catalogue = tmp_path / "scanner-catalogue.json"
    result = subprocess.run(
        [
            sys.executable,
            str(Path(__file__).parents[2] / "scripts/generate-demo-inbox.py"),
            "--catalogue",
            str(catalogue),
            "--output",
            str(output),
            "--scanner-catalogue",
            str(scanner_catalogue),
        ],
        check=True,
        capture_output=True,
        text=True,
    )

    metadata = json.loads((output / "demo-100001-ticket-v4.json").read_text(encoding="utf-8"))
    assert metadata["document_code"] == "100001"
    assert metadata["room"] == "A1"
    assert metadata["item_id"] == "001"
    assert metadata["quantity"] == 2
    assert metadata["catalogue_version"] == "catalogue-demo"
    assert (output / "demo-100001-ticket-v4.png").read_bytes().startswith(b"\x89PNG")
    scanner_payload = json.loads(scanner_catalogue.read_text(encoding="utf-8"))
    assert scanner_payload["version"] == "catalogue-demo"
    assert scanner_payload["items"][0]["item_id"] == "001"
    assert scanner_payload["items"][0]["aliases"] == ["Mi tom Hao Hao"]
    assert "catalogue-demo" in result.stdout
