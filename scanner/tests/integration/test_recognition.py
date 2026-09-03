from __future__ import annotations

from collections import deque
from collections.abc import Sequence
from datetime import UTC, datetime

import numpy as np

from order_scanner.catalogue import CatalogueIndex, RankingPolicy
from order_scanner.contracts import Catalogue, CatalogueItem
from order_scanner.recognition import (
    CalibrationPoint,
    ConfidenceCalibrator,
    Hypothesis,
    RecognitionEngine,
    RecognitionPolicy,
)


class SequenceBackend:
    def __init__(self, responses: Sequence[Sequence[Hypothesis]]) -> None:
        self.responses = deque(tuple(response) for response in responses)

    def recognize(
        self, crop: np.ndarray[tuple[int, int], np.dtype[np.uint8]], *, field_id: str, limit: int
    ) -> Sequence[Hypothesis]:
        return self.responses.popleft()[:limit]


def _crop() -> np.ndarray[tuple[int, int], np.dtype[np.uint8]]:
    return np.zeros((8, 8), dtype=np.uint8)


def _catalogue() -> CatalogueIndex:
    return CatalogueIndex(
        Catalogue(
            "catalogue-1",
            (
                CatalogueItem("001", "Bánh mì", ("BM",)),
                CatalogueItem("002", "Bánh bao"),
            ),
            datetime(2026, 8, 4, tzinfo=UTC),
        )
    )


def test_identifier_requires_six_independent_single_digits() -> None:
    backend = SequenceBackend(
        [[Hypothesis(value, 0.99)] for value in ("0", "1", "2", "3", "4", "56")]
    )

    result = RecognitionEngine(backend).recognize_id([_crop()] * 6)

    assert result.value is None
    assert result.raw_text == "0123456"
    assert {warning.code for warning in result.warnings} == {"cell_invalid"}


def test_identifier_does_not_truncate_extra_cells() -> None:
    backend = SequenceBackend([[Hypothesis(value, 0.99)] for value in "012345"])

    result = RecognitionEngine(backend).recognize_id([_crop()] * 7)

    assert result.value is None
    assert result.warnings[0].code == "cell_count"


def test_identifier_with_no_cells_returns_invalid_result() -> None:
    result = RecognitionEngine(SequenceBackend(())).recognize_id(())

    assert result.value is None
    assert result.raw_text is None
    assert result.confidence is None
    assert result.warnings[0].code == "cell_count"


def test_room_preserves_exact_recognized_alphanumeric_value() -> None:
    backend = SequenceBackend([[Hypothesis(value, 0.9)] for value in ("a", "1", "B")])

    result = RecognitionEngine(backend).recognize_room([_crop()] * 3)

    assert result.value == "a1B"
    assert result.raw_text == "a1B"


def test_room_accepts_trailing_blank_cells_from_form_borders() -> None:
    backend = SequenceBackend([[Hypothesis(value, 0.9)] for value in ("A", "1", "−", "−")])

    result = RecognitionEngine(backend).recognize_room([_crop()] * 4)

    assert result.value == "A1"
    assert result.raw_text == "A1−−"
    assert not any(warning.code == "cell_invalid" for warning in result.warnings)


def test_room_accepts_trailing_whitespace_cell() -> None:
    backend = SequenceBackend([[Hypothesis(value, 0.9)] for value in ("B", "2", "   ")])

    result = RecognitionEngine(backend).recognize_room([_crop()] * 3)

    assert result.value == "B2"
    assert result.raw_text == "B2   "


def test_room_rejects_nonblank_character_after_trailing_blank() -> None:
    backend = SequenceBackend([[Hypothesis(value, 0.9)] for value in ("A", "−", "1", "−")])

    result = RecognitionEngine(backend).recognize_room([_crop()] * 4)

    assert result.value is None
    assert any(warning.code == "cell_invalid" for warning in result.warnings)


def test_quantity_is_positive_and_bounded() -> None:
    result = RecognitionEngine(SequenceBackend([[Hypothesis("1000", 0.9)]])).recognize_quantity(
        _crop(), field_id="items.0.quantity"
    )

    assert result.value is None
    assert result.warnings[0].code == "quantity_out_of_range"


def test_quantity_ignores_empty_secondary_candidates() -> None:
    result = RecognitionEngine(
        SequenceBackend([[Hypothesis("2", 0.9), Hypothesis("   ", 0.2)]])
    ).recognize_quantity(_crop(), field_id="items.0.quantity")

    assert result.value == 2
    assert tuple(candidate.value for candidate in result.candidates) == ("2",)


def test_item_alias_returns_canonical_value_and_catalogue_id() -> None:
    policy = RecognitionPolicy(item_ranking=RankingPolicy(minimum_score=0.8, minimum_margin=0.1))
    result = RecognitionEngine(
        SequenceBackend([[Hypothesis("BM", 0.99), Hypothesis("Bánh bao", 0.3)]]),
        catalogue=_catalogue(),
        policy=policy,
    ).recognize_item(_crop(), field_id="items.0.item")

    assert result.catalogue_item_id == "001"
    assert result.field.value == "Bánh mì"
    assert result.field.raw_text == "BM"


def test_outside_catalogue_is_needs_review_with_candidates() -> None:
    result = RecognitionEngine(
        SequenceBackend([[Hypothesis("Không có", 0.99)]]),
        catalogue=_catalogue(),
    ).recognize_item(_crop(), field_id="items.0.item")

    assert result.catalogue_item_id is None
    assert result.field.value is None
    assert result.field.warnings[0].code == "item_needs_review"
    assert result.field.candidates


def test_field_specific_confidence_calibration_is_applied() -> None:
    policy = RecognitionPolicy(
        calibrators=(
            (
                "quantity",
                ConfidenceCalibrator((CalibrationPoint(0.0, 0.0), CalibrationPoint(1.0, 0.8))),
            ),
        )
    )
    result = RecognitionEngine(
        SequenceBackend([[Hypothesis("2", 0.5)]]), policy=policy
    ).recognize_quantity(_crop(), field_id="items.0.quantity")

    assert result.confidence == 0.4


def test_item_calibration_controls_catalogue_acceptance() -> None:
    policy = RecognitionPolicy(
        item_ranking=RankingPolicy(minimum_score=0.8, minimum_margin=0.1),
        calibrators=(
            (
                "item",
                ConfidenceCalibrator((CalibrationPoint(0.0, 0.0), CalibrationPoint(1.0, 0.5))),
            ),
        ),
    )
    result = RecognitionEngine(
        SequenceBackend([[Hypothesis("BM", 0.99)]]), catalogue=_catalogue(), policy=policy
    ).recognize_item(_crop(), field_id="items.0.item")

    assert result.catalogue_item_id is None
    assert result.field.confidence == 0.495


def test_unapproved_baseline_returns_values_but_requires_review() -> None:
    policy = RecognitionPolicy(auto_accept_enabled=False)
    result = RecognitionEngine(
        SequenceBackend([[Hypothesis("BM", 0.99)]]),
        catalogue=_catalogue(),
        policy=policy,
    ).recognize_item(_crop(), field_id="items.0.item")

    assert result.catalogue_item_id == "001"
    assert result.field.value == "Bánh mì"
    assert result.field.warnings[0].code == "recognition_unapproved"
