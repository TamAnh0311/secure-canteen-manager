"""Strict, model-agnostic recognition adapters for aligned form crops."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol

import numpy as np
from numpy.typing import NDArray

from order_scanner.catalogue import CatalogueIndex, RankingPolicy
from order_scanner.contracts import Candidate, FieldResult, FieldWarning, WarningSeverity

GrayCrop = NDArray[np.uint8]


class RecognitionBackendError(RuntimeError):
    """A configured recognition backend failed during inference."""


@dataclass(frozen=True, slots=True)
class Hypothesis:
    text: str
    confidence: float

    def __post_init__(self) -> None:
        if not self.text:
            raise ValueError("hypothesis text must not be empty")
        if not 0.0 <= self.confidence <= 1.0:
            raise ValueError("hypothesis confidence must be between 0 and 1")


class RecognitionBackend(Protocol):
    """Recognition-only backend; detection and crop geometry stay outside this boundary."""

    def recognize(self, crop: GrayCrop, *, field_id: str, limit: int) -> Sequence[Hypothesis]: ...


@dataclass(frozen=True, slots=True)
class CalibrationPoint:
    raw: float
    calibrated: float

    def __post_init__(self) -> None:
        if not 0.0 <= self.raw <= 1.0 or not 0.0 <= self.calibrated <= 1.0:
            raise ValueError("calibration points must be between 0 and 1")


@dataclass(frozen=True, slots=True)
class ConfidenceCalibrator:
    """Piecewise-linear held-out calibration curve for one field model."""

    points: tuple[CalibrationPoint, ...] = ()

    def __post_init__(self) -> None:
        if any(
            left.raw >= right.raw for left, right in zip(self.points, self.points[1:], strict=False)
        ):
            raise ValueError("calibration points must be strictly increasing")

    def apply(self, raw: float) -> float:
        if not 0.0 <= raw <= 1.0:
            raise ValueError("raw confidence must be between 0 and 1")
        if not self.points:
            return raw
        if raw <= self.points[0].raw:
            return self.points[0].calibrated
        for left, right in zip(self.points, self.points[1:], strict=False):
            if raw <= right.raw:
                fraction = (raw - left.raw) / (right.raw - left.raw)
                return left.calibrated + fraction * (right.calibrated - left.calibrated)
        return self.points[-1].calibrated


@dataclass(frozen=True, slots=True)
class RecognitionPolicy:
    room_max_length: int = 4
    quantity_max: int = 999
    candidate_limit: int = 5
    auto_accept_enabled: bool = True
    item_ranking: RankingPolicy = RankingPolicy()
    calibrators: tuple[tuple[str, ConfidenceCalibrator], ...] = ()

    def __post_init__(self) -> None:
        if self.room_max_length < 1:
            raise ValueError("room_max_length must be positive")
        if self.quantity_max < 1:
            raise ValueError("quantity_max must be positive")
        if self.candidate_limit < 1:
            raise ValueError("candidate_limit must be positive")

    def calibrate(self, field_id: str, confidence: float) -> float:
        calibrator = dict(self.calibrators).get(_field_family(field_id))
        return calibrator.apply(confidence) if calibrator else confidence


@dataclass(frozen=True, slots=True)
class ItemRecognition:
    field: FieldResult
    catalogue_item_id: str | None


class RecognitionEngine:
    def __init__(
        self,
        backend: RecognitionBackend,
        *,
        catalogue: CatalogueIndex | None = None,
        policy: RecognitionPolicy | None = None,
    ) -> None:
        self.backend = backend
        self.catalogue = catalogue
        self.policy = policy or RecognitionPolicy()

    def recognize_id(self, crops: Sequence[GrayCrop]) -> FieldResult:
        return self._recognize_fixed_cells("ma_luu_ky", crops, digits_only=True, expected=6)

    def recognize_room(self, crops: Sequence[GrayCrop]) -> FieldResult:
        result = self._recognize_fixed_cells(
            "buong_giam", crops, digits_only=False, expected=self.policy.room_max_length
        )
        if isinstance(result.value, str) and not (
            1 <= len(result.value) <= self.policy.room_max_length
            and result.value.isascii()
            and result.value.isalnum()
        ):
            return _with_warning(result, "room_invalid", "room value must be ASCII alphanumeric")
        return result

    def recognize_quantity(self, crop: GrayCrop, *, field_id: str) -> FieldResult:
        hypotheses = _backend_hypotheses(self.backend, crop, field_id, self.policy.candidate_limit)
        if not hypotheses:
            return _invalid_field(field_id, None, "quantity_missing", "quantity was not recognized")
        top = hypotheses[0]
        raw = top.text.strip()
        confidence = self.policy.calibrate(field_id, top.confidence)
        candidates = tuple(
            Candidate(h.text.strip(), self.policy.calibrate(field_id, h.confidence))
            for h in hypotheses
            if h.text.strip()
        )
        if not raw.isascii() or not raw.isdecimal():
            return _invalid_field(
                field_id,
                raw,
                "quantity_not_digits",
                "quantity must contain ASCII digits",
                confidence,
                candidates,
            )
        quantity = int(raw)
        if quantity <= 0 or quantity > self.policy.quantity_max:
            return _invalid_field(
                field_id,
                raw,
                "quantity_out_of_range",
                "quantity must be positive and within the configured maximum",
                confidence,
                candidates,
            )
        warnings = (
            ()
            if self.policy.auto_accept_enabled
            else (
                _warning(
                    field_id,
                    "recognition_unapproved",
                    "recognition baseline is configured for review-only output",
                ),
            )
        )
        return FieldResult(
            field_id,
            quantity,
            raw,
            confidence,
            warnings=warnings,
            candidates=candidates,
        )

    def recognize_item(self, crop: GrayCrop, *, field_id: str) -> ItemRecognition:
        hypotheses = _backend_hypotheses(self.backend, crop, field_id, self.policy.candidate_limit)
        raw = hypotheses[0].text if hypotheses else None
        confidence = (
            self.policy.calibrate(field_id, hypotheses[0].confidence) if hypotheses else None
        )
        if self.catalogue is None:
            return ItemRecognition(
                _invalid_field(
                    field_id,
                    raw,
                    "catalogue_unconfigured",
                    "item catalogue is not configured",
                    confidence,
                ),
                None,
            )
        matches = self.catalogue.rank(
            raw or "",
            tuple(
                (
                    hypothesis.text,
                    self.policy.calibrate(field_id, hypothesis.confidence),
                )
                for hypothesis in hypotheses
            ),
            self.policy.item_ranking,
        )
        candidates = self.catalogue.candidates(matches)
        accepted = matches[0] if matches and matches[0].accepted else None
        if accepted is None:
            warning_code = "item_unrecognized" if not matches else "item_needs_review"
            field = _invalid_field(
                field_id,
                raw,
                warning_code,
                "item did not meet the catalogue score and runner-up margin gates",
                confidence,
                candidates,
            )
            return ItemRecognition(field, None)
        field = FieldResult(
            field_id,
            accepted.canonical_name,
            raw,
            confidence,
            warnings=(
                ()
                if self.policy.auto_accept_enabled
                else (
                    _warning(
                        field_id,
                        "recognition_unapproved",
                        "recognition baseline is configured for review-only output",
                    ),
                )
            ),
            candidates=candidates,
        )
        return ItemRecognition(field, accepted.item_id)

    def _recognize_fixed_cells(
        self,
        field_id: str,
        crops: Sequence[GrayCrop],
        *,
        digits_only: bool,
        expected: int,
    ) -> FieldResult:
        warnings: list[FieldWarning] = []
        values: list[str] = []
        confidences: list[float] = []
        raw_parts: list[str] = []
        room_blank_seen = False
        if digits_only and len(crops) != expected:
            warnings.append(
                _warning(field_id, "cell_count", "expected exactly six identifier cells")
            )
        if not digits_only and len(crops) > expected:
            warnings.append(
                _warning(field_id, "cell_count", "room code has more cells than configured")
            )
        for index, crop in enumerate(crops[:expected]):
            cell_id = f"{field_id}.{index}"
            hypotheses = _backend_hypotheses(self.backend, crop, field_id=cell_id, limit=2)
            if not hypotheses:
                warnings.append(
                    _warning(field_id, "cell_missing", f"cell {index} has no recognition")
                )
                continue
            top = hypotheses[0]
            raw_parts.append(top.text)
            value = top.text.strip()
            if not digits_only and value in {"", "-", "−", "—"}:
                room_blank_seen = True
                continue
            allowed = value.isascii() and (value.isdecimal() if digits_only else value.isalnum())
            if len(value) != 1 or not allowed:
                warnings.append(
                    _warning(field_id, "cell_invalid", f"cell {index} is not one allowed character")
                )
                continue
            if room_blank_seen:
                warnings.append(
                    _warning(field_id, "cell_invalid", f"cell {index} follows a blank room cell")
                )
                continue
            values.append(value)
            confidences.append(self.policy.calibrate(cell_id, top.confidence))
        raw = "".join(raw_parts) or None
        recognized_value = None
        if not warnings and values and (not digits_only or len(values) == len(crops[:expected])):
            recognized_value = "".join(values)
        confidence = min(confidences) if confidences else None
        if recognized_value is None and not warnings:
            warnings.append(_warning(field_id, "value_missing", "field was not recognized"))
        if recognized_value is not None and not self.policy.auto_accept_enabled:
            warnings.append(
                _warning(
                    field_id,
                    "recognition_unapproved",
                    "recognition baseline is configured for review-only output",
                )
            )
        return FieldResult(
            field_id,
            recognized_value,
            raw,
            confidence,
            warnings=tuple(warnings),
            candidates=(Candidate(recognized_value, confidence),)
            if recognized_value is not None and confidence is not None
            else (),
        )


def _backend_hypotheses(
    backend: RecognitionBackend, crop: GrayCrop, field_id: str, limit: int
) -> tuple[Hypothesis, ...]:
    if crop.dtype != np.uint8 or crop.ndim != 2 or crop.size == 0:
        raise ValueError("recognition crop must be a non-empty grayscale uint8 array")
    hypotheses = tuple(backend.recognize(crop, field_id=field_id, limit=limit))
    return tuple(hypotheses[:limit])


def _field_family(field_id: str) -> str:
    if field_id.startswith("ma_luu_ky"):
        return "ma_luu_ky"
    if field_id.startswith("buong_giam"):
        return "buong_giam"
    if field_id.startswith("items.") and field_id.endswith(".quantity"):
        return "quantity"
    if field_id.startswith("items.") and field_id.endswith(".item"):
        return "item"
    return field_id


def _warning(field_id: str, code: str, message: str) -> FieldWarning:
    return FieldWarning(code, message, WarningSeverity.ERROR, field_id)


def _invalid_field(
    field_id: str,
    raw: str | None,
    code: str,
    message: str,
    confidence: float | None = None,
    candidates: Sequence[Candidate] = (),
) -> FieldResult:
    return FieldResult(
        field_id,
        None,
        raw,
        confidence,
        warnings=(_warning(field_id, code, message),),
        candidates=tuple(candidates),
    )


def _with_warning(result: FieldResult, code: str, message: str) -> FieldResult:
    return FieldResult(
        result.field_id,
        None,
        result.raw_text,
        result.confidence,
        warnings=result.warnings + (_warning(result.field_id, code, message),),
        candidates=result.candidates,
    )
