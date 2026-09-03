from __future__ import annotations

from order_scanner.template_v4 import CropSpec, NormalizedRect

TEMPLATE_VERSION = "ticket-skm-v1"
CANONICAL_DPI = 300
PAGE_WIDTH_TWIPS = 8_400
PAGE_HEIGHT_TWIPS = 11_900
CANONICAL_WIDTH = 1_750
CANONICAL_HEIGHT = 2_479
MARKER_SIZE_POINTS = 11.35
IDENTIFIER_CELL_COUNT = 6


def marker_centers() -> tuple[tuple[float, float], ...]:
    half = MARKER_SIZE_POINTS / 2
    positions = (
        (11.35 + half, 11.35 + half),
        (396.9 + half, 11.35 + half),
        (396.9 + half, 572.6 + half),
        (11.35 + half, 572.6 + half),
    )
    scale = CANONICAL_DPI / 72
    return tuple((x * scale, y * scale) for x, y in positions)


def crop_specs() -> tuple[CropSpec, ...]:
    specs: list[CropSpec] = []
    for index, (left, right) in enumerate(
        zip((408, 465, 521, 577, 634, 690), (465, 521, 577, 634, 690, 746), strict=True)
    ):
        rect = _pixel_rect(left, 284, right, 340)
        specs.append(CropSpec(f"ma_luu_ky.{index}", "identifier-cell", rect, rect.inset(0.08)))
    for index, (left, right) in enumerate(
        zip((1266, 1322, 1378, 1435), (1322, 1378, 1435, 1491), strict=True)
    ):
        rect = _pixel_rect(left, 284, right, 340)
        specs.append(CropSpec(f"buong_giam.{index}", "room-cell", rect, rect.inset(0.08)))

    row_boundaries = (
        605,
        711,
        818,
        923,
        1030,
        1136,
        1243,
        1349,
        1456,
        1561,
        1668,
        1774,
        1882,
    )
    row_pairs = zip(row_boundaries[:-1], row_boundaries[1:], strict=True)
    for row_index, (top, bottom) in enumerate(row_pairs):
        name_rect = _pixel_rect(212, top, 894, bottom)
        quantity_rect = _pixel_rect(894, top, 1080, bottom)
        specs.extend(
            (
                CropSpec(
                    f"items.{row_index}.name",
                    "item-name",
                    name_rect,
                    name_rect.inset(0.045),
                    row_index,
                ),
                CropSpec(
                    f"items.{row_index}.quantity",
                    "item-quantity",
                    quantity_rect,
                    quantity_rect.inset(0.07),
                    row_index,
                ),
            )
        )
    return tuple(specs)


def _pixel_rect(left: int, top: int, right: int, bottom: int) -> NormalizedRect:
    return NormalizedRect(
        left / CANONICAL_WIDTH,
        top / CANONICAL_HEIGHT,
        right / CANONICAL_WIDTH,
        bottom / CANONICAL_HEIGHT,
    )
