"""Generate canonical draft callback payloads for consumer review."""

from __future__ import annotations

import argparse
from datetime import UTC, datetime
from pathlib import Path

from order_scanner.contracts import (
    ArtifactReference,
    CallbackEvent,
    Candidate,
    FieldResult,
    FieldWarning,
    ItemResult,
    PipelineVersions,
    ResultOutcome,
    ResultSnapshot,
    SourceReference,
    WarningSeverity,
    result_id,
)

_COMPLETED_AT = datetime(2026, 8, 3, 0, 0, tzinfo=UTC)
_VERSIONS = PipelineVersions(
    "a" * 64,
    "1",
    "1.0-draft",
    "ticket-v4",
    "preprocessing-1",
    "model-1",
    "thresholds-1",
    "catalogue-1",
)


def build_fixtures() -> dict[str, bytes]:
    accepted = _event(
        document_id="doc_accepted_example",
        source_id="src_accepted_example",
        outcome=ResultOutcome.ACCEPTED,
        ma_luu_ky=FieldResult("ma_luu_ky", "000001", "000001", 0.99),
        buong_giam=FieldResult("buong_giam", "A1", "A1", 0.98),
        items=(
            ItemResult(
                0,
                FieldResult("items.0.item", "Pho bo", "Pho bo", 0.97),
                FieldResult("items.0.quantity", 2, "2", 0.99),
                "001",
            ),
        ),
    )
    needs_review = _event(
        document_id="doc_review_example",
        source_id="src_review_example",
        outcome=ResultOutcome.NEEDS_REVIEW,
        ma_luu_ky=FieldResult(
            "ma_luu_ky",
            None,
            "0000O1",
            0.42,
            warnings=(
                FieldWarning(
                    "ambiguous_character",
                    "The fifth character may be zero or letter O.",
                    WarningSeverity.ERROR,
                    "ma_luu_ky",
                ),
            ),
            candidates=(Candidate("000001", 0.42), Candidate("0000O1", 0.38)),
        ),
        buong_giam=FieldResult("buong_giam", "A1", "A1", 0.95),
        items=(
            ItemResult(
                0,
                FieldResult(
                    "items.0.item",
                    None,
                    "Pho bo",
                    0.61,
                    candidates=(
                        Candidate("Pho bo", 0.61, "001"),
                        Candidate("Pho ga", 0.25, "002"),
                    ),
                ),
                FieldResult(
                    "items.0.quantity",
                    None,
                    "2?",
                    0.51,
                    warnings=(
                        FieldWarning(
                            "quantity_uncertain",
                            "Quantity requires operator confirmation.",
                            WarningSeverity.WARNING,
                            "items.0.quantity",
                            row_index=0,
                        ),
                    ),
                ),
                None,
            ),
        ),
        artifacts=(
            ArtifactReference(
                "artifact_review_crop",
                "crop",
                "image/png",
                "b" * 64,
                "https://scanner.example.test/artifacts/artifact_review_crop",
                field_id="ma_luu_ky",
            ),
        ),
    )
    return {
        "callback-accepted-v1-draft.json": accepted.to_json_bytes(),
        "callback-needs-review-v1-draft.json": needs_review.to_json_bytes(),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path("docs/examples"))
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    fixtures = build_fixtures()
    args.output.mkdir(parents=True, exist_ok=True)
    for name, payload in fixtures.items():
        target = args.output / name
        if args.check:
            if not target.exists() or target.read_bytes() != payload:
                raise SystemExit(f"fixture is stale or missing: {target}")
        else:
            target.write_bytes(payload)
    return 0


def _event(
    *,
    document_id: str,
    source_id: str,
    outcome: ResultOutcome,
    ma_luu_ky: FieldResult,
    buong_giam: FieldResult,
    items: tuple[ItemResult, ...],
    artifacts: tuple[ArtifactReference, ...] = (),
) -> CallbackEvent:
    result = ResultSnapshot(
        result_id=result_id(document_id, 1),
        document_id=document_id,
        page_index=0,
        revision=1,
        outcome=outcome,
        source=SourceReference(source_id),
        ma_luu_ky=ma_luu_ky,
        buong_giam=buong_giam,
        items=items,
        artifacts=artifacts,
        warnings=(),
        versions=_VERSIONS,
        completed_at=_COMPLETED_AT,
        service_date="2026-08-04",
    )
    return CallbackEvent.from_result(result)


if __name__ == "__main__":
    raise SystemExit(main())
