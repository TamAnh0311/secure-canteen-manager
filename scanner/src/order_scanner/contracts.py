from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, fields, is_dataclass
from datetime import UTC, date, datetime, timedelta
from enum import StrEnum
from typing import Any, cast
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

CALLBACK_SCHEMA_VERSION = "1.0-draft"
CALLBACK_EVENT_TYPE = "order_scan.result"


class ContractError(ValueError):
    """A domain object violates a stable contract invariant."""


class SourceState(StrEnum):
    DISCOVERED = "discovered"
    COPIED = "copied"
    QUARANTINED = "quarantined"


class JobState(StrEnum):
    QUEUED = "queued"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED_RETRYABLE = "failed_retryable"
    FAILED_PERMANENT = "failed_permanent"
    QUARANTINED = "quarantined"


class ResultOutcome(StrEnum):
    ACCEPTED = "accepted"
    NEEDS_REVIEW = "needs_review"


class OutboxState(StrEnum):
    PENDING = "pending"
    RETRYING = "retrying"
    BLOCKED = "blocked"
    DELIVERED = "delivered"


class WarningSeverity(StrEnum):
    INFO = "info"
    WARNING = "warning"
    ERROR = "error"


@dataclass(frozen=True, slots=True)
class SourceReference:
    source_id: str
    capture_id: str | None = None
    scanner_id: str | None = None

    def __post_init__(self) -> None:
        _require_identifier(self.source_id, "source_id")


@dataclass(frozen=True, slots=True)
class Candidate:
    value: str
    confidence: float
    catalogue_item_id: str | None = None

    def __post_init__(self) -> None:
        if not self.value:
            raise ContractError("candidate value must not be empty")
        _require_confidence(self.confidence)


@dataclass(frozen=True, slots=True)
class FieldWarning:
    code: str
    message: str
    severity: WarningSeverity
    field_id: str
    row_index: int | None = None

    def __post_init__(self) -> None:
        _require_identifier(self.code, "warning code")
        _require_identifier(self.field_id, "field_id")
        if not self.message:
            raise ContractError("warning message must not be empty")
        if self.row_index is not None and self.row_index < 0:
            raise ContractError("row_index must be zero-based")


@dataclass(frozen=True, slots=True)
class FieldResult:
    field_id: str
    value: str | int | None
    raw_text: str | None
    confidence: float | None
    warnings: tuple[FieldWarning, ...] = ()
    candidates: tuple[Candidate, ...] = ()

    def __post_init__(self) -> None:
        _require_identifier(self.field_id, "field_id")
        if self.confidence is not None:
            _require_confidence(self.confidence)


@dataclass(frozen=True, slots=True)
class ItemResult:
    row_index: int
    item: FieldResult
    quantity: FieldResult
    catalogue_item_id: str | None = None

    def __post_init__(self) -> None:
        if self.row_index < 0:
            raise ContractError("row_index must be zero-based")


@dataclass(frozen=True, slots=True)
class ArtifactReference:
    artifact_id: str
    kind: str
    media_type: str
    sha256: str
    url: str
    field_id: str | None = None
    row_index: int | None = None

    def __post_init__(self) -> None:
        _require_identifier(self.artifact_id, "artifact_id")
        if len(self.sha256) != 64 or any(
            character not in "0123456789abcdef" for character in self.sha256
        ):
            raise ContractError("artifact sha256 must be lowercase hexadecimal")
        try:
            parsed_url = urlsplit(self.url)
            _port = parsed_url.port
        except ValueError:
            raise ContractError(
                "artifact URL must be HTTPS with a host and no credentials, query, or fragment"
            ) from None
        if (
            parsed_url.scheme != "https"
            or not parsed_url.hostname
            or parsed_url.username
            or parsed_url.password
            or parsed_url.query
            or parsed_url.fragment
        ):
            raise ContractError(
                "artifact URL must be HTTPS with a host and no credentials, query, or fragment"
            )


@dataclass(frozen=True, slots=True)
class CatalogueItem:
    item_id: str
    canonical_name: str
    aliases: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        _require_identifier(self.item_id, "catalogue item_id")
        if not self.canonical_name.strip():
            raise ContractError("catalogue canonical_name must not be empty")
        if len({alias.casefold() for alias in self.aliases}) != len(self.aliases):
            raise ContractError("catalogue aliases must be unique")


@dataclass(frozen=True, slots=True)
class Catalogue:
    version: str
    items: tuple[CatalogueItem, ...]
    created_at: datetime

    def __post_init__(self) -> None:
        _require_identifier(self.version, "catalogue version")
        item_ids = [item.item_id for item in self.items]
        if len(set(item_ids)) != len(item_ids):
            raise ContractError("catalogue item IDs must be unique")
        _require_utc(self.created_at, "catalogue created_at")


@dataclass(frozen=True, slots=True)
class ModelManifest:
    version: str
    sha256: str
    runtime: str
    input_contract: str
    output_contract: str
    created_at: datetime

    def __post_init__(self) -> None:
        _require_identifier(self.version, "model version")
        if len(self.sha256) != 64 or any(
            character not in "0123456789abcdef" for character in self.sha256
        ):
            raise ContractError("model sha256 must contain 64 characters")
        _require_utc(self.created_at, "model created_at")


@dataclass(frozen=True, slots=True)
class PipelineVersions:
    bundle_fingerprint: str
    config_schema: str
    callback_schema: str
    template: str
    preprocessing: str
    model: str
    thresholds: str
    catalogue: str

    def __post_init__(self) -> None:
        if len(self.bundle_fingerprint) != 64 or any(
            character not in "0123456789abcdef" for character in self.bundle_fingerprint
        ):
            raise ContractError("bundle_fingerprint must be a SHA-256 hex digest")


@dataclass(frozen=True, slots=True)
class ResultSnapshot:
    result_id: str
    document_id: str
    page_index: int
    revision: int
    outcome: ResultOutcome
    source: SourceReference
    ma_luu_ky: FieldResult
    buong_giam: FieldResult
    items: tuple[ItemResult, ...]
    artifacts: tuple[ArtifactReference, ...]
    warnings: tuple[FieldWarning, ...]
    versions: PipelineVersions
    completed_at: datetime
    # The scanner assigns this once when the source is admitted. It is optional
    # only for legacy in-process fixtures; emitted callbacks always carry it.
    service_date: str | None = None

    def __post_init__(self) -> None:
        _require_identifier(self.result_id, "result_id")
        _require_identifier(self.document_id, "document_id")
        if self.page_index < 0:
            raise ContractError("page_index must be zero-based")
        if self.revision < 1:
            raise ContractError("result revision must be positive")
        _require_utc(self.completed_at, "completed_at")
        if self.service_date is not None:
            _require_service_date(self.service_date)
        if self.ma_luu_ky.field_id != "ma_luu_ky":
            raise ContractError("ma_luu_ky field must use stable field_id 'ma_luu_ky'")
        if self.buong_giam.field_id != "buong_giam":
            raise ContractError("buong_giam field must use stable field_id 'buong_giam'")
        row_indices = [item.row_index for item in self.items]
        if len(self.items) > 12 or len(set(row_indices)) != len(row_indices):
            raise ContractError("items must contain at most 12 unique rows")
        if any(row_index > 11 for row_index in row_indices):
            raise ContractError("item row_index must be between 0 and 11")
        for item in self.items:
            if item.item.field_id != f"items.{item.row_index}.item":
                raise ContractError("item field_id must identify its fixed row")
            if item.quantity.field_id != f"items.{item.row_index}.quantity":
                raise ContractError("quantity field_id must identify its fixed row")
        if self.outcome is ResultOutcome.ACCEPTED:
            if (
                not isinstance(self.ma_luu_ky.value, str)
                or not self.ma_luu_ky.value.isascii()
                or len(self.ma_luu_ky.value) != 6
            ):
                raise ContractError("accepted ma_luu_ky must be exactly six digits")
            if not self.ma_luu_ky.value.isdecimal():
                raise ContractError("accepted ma_luu_ky must be exactly six digits")
            room = self.buong_giam.value
            if (
                not isinstance(room, str)
                or not room.isascii()
                or not (1 <= len(room) <= 4)
                or not room.isalnum()
            ):
                raise ContractError("accepted buong_giam must be 1-4 alphanumeric characters")
            if any(warning.severity is WarningSeverity.ERROR for warning in self.all_warnings()):
                raise ContractError("accepted result must not contain error warnings")
            for item in self.items:
                quantity = item.quantity.value
                if (
                    not item.catalogue_item_id
                    or not isinstance(item.item.value, str)
                    or not item.item.value.strip()
                    or isinstance(quantity, bool)
                    or not isinstance(quantity, int)
                    or quantity <= 0
                ):
                    raise ContractError(
                        "accepted item rows require a catalogue ID, item name, "
                        "and positive quantity"
                    )

    def all_warnings(self) -> tuple[FieldWarning, ...]:
        nested = self.ma_luu_ky.warnings + self.buong_giam.warnings
        for item in self.items:
            nested += item.item.warnings + item.quantity.warnings
        return self.warnings + nested

    def to_dict(self) -> dict[str, Any]:
        return cast(dict[str, Any], _to_primitive(self))

    def to_json_bytes(self) -> bytes:
        return _canonical_json(self.to_dict())


@dataclass(frozen=True, slots=True)
class CallbackEvent:
    schema_version: str
    event_type: str
    event_id: str
    idempotency_key: str
    occurred_at: datetime
    result: ResultSnapshot

    def __post_init__(self) -> None:
        if self.schema_version != CALLBACK_SCHEMA_VERSION:
            raise ContractError(f"unsupported callback schema version: {self.schema_version}")
        if self.event_type != CALLBACK_EVENT_TYPE:
            raise ContractError(f"unsupported callback event type: {self.event_type}")
        _require_identifier(self.event_id, "event_id")
        if not self.idempotency_key.startswith("order-scanner/"):
            raise ContractError("idempotency_key must use the order-scanner namespace")
        _require_utc(self.occurred_at, "occurred_at")
        if self.event_id != callback_event_id(self.result.document_id, self.result.revision):
            raise ContractError("event_id must be deterministic for the result revision")
        expected_key = f"order-scanner/v1/{self.result.document_id}/{self.result.revision}"
        if self.idempotency_key != expected_key:
            raise ContractError("idempotency_key must be deterministic for the result revision")
        if self.occurred_at != self.result.completed_at:
            raise ContractError("occurred_at must match result completion time")
        if self.result.service_date is None:
            raise ContractError("callback result must include service_date")
        for item in self.result.items:
            if item.catalogue_item_id is not None:
                _require_catalogue_code(item.catalogue_item_id)
            for field in (item.item, item.quantity):
                for candidate in field.candidates:
                    if candidate.catalogue_item_id is not None:
                        _require_catalogue_code(candidate.catalogue_item_id)
        for field in (self.result.ma_luu_ky, self.result.buong_giam):
            for candidate in field.candidates:
                if candidate.catalogue_item_id is not None:
                    _require_catalogue_code(candidate.catalogue_item_id)

    @classmethod
    def from_result(cls, result: ResultSnapshot) -> CallbackEvent:
        event_id = callback_event_id(result.document_id, result.revision)
        return cls(
            schema_version=CALLBACK_SCHEMA_VERSION,
            event_type=CALLBACK_EVENT_TYPE,
            event_id=event_id,
            idempotency_key=f"order-scanner/v1/{result.document_id}/{result.revision}",
            occurred_at=result.completed_at,
            result=result,
        )

    def to_dict(self) -> dict[str, Any]:
        return cast(dict[str, Any], _to_primitive(self))

    def to_json_bytes(self) -> bytes:
        return _canonical_json(self.to_dict())


def source_id(source_bytes: bytes) -> str:
    return f"src_{hashlib.sha256(source_bytes).hexdigest()}"


def derive_service_date(moment: datetime, timezone: str, offset_days: int = 1) -> str:
    """Derive the operational delivery date exactly once at source admission."""
    if moment.tzinfo is None or moment.utcoffset() is None:
        raise ContractError("service-date admission time must be timezone-aware")
    if not isinstance(offset_days, int) or isinstance(offset_days, bool):
        raise ContractError("service-date offset must be an integer")
    try:
        local_date = moment.astimezone(ZoneInfo(timezone)).date()
    except ZoneInfoNotFoundError:
        raise ContractError("service-date timezone is not installed") from None
    return (local_date + timedelta(days=offset_days)).isoformat()


def document_id(source_identifier: str, page_index: int) -> str:
    if page_index < 0:
        raise ContractError("page_index must be zero-based")
    digest = hashlib.sha256(f"{source_identifier}\x1f{page_index}".encode()).hexdigest()
    return f"doc_{digest}"


def result_id(document_identifier: str, revision: int) -> str:
    if revision < 1:
        raise ContractError("revision must be positive")
    digest = hashlib.sha256(f"{document_identifier}\x1f{revision}".encode()).hexdigest()
    return f"res_{digest}"


def callback_event_id(document_identifier: str, revision: int) -> str:
    digest = hashlib.sha256(
        f"{CALLBACK_SCHEMA_VERSION}\x1f{document_identifier}\x1f{revision}".encode()
    ).hexdigest()
    return f"evt_{digest}"


def utc_now() -> datetime:
    return datetime.now(UTC)


def _require_identifier(value: str, label: str) -> None:
    if not value or any(character.isspace() for character in value):
        raise ContractError(f"{label} must be a non-empty identifier without whitespace")


def _require_confidence(value: float) -> None:
    if not 0.0 <= value <= 1.0:
        raise ContractError("confidence must be between 0 and 1")


def _require_utc(value: datetime, label: str) -> None:
    if value.tzinfo is None or value.utcoffset() != UTC.utcoffset(value):
        raise ContractError(f"{label} must be timezone-aware UTC")


def _require_service_date(value: str) -> None:
    if not isinstance(value, str):
        raise ContractError("service_date must be an ISO date")
    try:
        parsed = date.fromisoformat(value)
    except ValueError:
        raise ContractError("service_date must be an ISO date") from None
    if parsed.isoformat() != value:
        raise ContractError("service_date must use YYYY-MM-DD")


def _require_catalogue_code(value: str) -> None:
    if (
        not isinstance(value, str)
        or len(value) != 3
        or not value.isascii()
        or not value.isdecimal()
    ):
        raise ContractError("catalogue_item_id must be a three-digit manager menu code")


def _canonical_json(value: Mapping[str, Any]) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        allow_nan=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def _to_primitive(value: Any) -> Any:
    if isinstance(value, StrEnum):
        return value.value
    if isinstance(value, datetime):
        return value.astimezone(UTC).isoformat().replace("+00:00", "Z")
    if is_dataclass(value):
        return {field.name: _to_primitive(getattr(value, field.name)) for field in fields(value)}
    if isinstance(value, Mapping):
        return {str(key): _to_primitive(item) for key, item in value.items()}
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        return [_to_primitive(item) for item in value]
    return value
