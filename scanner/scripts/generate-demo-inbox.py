"""Generate a deterministic, non-personal ticket-v4 scanner input."""

from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from order_scanner.catalogue import accent_stripped, load_catalogue
from order_scanner.template_v4 import crop_specs


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalogue", type=Path, required=True)
    parser.add_argument("--scanner-catalogue", type=Path)
    parser.add_argument("--output", type=Path, default=Path("scanner-inbox"))
    parser.add_argument("--document-code", default="100001")
    parser.add_argument("--room", default="A1")
    parser.add_argument("--item-id", default="001")
    parser.add_argument("--quantity", type=int, default=2)
    args = parser.parse_args()

    catalogue = json.loads(args.catalogue.read_text(encoding="utf-8"))
    generated_at = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    if catalogue.get("schemaVersion") != "scanner-catalogue-v1":
        raise SystemExit("catalogue schemaVersion must be scanner-catalogue-v1")
    if len(args.document_code) != 6 or not args.document_code.isdigit():
        raise SystemExit("document-code must contain exactly six digits")
    if not args.room or len(args.room) > 4 or not args.room.isalnum():
        raise SystemExit("room must be 1-4 alphanumeric characters")
    if args.quantity < 1:
        raise SystemExit("quantity must be positive")
    item = next(
        (
            entry
            for entry in catalogue.get("items", [])
            if entry.get("catalogueItemId") == args.item_id
        ),
        None,
    )
    if not item or not item.get("active"):
        raise SystemExit(f"active catalogue item {args.item_id} was not found")

    fixture = Path(__file__).resolve().parents[1] / "tests/fixtures/template-v4/blank-rendered.png"
    image = Image.open(fixture).convert("L")
    draw = ImageDraw.Draw(image)
    specs = {spec.field_name: spec for spec in crop_specs()}
    font_path = _font_path(bold=False)
    bold_path = _font_path(bold=True)

    def fit_font(
        text: str, box: tuple[int, int, int, int], *, bold: bool = False
    ) -> ImageFont.FreeTypeFont:
        path = bold_path if bold else font_path
        left, top, right, bottom = box
        for size in range(28, 7, -1):
            font = ImageFont.truetype(path, size)
            bbox = draw.textbbox((0, 0), text, font=font)
            if bbox[2] - bbox[0] <= right - left - 6 and bbox[3] - bbox[1] <= bottom - top - 6:
                return font
        return ImageFont.truetype(path, 8)

    def centered(text: str, box: tuple[int, int, int, int], *, bold: bool = False) -> None:
        left, top, right, bottom = box
        font = fit_font(text, box, bold=bold)
        bbox = draw.textbbox((0, 0), text, font=font)
        x = left + ((right - left) - (bbox[2] - bbox[0])) / 2 - bbox[0]
        y = top + ((bottom - top) - (bbox[3] - bbox[1])) / 2 - bbox[1]
        draw.text((round(x), round(y)), text, fill=25, font=font)

    for index, value in enumerate(args.document_code):
        centered(value, specs[f"ma_luu_ky.{index}"].review_rect.pixels(*image.size), bold=True)
    for index, value in enumerate(args.room):
        centered(value, specs[f"buong_giam.{index}"].review_rect.pixels(*image.size), bold=True)
    centered(
        str(item["name"]),
        specs["items.0.name"].review_rect.pixels(*image.size),
    )
    centered(
        str(args.quantity),
        specs["items.0.quantity"].review_rect.pixels(*image.size),
        bold=True,
    )
    stamp_font = ImageFont.truetype(font_path, 8)
    draw.text(
        (image.width // 2 - 90, image.height - 24),
        f"DEMO {generated_at}",
        fill=120,
        font=stamp_font,
    )

    args.output.mkdir(parents=True, exist_ok=True)
    output = args.output / "demo-100001-ticket-v4.png"
    image.save(output, "PNG")
    metadata = {
        "catalogue_version": catalogue["version"],
        "document_code": args.document_code,
        "room": args.room,
        "item_id": args.item_id,
        "item_name": item["name"],
        "quantity": args.quantity,
        "template": "ticket-v4",
        "generated_at": generated_at,
    }
    (args.output / "demo-100001-ticket-v4.json").write_text(
        json.dumps(metadata, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    if args.scanner_catalogue:
        scanner_catalogue = _scanner_catalogue(catalogue)
        args.scanner_catalogue.parent.mkdir(parents=True, exist_ok=True)
        args.scanner_catalogue.write_text(
            json.dumps(scanner_catalogue, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        load_catalogue(args.scanner_catalogue)
    print(json.dumps({"file": str(output), **metadata}, sort_keys=True))


def _scanner_catalogue(manager_catalogue: dict[str, object]) -> dict[str, object]:
    items: list[dict[str, object]] = []
    aliases: set[str] = set()
    raw_items = manager_catalogue.get("items")
    if not isinstance(raw_items, list):
        raise SystemExit("catalogue items must be a list")
    for entry in raw_items:
        if not isinstance(entry, dict) or not entry.get("active"):
            continue
        name = str(entry["name"])
        alias = accent_stripped(name)
        item_aliases = [] if alias == name else [alias]
        for value in item_aliases:
            key = value.casefold()
            if key in aliases:
                raise SystemExit(f"generated catalogue alias collision: {value}")
            aliases.add(key)
        items.append(
            {
                "aliases": item_aliases,
                "canonical_name": name,
                "item_id": str(entry["catalogueItemId"]),
            }
        )
    return {
        "created_at": f"{datetime.now(UTC).date().isoformat()}T00:00:00Z",
        "items": items,
        "version": manager_catalogue["version"],
    }


def _font_path(*, bold: bool) -> str:
    candidates = (
        Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
    ) if bold else (
        Path("/System/Library/Fonts/Supplemental/Arial.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
    )
    for candidate in candidates:
        if candidate.is_file():
            return str(candidate)
    raise SystemExit("a supported Arial or DejaVu Sans font is required")


if __name__ == "__main__":
    main()
