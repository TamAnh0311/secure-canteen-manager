"""Deterministic dataset splits and recognition benchmark calculations."""

from __future__ import annotations

import json
import math
import os
import random
import statistics
import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


class BenchmarkError(ValueError):
    """Benchmark input or split definitions are invalid."""


@dataclass(frozen=True, slots=True)
class Annotation:
    sample_id: str
    writer_id: str
    page_id: str
    fields: Mapping[str, Any]
    ambiguity_notes: str | None = None

    def __post_init__(self) -> None:
        if not all(
            isinstance(value, str) and value.strip()
            for value in (self.sample_id, self.writer_id, self.page_id)
        ):
            raise BenchmarkError("annotation identifiers must be non-empty")
        if not isinstance(self.fields, Mapping) or not self.fields:
            raise BenchmarkError("annotation fields must be a non-empty mapping")
        if self.ambiguity_notes is not None and not isinstance(self.ambiguity_notes, str):
            raise BenchmarkError("ambiguity_notes must be a string or null")


@dataclass(frozen=True, slots=True)
class Prediction:
    sample_id: str
    writer_id: str
    fields: Mapping[str, Any]
    candidates: Mapping[str, Sequence[str]] = field(default_factory=dict)
    blank: bool = False
    accepted: bool = False
    latency_ms: float = 0.0
    rss_mb: float | None = None

    def __post_init__(self) -> None:
        if not all(
            isinstance(value, str) and value.strip() for value in (self.sample_id, self.writer_id)
        ):
            raise BenchmarkError("prediction identifiers must be non-empty")
        if not isinstance(self.fields, Mapping) or not isinstance(self.candidates, Mapping):
            raise BenchmarkError("prediction fields and candidates must be mappings")
        if not isinstance(self.blank, bool) or not isinstance(self.accepted, bool):
            raise BenchmarkError("prediction blank and accepted must be boolean")
        if (
            not math.isfinite(self.latency_ms)
            or self.latency_ms < 0
            or (self.rss_mb is not None and (not math.isfinite(self.rss_mb) or self.rss_mb < 0))
        ):
            raise BenchmarkError("prediction latency and RSS must be non-negative")


@dataclass(frozen=True, slots=True)
class BenchmarkSplit:
    train: tuple[Annotation, ...]
    validation: tuple[Annotation, ...]
    test: tuple[Annotation, ...]

    def __post_init__(self) -> None:
        groups = {
            case.sample_id: name
            for name, cases in (
                ("train", self.train),
                ("validation", self.validation),
                ("test", self.test),
            )
            for case in cases
        }
        if len(groups) != len(self.train) + len(self.validation) + len(self.test):
            raise BenchmarkError("a sample appears in more than one split")
        writers = {
            name: {case.writer_id for case in cases}
            for name, cases in (
                ("train", self.train),
                ("validation", self.validation),
                ("test", self.test),
            )
        }
        if (
            writers["train"] & writers["validation"]
            or writers["train"] & writers["test"]
            or writers["validation"] & writers["test"]
        ):
            raise BenchmarkError("writer IDs must be disjoint across splits")


@dataclass(frozen=True, slots=True)
class BenchmarkReport:
    sample_count: int
    field_exact_match: float
    item_top1: float
    item_top3: float
    false_blank: float
    form_exact_match: float
    auto_accept_precision: float | None
    false_auto_accept_rate: float
    review_rate: float
    p50_latency_ms: float
    p95_latency_ms: float
    max_rss_mb: float | None
    writer_ids: tuple[str, ...]

    def to_dict(self) -> dict[str, Any]:
        return {
            "sample_count": self.sample_count,
            "field_exact_match": self.field_exact_match,
            "item_top1": self.item_top1,
            "item_top3": self.item_top3,
            "false_blank": self.false_blank,
            "form_exact_match": self.form_exact_match,
            "auto_accept_precision": self.auto_accept_precision,
            "false_auto_accept_rate": self.false_auto_accept_rate,
            "review_rate": self.review_rate,
            "p50_latency_ms": self.p50_latency_ms,
            "p95_latency_ms": self.p95_latency_ms,
            "max_rss_mb": self.max_rss_mb,
            "writer_ids": list(self.writer_ids),
        }


def split_writer_disjoint(
    annotations: Sequence[Annotation],
    *,
    seed: int = 0,
    validation_fraction: float = 0.15,
    test_fraction: float = 0.15,
) -> BenchmarkSplit:
    if not annotations:
        raise BenchmarkError("at least one annotation is required")
    if not 0 <= validation_fraction < 1 or not 0 <= test_fraction < 1:
        raise BenchmarkError("split fractions must be between 0 and 1")
    if validation_fraction + test_fraction >= 1:
        raise BenchmarkError("validation and test fractions leave no training split")
    by_writer: dict[str, list[Annotation]] = {}
    for annotation in annotations:
        if not annotation.writer_id:
            raise BenchmarkError("writer_id must not be empty")
        by_writer.setdefault(annotation.writer_id, []).append(annotation)
    writers = sorted(by_writer)
    random.Random(seed).shuffle(writers)
    validation_count = _split_count(len(writers), validation_fraction)
    test_count = _split_count(len(writers), test_fraction)
    if validation_count + test_count >= len(writers):
        test_count = max(0, len(writers) - validation_count - 1)
    validation_writers = set(writers[:validation_count])
    test_writers = set(writers[validation_count : validation_count + test_count])
    held_out_writers = validation_writers | test_writers
    train = tuple(
        annotation for annotation in annotations if annotation.writer_id not in held_out_writers
    )
    validation = tuple(
        annotation for annotation in annotations if annotation.writer_id in validation_writers
    )
    test = tuple(annotation for annotation in annotations if annotation.writer_id in test_writers)
    if not train:
        raise BenchmarkError("writer split produced no training samples")
    return BenchmarkSplit(train, validation, test)


def benchmark_predictions(
    annotations: Sequence[Annotation], predictions: Sequence[Prediction]
) -> BenchmarkReport:
    if not annotations:
        raise BenchmarkError("at least one annotation is required")
    if len({annotation.sample_id for annotation in annotations}) != len(annotations):
        raise BenchmarkError("annotation sample_id values must be unique")
    if len({prediction.sample_id for prediction in predictions}) != len(predictions):
        raise BenchmarkError("prediction sample_id values must be unique")
    expected = {annotation.sample_id: annotation for annotation in annotations}
    actual = {prediction.sample_id: prediction for prediction in predictions}
    if set(expected) != set(actual):
        missing = sorted(set(expected) - set(actual))
        extra = sorted(set(actual) - set(expected))
        raise BenchmarkError(f"prediction IDs differ; missing={missing}, extra={extra}")
    field_total = field_correct = 0
    item_total = item_top1 = item_top3 = 0
    false_blank_total = false_blank_count = 0
    forms_exact = 0
    accepted_total = accepted_correct = 0
    review_count = 0
    latencies: list[float] = []
    rss_values: list[float] = []
    for sample_id, annotation in expected.items():
        prediction = actual[sample_id]
        if prediction.writer_id != annotation.writer_id:
            raise BenchmarkError(f"writer mismatch for sample {sample_id}")
        fields_match = True
        for field_name, expected_value in annotation.fields.items():
            field_total += 1
            predicted_value = prediction.fields.get(field_name)
            if predicted_value == expected_value:
                field_correct += 1
            else:
                fields_match = False
            if field_name.endswith(".item"):
                item_total += 1
                candidates = tuple(prediction.candidates.get(field_name, ()))
                ranked_values = candidates or (
                    (str(predicted_value),) if predicted_value is not None else ()
                )
                if ranked_values[:1] == (expected_value,):
                    item_top1 += 1
                if expected_value in ranked_values[:3]:
                    item_top3 += 1
        if fields_match:
            forms_exact += 1
        blank_fields = tuple(
            field_name
            for field_name in annotation.fields
            if field_name == "blank" or field_name.endswith(".blank")
        )
        for blank_field in blank_fields:
            expected_blank = annotation.fields[blank_field]
            if blank_field == "blank":
                predicted_blank = prediction.fields.get(blank_field, prediction.blank)
            elif blank_field in prediction.fields:
                predicted_blank = prediction.fields[blank_field]
            else:
                raise BenchmarkError(f"prediction {sample_id} is missing blank field {blank_field}")
            if not isinstance(expected_blank, bool) or not isinstance(predicted_blank, bool):
                raise BenchmarkError(f"blank field {blank_field} must be boolean")
            if not expected_blank:
                false_blank_total += 1
                if predicted_blank:
                    false_blank_count += 1
        if prediction.accepted:
            accepted_total += 1
            if fields_match and not prediction.blank:
                accepted_correct += 1
        if not prediction.accepted:
            review_count += 1
        latencies.append(prediction.latency_ms)
        if prediction.rss_mb is not None:
            rss_values.append(prediction.rss_mb)
    sample_count = len(annotations)
    return BenchmarkReport(
        sample_count=sample_count,
        field_exact_match=_ratio(field_correct, field_total),
        item_top1=_ratio(item_top1, item_total),
        item_top3=_ratio(item_top3, item_total),
        false_blank=_ratio(false_blank_count, false_blank_total),
        form_exact_match=_ratio(forms_exact, sample_count),
        auto_accept_precision=(
            _ratio(accepted_correct, accepted_total) if accepted_total else None
        ),
        false_auto_accept_rate=_ratio(accepted_total - accepted_correct, accepted_total),
        review_rate=_ratio(review_count, sample_count),
        p50_latency_ms=statistics.median(latencies),
        p95_latency_ms=_percentile(latencies, 0.95),
        max_rss_mb=max(rss_values) if rss_values else None,
        writer_ids=tuple(sorted({annotation.writer_id for annotation in annotations})),
    )


def load_annotations(path: str | Path) -> tuple[Annotation, ...]:
    rows = _read_jsonl(path)
    annotations: list[Annotation] = []
    for row in rows:
        sample_id = _required_string(row, "sample_id")
        writer_id = _required_string(row, "writer_id")
        page_id = _required_string(row, "page_id")
        fields = _annotation_fields(row, sample_id)
        annotations.append(
            Annotation(sample_id, writer_id, page_id, fields, row.get("ambiguity_notes"))
        )
    if len({annotation.sample_id for annotation in annotations}) != len(annotations):
        raise BenchmarkError("sample_id values must be unique")
    return tuple(annotations)


def load_predictions(path: str | Path) -> tuple[Prediction, ...]:
    rows = _read_jsonl(path)
    predictions: list[Prediction] = []
    for row in rows:
        sample_id = _required_string(row, "sample_id")
        writer_id = _required_string(row, "writer_id")
        fields = row.get("fields")
        if not isinstance(fields, dict):
            raise BenchmarkError(f"prediction {sample_id} fields must be an object")
        raw_candidates = row.get("candidates", {})
        if not isinstance(raw_candidates, dict) or any(
            not isinstance(values, list)
            or any(not isinstance(value, str) or not value.strip() for value in values)
            for values in raw_candidates.values()
        ):
            raise BenchmarkError(
                f"prediction {sample_id} candidates must map fields to non-empty string lists"
            )
        predictions.append(
            Prediction(
                sample_id,
                writer_id,
                fields,
                {
                    str(key): tuple(str(value) for value in values)
                    for key, values in raw_candidates.items()
                },
                _optional_bool(row, "blank", False, sample_id),
                _optional_bool(row, "accepted", False, sample_id),
                float(row.get("latency_ms", 0.0)),
                float(row["rss_mb"]) if row.get("rss_mb") is not None else None,
            )
        )
    if len({prediction.sample_id for prediction in predictions}) != len(predictions):
        raise BenchmarkError("prediction sample_id values must be unique")
    return tuple(predictions)


def collect_prediction(
    annotation: Annotation,
    predict: Callable[
        [Annotation], tuple[Mapping[str, Any], Mapping[str, Sequence[str]], bool, bool]
    ],
) -> Prediction:
    start = time.perf_counter()
    fields, candidates, blank, accepted = predict(annotation)
    latency_ms = (time.perf_counter() - start) * 1000
    rss_mb = _process_rss_mb()
    return Prediction(
        annotation.sample_id,
        annotation.writer_id,
        fields,
        candidates,
        blank,
        accepted,
        latency_ms,
        rss_mb,
    )


def _read_jsonl(path: str | Path) -> tuple[dict[str, Any], ...]:
    try:
        lines = Path(path).read_text(encoding="utf-8").splitlines()
    except OSError as exc:
        raise BenchmarkError(f"cannot read dataset: {type(exc).__name__}") from None
    rows: list[dict[str, Any]] = []
    for line_number, line in enumerate(lines, start=1):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            raise BenchmarkError(f"invalid JSON on line {line_number}") from None
        if not isinstance(row, dict):
            raise BenchmarkError(f"line {line_number} must contain a JSON object")
        rows.append(row)
    return tuple(rows)


def _required_string(row: Mapping[str, Any], key: str) -> str:
    value = row.get(key)
    if not isinstance(value, str) or not value.strip():
        raise BenchmarkError(f"{key} must be a non-empty string")
    return value


def _annotation_fields(row: Mapping[str, Any], sample_id: str) -> Mapping[str, Any]:
    fields = row.get("fields")
    if isinstance(fields, dict) and fields:
        return fields
    id_cells = row.get("id_cells")
    room_cells = row.get("room_cells")
    rows = row.get("rows")
    if (
        not isinstance(id_cells, list)
        or not isinstance(room_cells, list)
        or not isinstance(rows, list)
    ):
        raise BenchmarkError(f"annotation {sample_id} has no recognized annotation schema")
    flattened: dict[str, Any] = {
        "ma_luu_ky": "".join(str(value) for value in id_cells),
        "buong_giam": "".join(str(value) for value in room_cells),
    }
    for row_index, item_row in enumerate(rows):
        if not isinstance(item_row, dict) or not isinstance(item_row.get("blank"), bool):
            raise BenchmarkError(f"annotation {sample_id} row {row_index} is invalid")
        prefix = f"items.{row_index}"
        flattened[f"{prefix}.blank"] = item_row["blank"]
        if not item_row["blank"]:
            flattened[f"{prefix}.item"] = item_row.get("catalogue_item_id") or item_row.get(
                "item_transcription"
            )
            flattened[f"{prefix}.quantity"] = item_row.get("quantity")
    return flattened


def _optional_bool(row: Mapping[str, Any], key: str, default: bool, sample_id: str) -> bool:
    value = row.get(key, default)
    if not isinstance(value, bool):
        raise BenchmarkError(f"prediction {sample_id} {key} must be boolean")
    return value


def _split_count(total: int, fraction: float) -> int:
    if total < 3 and fraction > 0:
        return 0
    return max(0, min(total - 1, round(total * fraction)))


def _ratio(numerator: int, denominator: int) -> float:
    return numerator / denominator if denominator else 0.0


def _percentile(values: Sequence[float], fraction: float) -> float:
    ordered = sorted(values)
    if not ordered:
        return 0.0
    position = (len(ordered) - 1) * fraction
    lower = int(position)
    upper = min(lower + 1, len(ordered) - 1)
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


def _process_rss_mb() -> float | None:
    try:
        import resource

        value = float(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)
        return value / (1024 * 1024) if os.uname().sysname == "Darwin" else value / 1024
    except (ImportError, AttributeError, OSError):
        return None
