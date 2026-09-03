from __future__ import annotations

from pathlib import Path

import pytest

from order_scanner.benchmark import (
    Annotation,
    BenchmarkError,
    Prediction,
    benchmark_predictions,
    load_predictions,
    split_writer_disjoint,
)


def test_writer_split_is_reproducible_and_disjoint() -> None:
    annotations = tuple(
        Annotation(f"sample-{index}", f"writer-{index}", f"page-{index}", {"ma_luu_ky": "000001"})
        for index in range(10)
    )

    first = split_writer_disjoint(annotations, seed=42, validation_fraction=0.2, test_fraction=0.2)
    second = split_writer_disjoint(annotations, seed=42, validation_fraction=0.2, test_fraction=0.2)

    assert first == second
    assert {case.writer_id for case in first.train}.isdisjoint(
        {case.writer_id for case in first.validation + first.test}
    )
    assert tuple(map(len, (first.train, first.validation, first.test))) == (6, 2, 2)


def test_benchmark_reports_required_accuracy_and_runtime_metrics() -> None:
    annotations = (
        Annotation("a", "writer-a", "page-a", {"items.0.item": "item-1", "quantity": 2}),
        Annotation("b", "writer-b", "page-b", {"items.0.item": "item-2", "quantity": 3}),
    )
    predictions = (
        Prediction(
            "a",
            "writer-a",
            {"items.0.item": "item-1", "quantity": 2},
            {"items.0.item": ("item-1",)},
            accepted=True,
            latency_ms=10,
            rss_mb=100,
        ),
        Prediction(
            "b",
            "writer-b",
            {"items.0.item": None, "quantity": 3},
            {"items.0.item": ("item-3", "item-2")},
            accepted=False,
            latency_ms=30,
            rss_mb=120,
        ),
    )

    report = benchmark_predictions(annotations, predictions)

    assert report.field_exact_match == pytest.approx(0.75)
    assert report.item_top1 == pytest.approx(0.5)
    assert report.item_top3 == 1.0
    assert report.form_exact_match == pytest.approx(0.5)
    assert report.auto_accept_precision == 1.0
    assert report.false_auto_accept_rate == 0.0
    assert report.review_rate == pytest.approx(0.5)
    assert report.p50_latency_ms == 20
    assert report.p95_latency_ms == pytest.approx(29)
    assert report.max_rss_mb == 120


def test_benchmark_rejects_writer_mismatch() -> None:
    with pytest.raises(BenchmarkError, match="writer mismatch"):
        benchmark_predictions(
            (Annotation("a", "writer-a", "page-a", {"quantity": 1}),),
            (Prediction("a", "writer-b", {"quantity": 1}),),
        )


def test_item_top1_is_independent_of_auto_acceptance() -> None:
    report = benchmark_predictions(
        (Annotation("a", "writer-a", "page-a", {"items.0.item": "item-1"}),),
        (
            Prediction(
                "a",
                "writer-a",
                {"items.0.item": None},
                {"items.0.item": ("item-1", "item-2")},
            ),
        ),
    )

    assert report.item_top1 == 1.0
    assert report.item_top3 == 1.0
    assert report.auto_accept_precision is None


def test_false_blank_is_measured_per_nonblank_row() -> None:
    report = benchmark_predictions(
        (
            Annotation(
                "a",
                "writer-a",
                "page-a",
                {"items.0.blank": False, "items.1.blank": True},
            ),
        ),
        (
            Prediction(
                "a",
                "writer-a",
                {"items.0.blank": True, "items.1.blank": True},
            ),
        ),
    )

    assert report.false_blank == 1.0


def test_missing_row_blank_prediction_is_rejected() -> None:
    with pytest.raises(BenchmarkError, match="missing blank field"):
        benchmark_predictions(
            (Annotation("a", "writer-a", "page-a", {"items.0.blank": False}),),
            (Prediction("a", "writer-a", {}),),
        )


def test_benchmark_rejects_empty_and_duplicate_inputs() -> None:
    with pytest.raises(BenchmarkError, match="at least one"):
        benchmark_predictions((), ())
    annotation = Annotation("a", "writer-a", "page-a", {"quantity": 1})
    prediction = Prediction("a", "writer-a", {"quantity": 1})
    with pytest.raises(BenchmarkError, match="annotation sample_id"):
        benchmark_predictions((annotation, annotation), (prediction, prediction))


def test_prediction_loader_rejects_string_booleans(tmp_path: Path) -> None:
    predictions = tmp_path / "predictions.jsonl"
    predictions.write_text(
        '{"sample_id":"a","writer_id":"w","fields":{},"accepted":"false"}\n',
        encoding="utf-8",
    )

    with pytest.raises(BenchmarkError, match="accepted must be boolean"):
        load_predictions(predictions)


def test_prediction_loader_rejects_non_string_candidates(tmp_path: Path) -> None:
    predictions = tmp_path / "predictions.jsonl"
    predictions.write_text(
        '{"sample_id":"a","writer_id":"w","fields":{},"candidates":{"item":[null]}}\n',
        encoding="utf-8",
    )

    with pytest.raises(BenchmarkError, match="non-empty string lists"):
        load_predictions(predictions)


def test_prediction_contract_rejects_invalid_runtime_values() -> None:
    with pytest.raises(BenchmarkError, match="accepted must be boolean"):
        Prediction("a", "w", {}, accepted="false")  # type: ignore[arg-type]
    with pytest.raises(BenchmarkError, match="non-negative"):
        Prediction("a", "w", {}, latency_ms=-1)
    with pytest.raises(BenchmarkError, match="non-negative"):
        Prediction("a", "w", {}, latency_ms=float("nan"))
