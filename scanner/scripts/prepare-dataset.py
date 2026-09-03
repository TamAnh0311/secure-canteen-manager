"""Validate private annotations and write a reproducible writer-disjoint manifest."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import random
from pathlib import Path
from typing import Any


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("annotations", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--quantity-max", type=int, default=999)
    args = parser.parse_args()
    records = _read_records(args.annotations)
    if args.quantity_max < 1:
        raise SystemExit("--quantity-max must be positive")
    _validate_records(records, args.quantity_max)
    split = _writer_splits(records, args.seed)
    payload = {
        "schema_version": "order-scanner-dataset-v1",
        "annotations_sha256": hashlib.sha256(args.annotations.read_bytes()).hexdigest(),
        "seed": args.seed,
        "sample_count": len(records),
        "writer_count": len({str(record["writer_id"]) for record in records}),
        "splits": split,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _read_records(path: Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        value = json.loads(line)
        if not isinstance(value, dict):
            raise SystemExit(f"line {line_number}: annotation must be an object")
        records.append(value)
    if not records:
        raise SystemExit("annotation file is empty")
    return records


def _validate_records(records: list[dict[str, Any]], quantity_max: int) -> None:
    sample_ids: set[str] = set()
    for index, record in enumerate(records, start=1):
        sample_id = _string(record, "sample_id", index)
        _string(record, "writer_id", index)
        _string(record, "page_id", index)
        if sample_id in sample_ids:
            raise SystemExit(f"record {index}: duplicate sample_id {sample_id}")
        sample_ids.add(sample_id)
        corners = record.get("marker_corners")
        if (
            not isinstance(corners, list)
            or len(corners) != 4
            or any(
                not isinstance(point, list)
                or len(point) != 2
                or any(
                    isinstance(value, bool)
                    or not isinstance(value, (int, float))
                    or not math.isfinite(value)
                    for value in point
                )
                for point in corners
            )
        ):
            raise SystemExit(
                f"record {index}: marker_corners must contain four numeric [x, y] pairs"
            )
        id_cells = record.get("id_cells")
        if (
            not isinstance(id_cells, list)
            or len(id_cells) != 6
            or any(
                not isinstance(value, str)
                or len(value) != 1
                or not value.isascii()
                or not value.isdecimal()
                for value in id_cells
            )
        ):
            raise SystemExit(f"record {index}: id_cells must contain six ASCII digit labels")
        room_cells = record.get("room_cells")
        if (
            not isinstance(room_cells, list)
            or not 1 <= len(room_cells) <= 4
            or any(
                not isinstance(value, str)
                or len(value) != 1
                or not value.isascii()
                or not value.isalnum()
                for value in room_cells
            )
        ):
            raise SystemExit(
                f"record {index}: room_cells must contain one to four ASCII alphanumerics"
            )
        rows = record.get("rows")
        if not isinstance(rows, list) or len(rows) != 12:
            raise SystemExit(f"record {index}: rows must contain exactly twelve row objects")
        for row_index, row in enumerate(rows):
            _validate_row(row, index, row_index, quantity_max)
        notes = record.get("ambiguity_notes")
        if notes is not None and not isinstance(notes, str):
            raise SystemExit(f"record {index}: ambiguity_notes must be a string or null")


def _validate_row(value: Any, record_index: int, row_index: int, quantity_max: int) -> None:
    if not isinstance(value, dict) or not isinstance(value.get("blank"), bool):
        raise SystemExit(f"record {record_index} row {row_index}: blank must be boolean")
    blank = value["blank"]
    item = value.get("item_transcription")
    catalogue_id = value.get("catalogue_item_id")
    quantity = value.get("quantity")
    if blank:
        if item is not None or catalogue_id is not None or quantity is not None:
            raise SystemExit(
                f"record {record_index} row {row_index}: blank rows must have null labels"
            )
        return
    if not isinstance(item, str) or not item.strip():
        raise SystemExit(f"record {record_index} row {row_index}: item_transcription is required")
    if catalogue_id is not None and (not isinstance(catalogue_id, str) or not catalogue_id.strip()):
        raise SystemExit(f"record {record_index} row {row_index}: invalid catalogue_item_id")
    if isinstance(quantity, bool) or not isinstance(quantity, int) or quantity <= 0:
        raise SystemExit(
            f"record {record_index} row {row_index}: quantity must be a positive integer"
        )
    if quantity > quantity_max:
        raise SystemExit(
            f"record {record_index} row {row_index}: quantity exceeds configured maximum"
        )


def _writer_splits(records: list[dict[str, Any]], seed: int) -> dict[str, list[str]]:
    writers = sorted({str(record["writer_id"]) for record in records})
    random.Random(seed).shuffle(writers)
    validation_count = _split_count(len(writers), 0.15)
    test_count = _split_count(len(writers), 0.15)
    if validation_count + test_count >= len(writers):
        test_count = max(0, len(writers) - validation_count - 1)
    validation = set(writers[:validation_count])
    test = set(writers[validation_count : validation_count + test_count])
    return {
        "train": sorted(
            str(record["sample_id"])
            for record in records
            if record["writer_id"] not in validation | test
        ),
        "validation": sorted(
            str(record["sample_id"]) for record in records if record["writer_id"] in validation
        ),
        "test": sorted(
            str(record["sample_id"]) for record in records if record["writer_id"] in test
        ),
    }


def _string(record: dict[str, Any], key: str, index: int) -> str:
    value = record.get(key)
    if not isinstance(value, str) or not value.strip():
        raise SystemExit(f"record {index}: {key} must be a non-empty string")
    return value


def _split_count(total: int, fraction: float) -> int:
    if total < 3 and fraction > 0:
        return 0
    return max(0, min(total - 1, round(total * fraction)))


if __name__ == "__main__":
    main()
