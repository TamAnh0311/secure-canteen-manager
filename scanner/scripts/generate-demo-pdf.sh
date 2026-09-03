#!/usr/bin/env bash
# Generate a scanner-ready ticket-v4 PDF from the current manager catalogue.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

PYTHON_BIN="${ORDER_SCANNER_PYTHON:-$PROJECT_DIR/.venv/bin/python}"
MAGICK_BIN="${MAGICK_BIN:-magick}"
CATALOGUE="$PROJECT_DIR/var/demo/manager-catalogue.json"
OUTPUT_DIR="$PROJECT_DIR/scanner-inbox"
DOCUMENT_CODE="100001"
ROOM="A1"
ITEM_ID="001"
QUANTITY="2"
FORCE=0
WORK_DIR=""
STAGED_PDF=""

usage() {
  cat <<'EOF'
Usage: scripts/generate-demo-pdf.sh [options]

Generate a ticket-v4 demo PDF and publish it to scanner-inbox.

Options:
  --catalogue PATH       Manager scanner catalogue JSON
  --output DIR           Destination directory watched by order-scanner
  --document-code CODE   Six-digit demo user code (default: 100001)
  --room ROOM            Demo room/cell, 1-4 alphanumeric characters (default: A1)
  --item-id ID           Active manager catalogue item ID (default: 001)
  --quantity NUMBER      Positive quantity (default: 2)
  --force                Replace an existing PDF with the same final filename
  -h, --help             Show this help

Environment:
  ORDER_SCANNER_PYTHON   Python executable (default: .venv/bin/python)
  MAGICK_BIN             ImageMagick executable (default: magick)
EOF
}

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

cleanup() {
  if [[ -n "$STAGED_PDF" && -e "$STAGED_PDF" ]]; then
    rm -f "$STAGED_PDF"
  fi
  if [[ -n "$WORK_DIR" && -d "$WORK_DIR" ]]; then
    rm -rf "$WORK_DIR"
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --catalogue)
      [[ $# -ge 2 ]] || fail "--catalogue requires a path"
      CATALOGUE="$2"
      shift 2
      ;;
    --output)
      [[ $# -ge 2 ]] || fail "--output requires a directory"
      OUTPUT_DIR="$2"
      shift 2
      ;;
    --document-code)
      [[ $# -ge 2 ]] || fail "--document-code requires a value"
      DOCUMENT_CODE="$2"
      shift 2
      ;;
    --room)
      [[ $# -ge 2 ]] || fail "--room requires a value"
      ROOM="$2"
      shift 2
      ;;
    --item-id)
      [[ $# -ge 2 ]] || fail "--item-id requires a value"
      ITEM_ID="$2"
      shift 2
      ;;
    --quantity)
      [[ $# -ge 2 ]] || fail "--quantity requires a value"
      QUANTITY="$2"
      shift 2
      ;;
    --force)
      FORCE=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "unknown option: $1"
      ;;
  esac
done

[[ "$DOCUMENT_CODE" =~ ^[0-9]{6}$ ]] || fail "document-code must contain exactly six ASCII digits"
[[ "$ROOM" =~ ^[A-Za-z0-9]{1,4}$ ]] || fail "room must be 1-4 ASCII alphanumeric characters"
command -v "$PYTHON_BIN" >/dev/null 2>&1 || fail "Python executable not found: $PYTHON_BIN"
command -v "$MAGICK_BIN" >/dev/null 2>&1 || fail "ImageMagick executable not found: $MAGICK_BIN"
[[ -f "$CATALOGUE" ]] || fail "manager catalogue not found: $CATALOGUE"

mkdir -p "$PROJECT_DIR/var/demo" "$OUTPUT_DIR"
WORK_DIR="$(mktemp -d "$PROJECT_DIR/var/demo/pdf-generation.XXXXXX")"
trap cleanup EXIT

"$PYTHON_BIN" "$SCRIPT_DIR/generate-demo-inbox.py" \
  --catalogue "$CATALOGUE" \
  --output "$WORK_DIR" \
  --document-code "$DOCUMENT_CODE" \
  --room "$ROOM" \
  --item-id "$ITEM_ID" \
  --quantity "$QUANTITY" >/dev/null

SOURCE_PNG="$WORK_DIR/demo-100001-ticket-v4.png"
FINAL_NAME="demo-${DOCUMENT_CODE}-ticket-v4.pdf"
TEMP_PDF="$WORK_DIR/$FINAL_NAME"
FINAL_PDF="$OUTPUT_DIR/$FINAL_NAME"

[[ -f "$SOURCE_PNG" ]] || fail "ticket generator did not create the expected PNG"
[[ ! -d "$FINAL_PDF" ]] || fail "destination is a directory: $FINAL_PDF"
if [[ -e "$FINAL_PDF" && "$FORCE" -ne 1 ]]; then
  fail "destination already exists: $FINAL_PDF (use --force to replace it)"
fi

"$MAGICK_BIN" "$SOURCE_PNG" -units PixelsPerInch -density 150 "$TEMP_PDF"
[[ -f "$TEMP_PDF" ]] || fail "ImageMagick did not create a PDF"
[[ "$(LC_ALL=C head -c 5 "$TEMP_PDF")" == "%PDF-" ]] || fail "generated file is not a valid PDF"

STAGED_PDF="$(mktemp "$OUTPUT_DIR/.${FINAL_NAME}.staging.XXXXXX")"
cp "$TEMP_PDF" "$STAGED_PDF"
if [[ "$FORCE" -eq 1 ]]; then
  mv -f "$STAGED_PDF" "$FINAL_PDF"
else
  if ! ln "$STAGED_PDF" "$FINAL_PDF" 2>/dev/null; then
    fail "destination already exists: $FINAL_PDF (use --force to replace it)"
  fi
  rm -f "$STAGED_PDF"
fi
STAGED_PDF=""

echo "Created scanner PDF: $FINAL_PDF"
