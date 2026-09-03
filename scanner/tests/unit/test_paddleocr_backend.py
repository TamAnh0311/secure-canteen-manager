from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

import numpy as np
import pytest
from numpy.typing import NDArray

from order_scanner.paddleocr_backend import (
    PaddleOCRBackend,
    PaddleOCRInferenceError,
    PaddleOCRUnavailableError,
    validate_paddleocr_installation,
)


class RecordingPredictor:
    def __init__(self, predictions: Sequence[Mapping[str, Any]]) -> None:
        self.predictions = predictions
        self.images: list[NDArray[np.uint8]] = []

    def predict(self, image: NDArray[np.uint8]) -> Sequence[Mapping[str, Any]]:
        self.images.append(image)
        return self.predictions


def test_recognizes_one_crop_and_converts_it_to_colour() -> None:
    predictor = RecordingPredictor(({"rec_text": "Bánh mì", "rec_score": 0.91},))
    backend = PaddleOCRBackend(predictor=predictor)
    crop = np.arange(12, dtype=np.uint8).reshape(3, 4)

    hypotheses = backend.recognize(crop, field_id="items.0.item", limit=5)

    assert tuple((value.text, value.confidence) for value in hypotheses) == (("Bánh mì", 0.91),)
    assert predictor.images[0].shape == (3, 4, 3)
    assert np.array_equal(predictor.images[0][:, :, 0], crop)
    assert np.array_equal(predictor.images[0][:, :, 1], crop)
    assert np.array_equal(predictor.images[0][:, :, 2], crop)


def test_unwraps_paddleocr_one_item_batch_fields() -> None:
    predictor = RecordingPredictor(({"rec_text": ["2"], "rec_score": [0.88]},))
    backend = PaddleOCRBackend(predictor=predictor)

    hypotheses = backend.recognize(
        np.zeros((2, 2), dtype=np.uint8), field_id="ma_luu_ky.0", limit=1
    )

    assert tuple((value.text, value.confidence) for value in hypotheses) == (("2", 0.88),)


def test_empty_text_returns_no_hypothesis() -> None:
    backend = PaddleOCRBackend(
        predictor=RecordingPredictor(({"rec_text": "   ", "rec_score": 0.95},))
    )

    assert backend.recognize(
        np.zeros((2, 2), dtype=np.uint8), field_id="ma_luu_ky.0", limit=1
    ) == ()


@pytest.mark.parametrize("score", [-0.1, 1.1, float("nan"), "invalid"])
def test_invalid_confidence_fails_closed(score: object) -> None:
    backend = PaddleOCRBackend(
        predictor=RecordingPredictor(({"rec_text": "2", "rec_score": score},))
    )

    with pytest.raises(PaddleOCRInferenceError, match="confidence"):
        backend.recognize(
            np.zeros((2, 2), dtype=np.uint8),
            field_id="items.0.quantity",
            limit=1,
        )


def test_predictor_failure_is_reported_as_backend_failure() -> None:
    class FailingPredictor:
        def predict(self, image: NDArray[np.uint8]) -> Sequence[Mapping[str, Any]]:
            del image
            raise RuntimeError("native runtime stopped")

    backend = PaddleOCRBackend(predictor=FailingPredictor())

    with pytest.raises(PaddleOCRInferenceError, match="inference failed"):
        backend.recognize(
            np.zeros((2, 2), dtype=np.uint8),
            field_id="items.0.item",
            limit=1,
        )


def test_missing_result_fields_are_reported_as_backend_failure() -> None:
    backend = PaddleOCRBackend(predictor=RecordingPredictor(({},)))

    with pytest.raises(PaddleOCRInferenceError, match="missing recognition fields"):
        backend.recognize(
            np.zeros((2, 2), dtype=np.uint8),
            field_id="items.0.item",
            limit=1,
        )


def test_installation_validation_rejects_unsupported_host(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("order_scanner.paddleocr_backend.sys.platform", "darwin")
    monkeypatch.setattr("order_scanner.paddleocr_backend.platform.machine", lambda: "x86_64")

    with pytest.raises(PaddleOCRUnavailableError, match="Linux x86_64 or macOS arm64"):
        validate_paddleocr_installation()
