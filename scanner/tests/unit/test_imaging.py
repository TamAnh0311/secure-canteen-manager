from __future__ import annotations

from pathlib import Path
from typing import Any, cast

import cv2 as _cv2
import numpy as np
import pytest
from numpy.typing import NDArray
from PIL import Image

import order_scanner.imaging as imaging
from order_scanner.imaging import (
    AlignmentDisposition,
    DecodeError,
    DecodeLimits,
    align_page,
    blank_row_features,
    decode_document,
    extract_crops,
    fingerprint_distance,
    visual_fingerprint,
)
from order_scanner.template_skm import (
    TEMPLATE_VERSION as SKM_TEMPLATE_VERSION,
)
from order_scanner.template_skm import (
    crop_specs as skm_crop_specs,
)
from order_scanner.template_v4 import (
    CANONICAL_HEIGHT,
    CANONICAL_WIDTH,
    crop_specs,
    marker_centers,
)

cv2: Any = _cv2

LIMITS = DecodeLimits(
    max_pages=5,
    max_pixels_per_page=2_000_000,
    timeout_seconds=10,
    memory_mb=512,
    pdf_dpi=150,
)
TEMPLATE_FIXTURE = Path(__file__).parents[1] / "fixtures" / "template-v4" / "blank-rendered.png"


def _template_page() -> np.ndarray:
    page = np.full((CANONICAL_HEIGHT, CANONICAL_WIDTH), 255, dtype=np.uint8)
    for center_x, center_y in marker_centers():
        half = 22
        cv2.rectangle(
            page,
            (round(center_x) - half, round(center_y) - half),
            (round(center_x) + half, round(center_y) + half),
            0,
            thickness=-1,
        )
    for spec in crop_specs():
        left, top, right, bottom = spec.review_rect.pixels(
            CANONICAL_WIDTH, CANONICAL_HEIGHT
        )
        if spec.kind in {"identifier-cell", "room-cell"}:
            cv2.rectangle(page, (left, top), (right - 1, bottom - 1), 0, thickness=2)
        elif spec.kind == "item-name":
            cv2.line(page, (left, top), (right, top), 0, thickness=2)
            cv2.line(page, (left, bottom - 1), (right, bottom - 1), 0, thickness=2)
    row_specs = [
        spec
        for spec in crop_specs()
        if spec.kind in {"item-name", "item-quantity"}
    ]
    row_rectangles = [
        spec.review_rect.pixels(CANONICAL_WIDTH, CANONICAL_HEIGHT)
        for spec in row_specs
    ]
    row_top = min(rectangle[1] for rectangle in row_rectangles)
    row_bottom = max(rectangle[3] for rectangle in row_rectangles)
    for x in sorted(
        {coordinate for rectangle in row_rectangles for coordinate in (rectangle[0], rectangle[2])}
    ):
        cv2.line(page, (x, row_top), (x, row_bottom), 0, thickness=2)
    return page


def _skm_template_page() -> np.ndarray:
    page = np.full((CANONICAL_HEIGHT, CANONICAL_WIDTH), 255, dtype=np.uint8)
    for center_x, center_y in marker_centers():
        cv2.rectangle(
            page,
            (round(center_x) - 22, round(center_y) - 22),
            (round(center_x) + 22, round(center_y) + 22),
            0,
            thickness=-1,
        )
    for spec in skm_crop_specs():
        left, top, right, bottom = spec.review_rect.pixels(
            CANONICAL_WIDTH, CANONICAL_HEIGHT
        )
        if spec.kind in {"identifier-cell", "room-cell"}:
            cv2.rectangle(page, (left, top), (right - 1, bottom - 1), 0, thickness=2)
        elif spec.kind == "item-name":
            cv2.line(page, (left, top), (right, top), 0, thickness=2)
            cv2.line(page, (left, bottom - 1), (right, bottom - 1), 0, thickness=2)
    rows = [
        spec.review_rect.pixels(CANONICAL_WIDTH, CANONICAL_HEIGHT)
        for spec in skm_crop_specs()
        if spec.kind in {"item-name", "item-quantity"}
    ]
    for x in sorted({coordinate for row in rows for coordinate in (row[0], row[2])}):
        cv2.line(
            page,
            (x, min(row[1] for row in rows)),
            (x, max(row[3] for row in rows)),
            0,
            thickness=2,
        )
    return page


def test_marker_alignment_and_missing_marker_disposition() -> None:
    canonical = _template_page()
    source_corners: NDArray[np.float32] = np.asarray(
            [
                [15, 10],
                [CANONICAL_WIDTH - 10, 20],
                [CANONICAL_WIDTH - 20, CANONICAL_HEIGHT - 15],
                [20, CANONICAL_HEIGHT - 25],
        ],
        dtype=np.float32,
    )
    target_corners: NDArray[np.float32] = np.asarray(
        [
            [0, 0],
            [CANONICAL_WIDTH, 0],
            [CANONICAL_WIDTH, CANONICAL_HEIGHT],
            [0, CANONICAL_HEIGHT],
        ],
        dtype=np.float32,
    )
    distortion = cv2.getPerspectiveTransform(target_corners, source_corners)
    distorted = cast(
        NDArray[np.uint8],
        cv2.warpPerspective(
            canonical,
            distortion,
            (CANONICAL_WIDTH, CANONICAL_HEIGHT),
            borderValue=255,
        ),
    )

    result = align_page(distorted)

    assert result.disposition is AlignmentDisposition.ALIGNED
    assert result.aligned is not None
    assert fingerprint_distance(
        visual_fingerprint(canonical), visual_fingerprint(result.aligned)
    ) <= 8

    missing = canonical.copy()
    center_x, center_y = marker_centers()[0]
    cv2.rectangle(
        missing,
        (round(center_x) - 30, round(center_y) - 30),
        (round(center_x) + 30, round(center_y) + 30),
        255,
        thickness=-1,
    )
    failed = align_page(missing)
    assert failed.disposition is AlignmentDisposition.NEEDS_REVIEW
    assert failed.reason_code == "registration_markers_missing"


def test_alignment_rejects_identifier_grid_with_extra_cells() -> None:
    page = _template_page()
    identifier_specs = [spec for spec in crop_specs() if spec.kind == "identifier-cell"]
    first = identifier_specs[0].review_rect
    last = identifier_specs[-1].review_rect
    cell_width = last.right - last.left
    for index in range(2):
        left = last.right + cell_width * index
        right = left + cell_width
        extra = type(first)(left, first.top, right, first.bottom)
        x1, y1, x2, y2 = extra.pixels(CANONICAL_WIDTH, CANONICAL_HEIGHT)
        cv2.rectangle(page, (x1, y1), (x2 - 1, y2 - 1), 0, thickness=2)

    result = align_page(page)

    assert result.disposition is AlignmentDisposition.NEEDS_REVIEW
    assert result.reason_code == "template_identifier_grid_mismatch"


def test_alignment_rejects_shifted_internal_template_geometry() -> None:
    page = _template_page()
    vertical_shift = 18
    page[245:380, 380:1_180] = 255
    page[430:2_020, 150:1_120] = 255

    for spec in crop_specs():
        left, top, right, bottom = spec.review_rect.pixels(
            CANONICAL_WIDTH, CANONICAL_HEIGHT
        )
        if spec.kind in {"identifier-cell", "room-cell"}:
            cv2.rectangle(
                page,
                (left, top + vertical_shift),
                (right - 1, bottom - 1 + vertical_shift),
                0,
                thickness=2,
            )
        elif spec.kind == "item-name":
            cv2.line(
                page,
                (left, top + vertical_shift),
                (right, top + vertical_shift),
                0,
                thickness=2,
            )
            cv2.line(
                page,
                (left, bottom - 1 + vertical_shift),
                (right, bottom - 1 + vertical_shift),
                0,
                thickness=2,
            )

    row_rectangles = [
        spec.review_rect.pixels(CANONICAL_WIDTH, CANONICAL_HEIGHT)
        for spec in crop_specs()
        if spec.kind in {"item-name", "item-quantity"}
    ]
    row_top = min(rectangle[1] for rectangle in row_rectangles) + vertical_shift
    row_bottom = max(rectangle[3] for rectangle in row_rectangles) + vertical_shift
    for x in sorted(
        {coordinate for rectangle in row_rectangles for coordinate in (rectangle[0], rectangle[2])}
    ):
        cv2.line(page, (x, row_top), (x, row_bottom), 0, thickness=2)

    result = align_page(page)

    assert result.disposition is AlignmentDisposition.NEEDS_REVIEW
    assert result.reason_code == "template_geometry_mismatch"


def test_alignment_accepts_light_identifier_grid_lines() -> None:
    page = _template_page()
    for spec in crop_specs():
        if spec.kind != "identifier-cell":
            continue
        left, top, right, bottom = spec.review_rect.pixels(
            CANONICAL_WIDTH, CANONICAL_HEIGHT
        )
        cv2.rectangle(
            page,
            (left, top),
            (right - 1, bottom - 1),
            200,
            thickness=2,
        )

    result = align_page(page)

    assert result.disposition is AlignmentDisposition.ALIGNED
    assert result.aligned is not None


def test_alignment_rejects_structure_score_spoof_with_invalid_geometry() -> None:
    page = _template_page()
    for spec in crop_specs():
        if spec.kind != "item-name":
            continue
        left, top, right, bottom = spec.review_rect.pixels(
            CANONICAL_WIDTH, CANONICAL_HEIGHT
        )
        for y in (top, bottom - 1):
            cv2.line(page, (left, y), (right, y), 255, thickness=7)
            mirrored_y = CANONICAL_HEIGHT - 1 - y
            mirrored_left = CANONICAL_WIDTH - right
            mirrored_right = CANONICAL_WIDTH - left
            cv2.line(
                page,
                (mirrored_left, mirrored_y),
                (mirrored_right, mirrored_y),
                0,
                thickness=5,
            )

    result = align_page(page)

    assert result.disposition is AlignmentDisposition.NEEDS_REVIEW
    assert result.reason_code == "template_geometry_mismatch"


def test_alignment_prefers_valid_grid_when_orientation_scores_tie(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(imaging, "_structure_score", lambda _image: 0.5)

    result = align_page(_template_page())

    assert result.disposition is AlignmentDisposition.ALIGNED
    assert result.aligned is not None


def test_rendered_ticket_fixture_keeps_supported_geometry() -> None:
    image = np.asarray(Image.open(TEMPLATE_FIXTURE).convert("L"), dtype=np.uint8)

    result = align_page(image)

    assert result.disposition is AlignmentDisposition.ALIGNED
    assert result.aligned is not None
    assert len(extract_crops(result.aligned)) == 34
    assert float(np.mean(result.aligned[469:474, 222:901] < 180)) > 0.7
    assert float(np.mean(result.aligned[594:600, 222:901] < 180)) > 0.7
    assert float(np.mean(result.aligned[700:704, 222:901] < 230)) > 0.45
    assert float(np.mean(result.aligned[1869:1875, 222:901] < 180)) > 0.7


def test_skm_profile_is_selected_from_geometry_and_extracts_matching_crops() -> None:
    result = align_page(_skm_template_page())

    assert result.disposition is AlignmentDisposition.ALIGNED
    assert result.aligned is not None
    assert result.template_version == SKM_TEMPLATE_VERSION
    crops = extract_crops(result.aligned, result.template_version)
    assert len(crops) == 34
    assert {crop.spec.field_name for crop in crops} == {
        spec.field_name for spec in skm_crop_specs()
    }


def test_alignment_disambiguates_180_degree_rotation_and_rejects_clipped_markers() -> None:
    canonical = _template_page()
    rotated = np.ascontiguousarray(np.rot90(canonical, 2))

    result = align_page(rotated)

    assert result.disposition is AlignmentDisposition.ALIGNED
    assert result.aligned is not None
    assert fingerprint_distance(
        visual_fingerprint(canonical), visual_fingerprint(result.aligned)
    ) <= 8

    clipped = canonical.copy()
    for center_x, center_y in marker_centers():
        cv2.rectangle(
            clipped,
            (round(center_x) - 75, round(center_y) - 75),
            (round(center_x) - 15, round(center_y) - 15),
            255,
            thickness=-1,
        )
    clipped_result = align_page(clipped)
    assert clipped_result.disposition is AlignmentDisposition.NEEDS_REVIEW
    assert clipped_result.reason_code in {
        "registration_markers_missing",
        "registration_marker_clipped",
    }


def test_faded_phone_markers_are_detected() -> None:
    page = _template_page()
    for center_x, center_y in marker_centers():
        cv2.rectangle(
            page,
            (round(center_x) - 22, round(center_y) - 22),
            (round(center_x) + 22, round(center_y) + 22),
            125,
            thickness=-1,
        )

    result = align_page(page)

    assert result.disposition is AlignmentDisposition.ALIGNED
    assert result.aligned is not None


def test_halftoned_scanner_markers_are_detected() -> None:
    page = _template_page()
    for marker_index, (center_x, center_y) in enumerate(marker_centers()):
        left = round(center_x) - 22
        top = round(center_y) - 22
        right = round(center_x) + 23
        bottom = round(center_y) + 23
        page[top:bottom, left:right] = 255
        marker = np.full((45, 45), 170 if marker_index < 2 else 155, dtype=np.uint8)
        marker[::3, :] = 100
        marker[:, ::3] = 100
        page[top:bottom, left:right] = marker

    result = align_page(page)

    assert result.disposition is AlignmentDisposition.ALIGNED
    assert result.aligned is not None


@pytest.mark.parametrize("replacement_center", [95, 110, 120, 130, 142])
def test_extra_corner_component_is_not_accepted_as_a_marker(
    replacement_center: int,
) -> None:
    page = _template_page()
    center_x, center_y = marker_centers()[0]
    cv2.rectangle(
        page,
        (round(center_x) - 30, round(center_y) - 30),
        (round(center_x) + 30, round(center_y) + 30),
        255,
        thickness=-1,
    )
    cv2.rectangle(
        page,
        (replacement_center - 22, replacement_center - 22),
        (replacement_center + 22, replacement_center + 22),
        0,
        thickness=-1,
    )

    result = align_page(page)

    assert result.disposition is AlignmentDisposition.NEEDS_REVIEW


def test_fixed_crops_and_blank_features_are_provisional_measurements() -> None:
    page = _template_page()
    first_identifier = next(
        spec for spec in crop_specs() if spec.field_name == "ma_luu_ky.0"
    )
    first_name = next(spec for spec in crop_specs() if spec.field_name == "items.0.name")
    last_name = next(spec for spec in crop_specs() if spec.field_name == "items.11.name")
    assert first_identifier.review_rect.pixels(CANONICAL_WIDTH, CANONICAL_HEIGHT) == (
        408,
        278,
        465,
        334,
    )
    assert first_name.review_rect.pixels(CANONICAL_WIDTH, CANONICAL_HEIGHT) == (
        222,
        594,
        901,
        700,
    )
    assert last_name.review_rect.pixels(CANONICAL_WIDTH, CANONICAL_HEIGHT) == (
        222,
        1_762,
        901,
        1_869,
    )
    left, top, right, bottom = first_name.inference_rect.pixels(
        CANONICAL_WIDTH, CANONICAL_HEIGHT
    )
    cv2.line(page, (left + 5, top + 5), (right - 5, bottom - 5), 0, thickness=4)

    crops = extract_crops(page)
    features = blank_row_features(crops)

    assert len(crops) == 34
    assert {crop.spec.field_name for crop in crops} == {
        spec.field_name for spec in crop_specs()
    }
    assert features[0].ink_ratio > features[1].ink_ratio
    assert features[0].component_count >= 1


@pytest.mark.parametrize("extension", [".png", ".jpg"])
def test_isolated_decoder_accepts_single_page_images(tmp_path: Path, extension: str) -> None:
    source = tmp_path / f"scan{extension}"
    Image.new("L", (120, 80), 240).save(source)

    decoded = decode_document(source, tmp_path / "decoded", LIMITS)

    assert len(decoded.pages) == 1
    assert decoded.pages[0].load().shape == (80, 120)


def test_isolated_decoder_accepts_multi_page_tiff_and_pdf(tmp_path: Path) -> None:
    frames = [Image.new("L", (120, 80), value) for value in (220, 230)]
    for extension, format_name in ((".tiff", "TIFF"), (".pdf", "PDF")):
        source = tmp_path / f"scan{extension}"
        frames[0].save(source, format=format_name, save_all=True, append_images=frames[1:])

        decoded = decode_document(source, tmp_path / f"decoded-{format_name}", LIMITS)

        assert [page.page_index for page in decoded.pages] == [0, 1]


def test_pdf_decoder_enforces_limit_on_actual_bitmap_dimensions(tmp_path: Path) -> None:
    source = tmp_path / "rounding-boundary.pdf"
    Image.new("L", (1_700, 2_450), 240).save(source, format="PDF", resolution=72)
    limits = DecodeLimits(
        max_pages=1,
        max_pixels_per_page=18_078_368,
        timeout_seconds=10,
        memory_mb=512,
        pdf_dpi=150,
    )

    with pytest.raises(DecodeError) as error:
        decode_document(source, tmp_path / "decoded-boundary", limits)

    assert error.value.reason_code == "pixel_limit_exceeded"


def test_isolated_decoder_rejects_malformed_and_oversized_inputs(tmp_path: Path) -> None:
    malformed = tmp_path / "bad.pdf"
    malformed.write_bytes(b"%PDF-1.7\nnot a document")
    with pytest.raises(DecodeError) as malformed_error:
        decode_document(malformed, tmp_path / "bad-output", LIMITS)
    assert malformed_error.value.reason_code == "malformed_pdf"

    oversized = tmp_path / "large.png"
    Image.new("L", (2_000, 2_000), 255).save(oversized)
    with pytest.raises(DecodeError) as oversized_error:
        decode_document(oversized, tmp_path / "large-output", LIMITS)
    assert oversized_error.value.reason_code in {
        "malformed_image",
        "pixel_limit_exceeded",
    }
