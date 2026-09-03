from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]


def test_generated_recognition_example_is_benchmarkable(tmp_path: Path) -> None:
    example = tmp_path / "recognition-benchmark"
    generate = subprocess.run(
        [
            sys.executable,
            str(ROOT / "scripts" / "generate-recognition-example.py"),
            "--output",
            str(example),
        ],
        capture_output=True,
        text=True,
    )
    assert generate.returncode == 0, generate.stderr

    benchmark = subprocess.run(
        [
            sys.executable,
            str(ROOT / "scripts" / "benchmark-models.py"),
            "--annotations",
            str(example / "annotations.example.jsonl"),
            "--predictions",
            str(example / "predictions.example.jsonl"),
            "--dataset-manifest",
            str(example / "dataset-manifest.example.json"),
            "--model-manifest",
            str(example / "model-manifest.example.json"),
            "--split",
            "test",
            "--output",
            str(example / "report.example.json"),
        ],
        capture_output=True,
        text=True,
    )
    assert benchmark.returncode == 0, benchmark.stderr
    report = json.loads((example / "report.example.json").read_text(encoding="utf-8"))
    assert report["sample_count"] == 2
    assert report["model"]["model_id"] == "synthetic-demo-backend"


def test_scanner_inbox_validation_can_keep_pilot_artifacts(tmp_path: Path) -> None:
    inbox = tmp_path / "inbox"
    inbox.mkdir()
    Image.new("L", (120, 80), 240).save(inbox / "scan.png")
    output = tmp_path / "pilot"

    result = subprocess.run(
        [
            sys.executable,
            str(ROOT / "scripts" / "validate-scanner-inbox.py"),
            "--inbox",
            str(inbox),
            "--output",
            str(output),
        ],
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stderr
    summary = json.loads((output / "summary.json").read_text(encoding="utf-8"))
    assert summary[0]["file"] == "scan.png"
    assert summary[0]["status"] == "processed"
    assert summary[0]["reasons"] == ["registration_markers_missing"]
    assert (output / "state.sqlite3").is_file()
    assert tuple((output / "spool" / "sources").rglob("*.bin"))


def test_prepare_dataset_writes_hashed_writer_split_manifest(tmp_path: Path) -> None:
    annotations = tmp_path / "private-annotations.jsonl"
    manifest = tmp_path / "dataset-manifest.json"
    record = {
        "sample_id": "sample-1",
        "writer_id": "writer-1",
        "page_id": "page-1",
        "marker_corners": [[0, 0], [10, 0], [10, 20], [0, 20]],
        "id_cells": list("012345"),
        "room_cells": list("A1"),
        "rows": [
            {
                "blank": True,
                "item_transcription": None,
                "catalogue_item_id": None,
                "quantity": None,
            }
            for _ in range(12)
        ],
        "ambiguity_notes": None,
    }
    annotations.write_text(json.dumps(record) + "\n", encoding="utf-8")

    result = subprocess.run(
        [
            sys.executable,
            str(ROOT / "scripts" / "prepare-dataset.py"),
            str(annotations),
            "--output",
            str(manifest),
        ],
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stderr
    payload = json.loads(manifest.read_text(encoding="utf-8"))
    assert payload["schema_version"] == "order-scanner-dataset-v1"
    assert payload["sample_count"] == 1
    assert payload["splits"] == {"test": [], "train": ["sample-1"], "validation": []}
    assert len(payload["annotations_sha256"]) == 64


def test_prepare_dataset_rejects_quantity_over_configured_maximum(tmp_path: Path) -> None:
    annotations = tmp_path / "private-annotations.jsonl"
    record = {
        "sample_id": "sample-1",
        "writer_id": "writer-1",
        "page_id": "page-1",
        "marker_corners": [[0, 0], [10, 0], [10, 20], [0, 20]],
        "id_cells": list("012345"),
        "room_cells": list("A1"),
        "rows": [
            {
                "blank": False,
                "item_transcription": "Bánh mì",
                "catalogue_item_id": "item-1",
                "quantity": 1_000 if index == 0 else 1,
            }
            for index in range(12)
        ],
        "ambiguity_notes": None,
    }
    annotations.write_text(json.dumps(record) + "\n", encoding="utf-8")

    result = subprocess.run(
        [
            sys.executable,
            str(ROOT / "scripts" / "prepare-dataset.py"),
            str(annotations),
            "--output",
            str(tmp_path / "manifest.json"),
        ],
        capture_output=True,
        text=True,
    )

    assert result.returncode != 0
    assert "quantity exceeds configured maximum" in result.stderr


def test_benchmark_script_records_model_identity_and_metrics(tmp_path: Path) -> None:
    annotations = tmp_path / "annotations.jsonl"
    predictions = tmp_path / "predictions.jsonl"
    dataset_manifest = tmp_path / "dataset-manifest.json"
    model_manifest = tmp_path / "model-manifest.json"
    report = tmp_path / "report.json"
    annotations.write_text(
        json.dumps(
            {
                "sample_id": "sample-1",
                "writer_id": "writer-1",
                "page_id": "page-1",
                "fields": {"items.0.item": "item-1"},
            }
        )
        + "\n",
        encoding="utf-8",
    )
    predictions.write_text(
        json.dumps(
            {
                "sample_id": "sample-1",
                "writer_id": "writer-1",
                "fields": {"items.0.item": "item-1"},
                "candidates": {"items.0.item": ["item-1"]},
                "accepted": True,
                "latency_ms": 12.5,
                "rss_mb": 100,
            }
        )
        + "\n",
        encoding="utf-8",
    )
    dataset_manifest.write_text(
        json.dumps(
            {
                "schema_version": "order-scanner-dataset-v1",
                "annotations_sha256": hashlib.sha256(annotations.read_bytes()).hexdigest(),
                "splits": {"train": ["sample-1"], "validation": [], "test": []},
            }
        ),
        encoding="utf-8",
    )
    model_manifest.write_text(
        json.dumps(
            {
                "schema_version": "order-scanner-model-manifest-v1",
                "model_id": "item-line-v1",
                "version": "1.0.0",
                "sha256": "a" * 64,
                "runtime": "onnxruntime-cpu",
                "precision": "fp32",
                "input_contract": "ticket-v4/item-line-grayscale-v1",
                "output_contract": "unicode-nbest-v1",
                "catalogue_version": "catalogue-1",
                "catalogue_sha256": "b" * 64,
                "thresholds": {
                    "minimum_candidate_margin": 0.1,
                    "minimum_item_score": 0.8,
                },
                "cpu_requirements": {"architecture": "x86_64", "instruction_sets": []},
            }
        ),
        encoding="utf-8",
    )

    result = subprocess.run(
        [
            sys.executable,
            str(ROOT / "scripts" / "benchmark-models.py"),
            "--annotations",
            str(annotations),
            "--predictions",
            str(predictions),
            "--dataset-manifest",
            str(dataset_manifest),
            "--split",
            "train",
            "--model-manifest",
            str(model_manifest),
            "--output",
            str(report),
        ],
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stderr
    payload = json.loads(report.read_text(encoding="utf-8"))
    assert payload["field_exact_match"] == 1.0
    assert payload["item_top3"] == 1.0
    assert payload["model"]["model_id"] == "item-line-v1"
    assert payload["model"]["catalogue_version"] == "catalogue-1"
    assert payload["dataset"]["split"] == "train"
