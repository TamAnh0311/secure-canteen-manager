from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime

import pytest

from order_scanner.contracts import (
    ArtifactReference,
    CallbackEvent,
    ContractError,
    FieldResult,
    ItemResult,
    ModelManifest,
    PipelineVersions,
    ResultOutcome,
    ResultSnapshot,
    SourceReference,
    callback_event_id,
    derive_service_date,
    result_id,
)

NOW = datetime(2026, 8, 3, 0, 0, tzinfo=UTC)


def _result(
    *, document: str = "doc-1", outcome: ResultOutcome = ResultOutcome.ACCEPTED
) -> ResultSnapshot:
    return ResultSnapshot(
        result_id=result_id(document, 1),
        document_id=document,
        page_index=0,
        revision=1,
        outcome=outcome,
        source=SourceReference("src-1"),
        ma_luu_ky=FieldResult("ma_luu_ky", "000001", "000001", 0.99),
        buong_giam=FieldResult("buong_giam", "A1", "A1", 0.95),
        items=(),
        artifacts=(),
        warnings=(),
        versions=PipelineVersions(
            "a" * 64, "1", "1.0-draft", "ticket-v4", "none", "none", "none", "catalogue-1"
        ),
        completed_at=NOW,
        service_date="2026-08-04",
    )


def test_callback_payload_is_canonical_and_event_id_is_stable() -> None:
    result = _result()
    first = CallbackEvent.from_result(result)
    second = CallbackEvent.from_result(result)

    assert first.event_id == second.event_id == callback_event_id("doc-1", 1)
    assert first.to_json_bytes() == second.to_json_bytes()
    assert b"000001" in first.to_json_bytes()


def test_service_date_uses_facility_timezone_and_next_day_offset() -> None:
    admission = datetime(2026, 8, 3, 16, 30, tzinfo=UTC)

    assert derive_service_date(admission, "Asia/Saigon") == "2026-08-04"
    assert derive_service_date(admission, "Asia/Saigon", 0) == "2026-08-03"


def test_callback_rejects_result_without_admission_service_date() -> None:
    with pytest.raises(ContractError, match="service_date"):
        CallbackEvent.from_result(replace(_result(), service_date=None))


def test_callback_rejects_non_manager_catalogue_ids() -> None:
    result = _result_with_items(1)
    invalid_item = replace(result.items[0], catalogue_item_id="pho-bo")

    with pytest.raises(ContractError, match="manager menu code"):
        CallbackEvent.from_result(replace(result, items=(invalid_item,)))


def test_accepted_result_rejects_invalid_identifier() -> None:
    with pytest.raises(ContractError, match="six digits"):
        ResultSnapshot(
            result_id="res-1",
            document_id="doc-1",
            page_index=0,
            revision=1,
            outcome=ResultOutcome.ACCEPTED,
            source=SourceReference("src-1"),
            ma_luu_ky=FieldResult("ma_luu_ky", "ABC123", "ABC123", 0.9),
            buong_giam=FieldResult("buong_giam", "A1", "A1", 0.9),
            items=(),
            artifacts=(),
            warnings=(),
            versions=PipelineVersions(
                "a" * 64, "1", "1.0-draft", "ticket-v4", "none", "none", "none", "catalogue-1"
            ),
            completed_at=NOW,
        )


@pytest.mark.parametrize("value", ["１２３４５６", "١٢٣٤٥٦"])
def test_accepted_result_rejects_non_ascii_digits(value: str) -> None:
    with pytest.raises(ContractError, match="six digits"):
        ResultSnapshot(
            result_id="res-1",
            document_id="doc-1",
            page_index=0,
            revision=1,
            outcome=ResultOutcome.ACCEPTED,
            source=SourceReference("src-1"),
            ma_luu_ky=FieldResult("ma_luu_ky", value, value, 0.9),
            buong_giam=FieldResult("buong_giam", "A1", "A1", 0.9),
            items=(),
            artifacts=(),
            warnings=(),
            versions=PipelineVersions(
                "a" * 64, "1", "1.0-draft", "ticket-v4", "none", "none", "none", "catalogue-1"
            ),
            completed_at=NOW,
        )


def test_accepted_result_rejects_non_ascii_room_code() -> None:
    with pytest.raises(ContractError, match="buong_giam"):
        ResultSnapshot(
            result_id="res-1",
            document_id="doc-1",
            page_index=0,
            revision=1,
            outcome=ResultOutcome.ACCEPTED,
            source=SourceReference("src-1"),
            ma_luu_ky=FieldResult("ma_luu_ky", "000001", "000001", 0.9),
            buong_giam=FieldResult("buong_giam", "房1", "房1", 0.9),
            items=(),
            artifacts=(),
            warnings=(),
            versions=PipelineVersions(
                "a" * 64, "1", "1.0-draft", "ticket-v4", "none", "none", "none", "catalogue-1"
            ),
            completed_at=NOW,
        )


@pytest.mark.parametrize(
    "url",
    [
        "https://",
        "https://user:pass@example.test/a",
        "https://example.test/a?token=x",
        "https://[bad",
    ],
)
def test_artifact_url_rejects_invalid_or_credential_bearing_urls(url: str) -> None:
    with pytest.raises(ContractError, match="artifact URL"):
        ArtifactReference("artifact-1", "crop", "image/png", "a" * 64, url)


def test_accepted_result_enforces_fixed_rows_and_positive_catalogued_quantities() -> None:
    with pytest.raises(ContractError, match="at most 12"):
        _result_with_items(13)
    with pytest.raises(ContractError, match="positive quantity"):
        _result_with_items(1, quantity=0)


def test_callback_and_model_manifest_identities_are_strict() -> None:
    result = _result()
    with pytest.raises(ContractError, match="event_id"):
        CallbackEvent(
            schema_version="1.0-draft",
            event_type="order_scan.result",
            event_id="evt_forged",
            idempotency_key="order-scanner/v1/doc-1/1",
            occurred_at=NOW,
            result=result,
        )
    with pytest.raises(ContractError, match="sha256"):
        ModelManifest("model-1", "z" * 64, "cpu", "in", "out", NOW)


def _result_with_items(count: int, *, quantity: int = 1) -> ResultSnapshot:
    result = _result()
    items = tuple(
        ItemResult(
            row_index=index if index < 12 else 0,
            item=FieldResult(
                f"items.{index if index < 12 else 0}.item", "Pho", "Pho", 0.9
            ),
            quantity=FieldResult(
                f"items.{index if index < 12 else 0}.quantity", quantity, str(quantity), 0.9
            ),
            catalogue_item_id="001",
        )
        for index in range(count)
    )
    return replace(result, items=items)
