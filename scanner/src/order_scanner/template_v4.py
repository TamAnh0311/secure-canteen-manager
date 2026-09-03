from __future__ import annotations

from dataclasses import dataclass

TEMPLATE_VERSION = "ticket-v4"
CANONICAL_DPI = 300
PAGE_WIDTH_TWIPS = 8_400
PAGE_HEIGHT_TWIPS = 11_900
CANONICAL_WIDTH = round(PAGE_WIDTH_TWIPS * CANONICAL_DPI / 1_440)
CANONICAL_HEIGHT = round(PAGE_HEIGHT_TWIPS * CANONICAL_DPI / 1_440)
MARKER_SIZE_POINTS = 11.35
IDENTIFIER_TOP_TWIPS = 1_335
IDENTIFIER_LEFT_TWIPS = 1_960
IDENTIFIER_CELL_TWIPS = 270
IDENTIFIER_CELL_COUNT = 6
TABLE_TOP_TWIPS = 2_250
TABLE_HEADER_TWIPS = 600
TABLE_ROW_TWIPS = 510


@dataclass(frozen=True, slots=True)
class NormalizedRect:
    left: float
    top: float
    right: float
    bottom: float

    def __post_init__(self) -> None:
        if not (0 <= self.left < self.right <= 1 and 0 <= self.top < self.bottom <= 1):
            raise ValueError("normalized rectangle must be ordered within the page")

    def pixels(self, width: int, height: int) -> tuple[int, int, int, int]:
        left = max(0, min(width - 1, round(self.left * width)))
        top = max(0, min(height - 1, round(self.top * height)))
        right = max(left + 1, min(width, round(self.right * width)))
        bottom = max(top + 1, min(height, round(self.bottom * height)))
        return left, top, right, bottom

    def inset(self, fraction: float) -> NormalizedRect:
        if not 0 <= fraction < 0.5:
            raise ValueError("inset fraction must be between zero and one half")
        width = self.right - self.left
        height = self.bottom - self.top
        return NormalizedRect(
            self.left + width * fraction,
            self.top + height * fraction,
            self.right - width * fraction,
            self.bottom - height * fraction,
        )


@dataclass(frozen=True, slots=True)
class CropSpec:
    field_name: str
    kind: str
    review_rect: NormalizedRect
    inference_rect: NormalizedRect
    row_index: int | None = None


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
    identifier_top = IDENTIFIER_TOP_TWIPS
    cell_size = IDENTIFIER_CELL_TWIPS
    identifier_left = IDENTIFIER_LEFT_TWIPS
    room_left = 6_060
    for index in range(6):
        rect = _twips_rect(
            identifier_left + index * cell_size,
            identifier_top,
            cell_size,
            cell_size,
        )
        specs.append(
            CropSpec(f"ma_luu_ky.{index}", "identifier-cell", rect, rect.inset(0.08))
        )
    for index in range(4):
        rect = _twips_rect(
            room_left + index * cell_size,
            identifier_top,
            cell_size,
            cell_size,
        )
        specs.append(
            CropSpec(f"buong_giam.{index}", "room-cell", rect, rect.inset(0.08))
        )

    table_left = 510
    table_top = TABLE_TOP_TWIPS
    header_height = TABLE_HEADER_TWIPS
    row_height = TABLE_ROW_TWIPS
    name_left = table_left + 556
    name_width = 3_105 + 154
    quantity_left = name_left + name_width
    quantity_width = 895
    for row_index in range(12):
        row_top = table_top + header_height + row_index * row_height
        name_rect = _twips_rect(name_left, row_top, name_width, row_height)
        quantity_rect = _twips_rect(
            quantity_left, row_top, quantity_width, row_height
        )
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


def _twips_rect(left: int, top: int, width: int, height: int) -> NormalizedRect:
    return NormalizedRect(
        left / PAGE_WIDTH_TWIPS,
        top / PAGE_HEIGHT_TWIPS,
        (left + width) / PAGE_WIDTH_TWIPS,
        (top + height) / PAGE_HEIGHT_TWIPS,
    )
