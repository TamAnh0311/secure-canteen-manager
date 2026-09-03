from order_scanner.contracts import FieldResult, ResultOutcome
from order_scanner.validation import BlankDisposition, RowEvidence, validate_page


def _fields(item: str | None, quantity: int | None, row: int = 0) -> RowEvidence:
    return RowEvidence(
        row,
        BlankDisposition.PRESENT,
        FieldResult(f"items.{row}.item", item, item, 0.9),
        FieldResult(
            f"items.{row}.quantity",
            quantity,
            str(quantity) if quantity is not None else None,
            0.9,
        ),
        "001" if item else None,
    )


def test_blank_row_with_no_content_is_ignored() -> None:
    row = RowEvidence(
        0,
        BlankDisposition.BLANK,
        FieldResult("items.0.item", None, None, None),
        FieldResult("items.0.quantity", None, None, None),
    )
    result = validate_page(
        FieldResult("ma_luu_ky", "000001", "000001", 0.9),
        FieldResult("buong_giam", "A1", "A1", 0.9),
        (row,),
    )
    assert result.outcome is ResultOutcome.ACCEPTED
    assert result.items == ()


def test_one_sided_row_is_needs_review() -> None:
    result = validate_page(
        FieldResult("ma_luu_ky", "000001", "000001", 0.9),
        FieldResult("buong_giam", "A1", "A1", 0.9),
        (_fields("Pho", None),),
    )
    assert result.outcome is ResultOutcome.NEEDS_REVIEW
    assert any(
        warning.code == "item_quantity_pair_incomplete"
        for warning in result.items[0].quantity.warnings
    )


def test_uncertain_blank_is_needs_review_even_when_fields_are_empty() -> None:
    result = validate_page(
        FieldResult("ma_luu_ky", "000001", "000001", 0.9),
        FieldResult("buong_giam", "A1", "A1", 0.9),
        (
            RowEvidence(
                0,
                BlankDisposition.UNCERTAIN,
                FieldResult("items.0.item", None, None, None),
                FieldResult("items.0.quantity", None, None, None),
            ),
        ),
    )
    assert result.outcome is ResultOutcome.NEEDS_REVIEW
    assert result.warnings[0].code == "blank_row_uncertain"
