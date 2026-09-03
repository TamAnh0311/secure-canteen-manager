"""PaddleOCR CPU adapter for the model-neutral recognition boundary."""

from __future__ import annotations

import importlib
import math
import platform
import sys
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any, Protocol, cast

import numpy as np
from numpy.typing import NDArray

from order_scanner.recognition import GrayCrop, Hypothesis, RecognitionBackendError


class PaddleOCRUnavailableError(RuntimeError):
    """The optional PaddleOCR runtime is not installed or cannot be loaded."""


class PaddleOCRInferenceError(RecognitionBackendError):
    """PaddleOCR returned an unusable result or failed during inference."""


class _TextRecognitionPredictor(Protocol):
    def predict(self, image: NDArray[np.uint8]) -> Sequence[Mapping[str, Any]]: ...


class PaddleOCRBackend:
    """Run PaddleOCR's small Latin recognizer on one aligned crop at a time."""

    def __init__(
        self,
        *,
        model_name: str = "latin_PP-OCRv5_mobile_rec",
        model_dir: Path | None = None,
        cpu_threads: int = 4,
        predictor: _TextRecognitionPredictor | None = None,
    ) -> None:
        if not model_name.strip():
            raise ValueError("PaddleOCR model_name must not be empty")
        if cpu_threads < 1:
            raise ValueError("PaddleOCR cpu_threads must be positive")
        self.model_name = model_name
        self.model_dir = model_dir
        self.cpu_threads = cpu_threads
        self._predictor = predictor or _create_predictor(model_name, model_dir, cpu_threads)

    def close(self) -> None:
        """Release native predictor resources after startup preflight or worker shutdown."""
        close = getattr(self._predictor, "close", None)
        if callable(close):
            close()

    def recognize(
        self,
        crop: GrayCrop,
        *,
        field_id: str,
        limit: int,
    ) -> Sequence[Hypothesis]:
        del field_id
        if limit < 1:
            return ()
        # PaddleOCR expects a colour image, while the pipeline owns grayscale crops.
        image = np.repeat(crop[:, :, None], 3, axis=2)
        try:
            predictions = self._predictor.predict(image)
        except Exception as exc:
            raise PaddleOCRInferenceError("PaddleOCR inference failed") from exc
        if not predictions:
            return ()
        prediction = predictions[0]
        if not isinstance(prediction, Mapping):
            raise PaddleOCRInferenceError("PaddleOCR returned an invalid result")
        if "rec_text" not in prediction or "rec_score" not in prediction:
            raise PaddleOCRInferenceError("PaddleOCR result is missing recognition fields")
        text = _text_value(prediction["rec_text"])
        score = _first_value(prediction["rec_score"])
        if text is None or score is None:
            raise PaddleOCRInferenceError("PaddleOCR returned empty recognition fields")
        try:
            confidence = float(cast(Any, score))
        except (TypeError, ValueError):
            raise PaddleOCRInferenceError("PaddleOCR returned an invalid confidence") from None
        if not math.isfinite(confidence) or not 0.0 <= confidence <= 1.0:
            raise PaddleOCRInferenceError("PaddleOCR confidence must be between 0 and 1")
        return (Hypothesis(text.strip(), confidence),) if text.strip() else ()


def validate_paddleocr_installation() -> None:
    """Fail before worker startup when the optional runtime is missing."""
    machine = platform.machine().casefold()
    supported_host = (sys.platform == "linux" and machine in {"x86_64", "amd64"}) or (
        sys.platform == "darwin" and machine == "arm64"
    )
    if not supported_host:
        raise PaddleOCRUnavailableError(
            "the PaddleOCR baseline requires Linux x86_64 or macOS arm64; "
            "the iPhone is capture-only"
        )
    if sys.version_info < (3, 11) or sys.version_info >= (3, 14):
        raise PaddleOCRUnavailableError(
            "the PaddleOCR baseline requires CPython 3.11-3.13 on Linux x86_64 "
            "or macOS arm64"
        )
    try:
        importlib.import_module("paddleocr")
        importlib.import_module("paddle")
    except Exception as exc:
        raise PaddleOCRUnavailableError(
            "PaddleOCR is enabled but unavailable; install the OCR extra "
            "with `uv sync --extra paddleocr`"
        ) from exc


def _create_predictor(
    model_name: str,
    model_dir: Path | None,
    cpu_threads: int,
) -> _TextRecognitionPredictor:
    try:
        module = importlib.import_module("paddleocr")
        text_recognition = module.__dict__.get("TextRecognition")
        if not callable(text_recognition):
            raise RuntimeError("paddleocr.TextRecognition is unavailable")
        predictor = text_recognition(
            model_name=model_name,
            model_dir=str(model_dir) if model_dir is not None else None,
            device="cpu",
            cpu_threads=cpu_threads,
            enable_mkldnn=True,
            enable_hpi=False,
        )
    except Exception as exc:
        raise PaddleOCRUnavailableError(
            f"cannot load PaddleOCR model {model_name!r}"
        ) from exc
    return cast(_TextRecognitionPredictor, predictor)


def _text_value(value: object) -> str | None:
    value = _first_value(value)
    if isinstance(value, str):
        return value
    return None


def _first_value(value: object) -> object:
    """Unwrap PaddleOCR's one-item batch fields while keeping scalar test doubles valid."""
    if isinstance(value, np.ndarray):
        value = value.tolist()
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        return next(iter(value), None)
    return value
