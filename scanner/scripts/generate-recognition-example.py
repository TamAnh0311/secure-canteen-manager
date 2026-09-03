"""Generate clearly synthetic recognition benchmark inputs and manifests."""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output", type=Path, default=Path("var/recognition-benchmark-example")
    )
    args = parser.parse_args()
    output = args.output
    output.mkdir(parents=True, exist_ok=True)

    catalogue = {
        "version": "catalogue-example-v1",
        "created_at": datetime(2026, 8, 4, tzinfo=UTC).isoformat().replace("+00:00", "Z"),
        "items": [
            {"item_id": "001", "canonical_name": "Phở bò", "aliases": ["pho bo"]},
            {"item_id": "002", "canonical_name": "Phở gà", "aliases": ["pho ga"]},
            {"item_id": "003", "canonical_name": "Bánh mì", "aliases": ["BM"]},
            {"item_id": "004", "canonical_name": "Cơm tấm", "aliases": ["com tam"]},
        ],
    }
    catalogue_path = output / "catalogue.example.json"
    catalogue_bytes = _write_json(catalogue_path, catalogue)

    annotations_path = output / "annotations.example.jsonl"
    records = [_annotation(index) for index in range(10)]
    annotations_path.write_text(
        "".join(
            json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n" for record in records
        ),
        encoding="utf-8",
    )

    prepare_script = Path(__file__).with_name("prepare-dataset.py")
    subprocess.run(
        [
            sys.executable,
            str(prepare_script),
            str(annotations_path),
            "--output",
            str(output / "dataset-manifest.example.json"),
            "--seed",
            "42",
        ],
        check=True,
    )

    model_artifact = output / "synthetic-model-artifact.txt"
    model_artifact.write_text("synthetic demo only; not an OCR model\n", encoding="utf-8")
    model_manifest = {
        "schema_version": "order-scanner-model-manifest-v1",
        "model_id": "synthetic-demo-backend",
        "version": "demo-1",
        "sha256": _sha256(model_artifact),
        "runtime": "demo-backend",
        "precision": "fp32",
        "input_contract": "ticket-v4/item-line-grayscale-v1",
        "output_contract": "unicode-nbest-v1",
        "catalogue_version": catalogue["version"],
        "catalogue_sha256": hashlib.sha256(catalogue_bytes).hexdigest(),
        "thresholds": {
            "minimum_item_score": 0.8,
            "minimum_candidate_margin": 0.1,
        },
        "cpu_requirements": {"architecture": "demo", "instruction_sets": []},
        "synthetic_demo": True,
    }
    _write_json(output / "model-manifest.example.json", model_manifest)

    predictions_path = output / "predictions.example.jsonl"
    predictions_path.write_text(
        "".join(json.dumps(_prediction(index), sort_keys=True) + "\n" for index in range(10)),
        encoding="utf-8",
    )


def _annotation(index: int) -> dict[str, object]:
    rows: list[dict[str, object]] = [
        {
            "blank": False,
            "item_transcription": "Phở bò",
            "catalogue_item_id": "001",
            "quantity": 2,
        }
    ]
    rows.extend(
        {
            "blank": True,
            "item_transcription": None,
            "catalogue_item_id": None,
            "quantity": None,
        }
        for _ in range(11)
    )
    return {
        "sample_id": f"example-{index:02d}",
        "writer_id": f"writer-{index:02d}",
        "page_id": f"page-{index:02d}",
        "marker_corners": [[0, 0], [100, 0], [100, 100], [0, 100]],
        "id_cells": list("012345"),
        "room_cells": list("A1"),
        "rows": rows,
        "ambiguity_notes": "Synthetic fixture; not representative handwriting.",
    }


def _prediction(index: int) -> dict[str, object]:
    fields: dict[str, object] = {
        "ma_luu_ky": "012345",
        "buong_giam": "A1",
        "items.0.blank": False,
        "items.0.item": "001",
        "items.0.quantity": 2,
    }
    candidates = {"items.0.item": ["001", "002"]}
    for row_index in range(1, 12):
        fields[f"items.{row_index}.blank"] = True
    return {
        "sample_id": f"example-{index:02d}",
        "writer_id": f"writer-{index:02d}",
        "fields": fields,
        "candidates": candidates,
        "accepted": True,
        "blank": False,
        "latency_ms": 12.0,
        "rss_mb": 100.0,
    }


def _write_json(path: Path, value: object) -> bytes:
    payload = (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode()
    path.write_bytes(payload)
    return payload


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


if __name__ == "__main__":
    main()
