"""Fail-closed page and row validation for recognized order fields."""

from __future__ import annotations

from dataclasses import dataclass, replace
from enum import StrEnum

from order_scanner.contracts import (
    FieldResult,
    FieldWarning,
    ItemResult,
    ResultOutcome,
    WarningSeverity,
)


class BlankDisposition(StrEnum):
    BLANK = "blank"
    PRESENT = "present"
    UNCERTAIN = "uncertain"


@dataclass(frozen=True, slots=True)
class RowEvidence:
    row_index: int
    blank: BlankDisposition
    item: FieldResult
    quantity: FieldResult
    catalogue_item_id: str | None = None

    def __post_init__(self) -> None:
        if not 0 <= self.row_index <= 11:
            raise ValueError("row_index must be between 0 and 11")
        if self.item.field_id != f"items.{self.row_index}.item":
            raise ValueError("item field_id does not match row_index")
        if self.quantity.field_id != f"items.{self.row_index}.quantity":
            raise ValueError("quantity field_id does not match row_index")


@dataclass(frozen=True, slots=True)
class PageValidation:
    outcome: ResultOutcome
    items: tuple[ItemResult, ...]
    warnings: tuple[FieldWarning, ...]


def validate_page(
    ma_luu_ky: FieldResult,
    buong_giam: FieldResult,
    rows: tuple[RowEvidence, ...],
) -> PageValidation:
    """Apply cross-field rules without correcting or inventing recognized values."""
    row_indices = [row.row_index for row in rows]
    if len(row_indices) != len(set(row_indices)):
        raise ValueError("row evidence must contain unique rows")

    warnings: list[FieldWarning] = []
    items: list[ItemResult] = []
    for row in sorted(rows, key=lambda value: value.row_index):
        item_present = isinstance(row.item.value, str) and bool(row.item.value.strip())
        quantity_present = isinstance(row.quantity.value, int) and not isinstance(
            row.quantity.value, bool
        )
        if row.blank is BlankDisposition.BLANK and not item_present and not quantity_present:
            continue

        item = row.item
        quantity = row.quantity
        if row.blank is BlankDisposition.UNCERTAIN:
            warnings.append(
                _warning(
                    "blank_row_uncertain",
                    "row could not be classified confidently as blank or populated",
                    f"items.{row.row_index}",
                    row.row_index,
                )
            )
        elif row.blank is BlankDisposition.BLANK:
            warnings.append(
                _warning(
                    "blank_row_has_content",
                    "row classified as blank also contains recognized content",
                    f"items.{row.row_index}",
                    row.row_index,
                )
            )

        if item_present != quantity_present:
            if not item_present:
                item = _append_error(
                    item,
                    "item_quantity_pair_incomplete",
                    "quantity is present without an item",
                    row.row_index,
                )
            if not quantity_present:
                quantity = _append_error(
                    quantity,
                    "item_quantity_pair_incomplete",
                    "item is present without a quantity",
                    row.row_index,
                )
        if item_present and row.catalogue_item_id is None:
            item = _append_error(
                item,
                "catalogue_item_unresolved",
                "recognized item is not bound to the active catalogue",
                row.row_index,
            )

        items.append(
            ItemResult(
                row_index=row.row_index,
                item=item,
                quantity=quantity,
                catalogue_item_id=row.catalogue_item_id,
            )
        )

    has_errors = any(
        warning.severity is WarningSeverity.ERROR
        for warning in (
            tuple(warnings)
            + ma_luu_ky.warnings
            + buong_giam.warnings
            + tuple(
                warning
                for item in items
                for warning in item.item.warnings + item.quantity.warnings
            )
        )
    )
    required_missing = ma_luu_ky.value is None or buong_giam.value is None
    outcome = (
        ResultOutcome.NEEDS_REVIEW
        if has_errors or required_missing
        else ResultOutcome.ACCEPTED
    )
    return PageValidation(outcome, tuple(items), tuple(warnings))


def unavailable_field(field_id: str, *, row_index: int | None = None) -> FieldResult:
    return FieldResult(
        field_id=field_id,
        value=None,
        raw_text=None,
        confidence=None,
        warnings=(
            _warning(
                "recognition_unavailable",
                "an approved recognition backend is not available",
                field_id,
                row_index,
            ),
        ),
    )


def _append_error(
    field: FieldResult, code: str, message: str, row_index: int
) -> FieldResult:
    warning = _warning(code, message, field.field_id, row_index)
    return replace(field, warnings=field.warnings + (warning,))


def _warning(
    code: str,
    message: str,
    field_id: str,
    row_index: int | None = None,
) -> FieldWarning:
    return FieldWarning(code, message, WarningSeverity.ERROR, field_id, row_index)
