# Local Form Generator & Phone Scan — Design Spec

**Date:** 2026-09-18
**Status:** Approved for Implementation

---

## Goal

Build a self-contained form generation and scanning pipeline that works without the external OMR microservice. Two deliverables:

1. **Local PDF form generator** — produces printable A4/A5 order forms with OMR bubbles directly in the backend
2. **Phone scan page** — a mobile-friendly web page that uses the phone camera to capture filled forms, then auto-processes them into orders

---

## Part 1: Local PDF Form Generator

### Architecture

The local renderer lives inside the existing `OmrClientService` as a fallback. When the external OMR service is unreachable or `OMR_SERVICE_URL` is set to `local`, the service delegates to `LocalFormRenderer` instead of making an HTTP call.

```
MenuController.generateForm(mode)
  → OmrClientService.generateA5Template(input)
      → if external service available → HTTP POST (existing behaviour)
      → else → LocalFormRenderer.renderTemplate(input)
      → returns { roi_template, pdf_base64 }  ← same contract
```

No changes to the controller, template activation, or any downstream consumer.

### Dependencies

- `pdf-lib` — pure JS PDF generation, zero native deps, works in Electron
- `qrcode` — generates QR code PNG buffer to embed in the PDF

### Paper Sizes

| Size | Dimensions (pt) | Rows per column | Max items (2-col) |
|------|-----------------|-----------------|-------------------|
| A4   | 595 × 842       | ~26             | 52                |
| A5   | 420 × 595       | ~13             | 26                |

Default is A4. The layout engine uses relative margins and row heights so the grid scales to either size. The existing `paper_size` field on `OmrFormTemplate` stores the choice.

### Form Layout — `full_list` Mode

2-column table. Each row: 3-digit code, truncated item name, 5 OMR bubbles (qty 1–5).

```
┌─■──────────────────────────────────────■─┐
│  PHIẾU ĐẶT HÀNG CANTEEN          [QR]  │
│  Họ tên: ________________  Mã: ________ │
│  Khu: __________  Phòng: ______________ │
│  Ngày phục vụ: _____/_____/_____        │
│─────────────────────────────────────────│
│ MÃ  TÊN HÀNG      1 2 3 4 5 │ MÃ  TÊN HÀNG      1 2 3 4 5 │
│ 001 Cơm trắng     ○○○○○     │ 027 Xà phòng       ○○○○○     │
│ 002 Phở bò        ○○○○○     │ 028 Kem đánh răng  ○○○○○     │
│ ...                          │ ...                            │
│ 026 Nước ngọt     ○○○○○     │ 052 Dầu gội        ○○○○○     │
└─■──────────────────────────────────────■─┘
```

Items split evenly: left column gets items 1..⌈N/2⌉, right column gets the rest.

### Form Layout — `code` Mode

Left side: order lines with 3 handwritten digit boxes (code) + 5 OMR bubbles (qty). Right side: 2-column menu legend (code → name).

```
┌─■──────────────────────────────────────■─┐
│  PHIẾU ĐẶT HÀNG CANTEEN          [QR]  │
│  Họ tên: ________________  Mã: ________ │
│  Khu: __________  Phòng: ______________ │
│  Ngày phục vụ: _____/_____/_____        │
│─────────────────────────────────────────│
│  DÒNG ĐẶT HÀNG        │ BẢNG MÃ HÀNG  │
│  MÃ       SL           │ 001 Cơm trắng │
│  [_][_][_] ○○○○○       │ 002 Phở bò    │
│  [_][_][_] ○○○○○       │ 003 Mì xào    │
│  [_][_][_] ○○○○○       │ ...           │
│  ... (12–15 lines)     │ (all items)   │
└─■──────────────────────────────────────■─┘
```

### Shared Elements

- **4 registration marks** — 8×8pt solid black squares at each corner, inset 10pt from page edge. Used by the scan processor to detect rotation and perspective.
- **QR code** — 80×80pt, top-right of header. Encodes JSON: `{ "t": "<form_token>", "r": "<revision>", "m": "<mode>" }`. Read by scan processor to identify the form.
- **Header** — title, identity fields (name, ID, zone/cell), service date. For issued (personalized) forms, these are pre-filled; for generic/template forms, they are blank underlines.

### ROI Template

The renderer produces a `roi_template` object matching the contract the codebase already validates:

```typescript
interface LocalRoiTemplate {
  schema_version: 'omr-a5-v2';
  mode: 'code' | 'full_list';
  orientation: 'portrait';
  paper_size: 'A4' | 'A5';
  page_width_pt: number;
  page_height_pt: number;
  registration_marks: Array<{ x: number; y: number; w: number; h: number }>;
  qr_region: { x: number; y: number; w: number; h: number };

  // full_list mode — one entry per bubble
  bubbles?: Array<{
    row_index: number;
    menu_item_id: string;
    quantity: number;          // 1–5
    cx: number; cy: number;    // center coordinates in pt
    r: number;                 // radius in pt
  }>;

  // code mode — digit boxes + qty bubbles per order line
  digit_boxes?: Array<{
    line_index: number;
    box_index: number;         // 0–2 (three digit boxes)
    x: number; y: number;
    w: number; h: number;
  }>;
  qty_bubbles?: Array<{
    line_index: number;
    quantity: number;           // 1–5
    cx: number; cy: number;
    r: number;
  }>;
}
```

Coordinates are in PDF points (1pt = 1/72 inch) from top-left origin, matching the PDF coordinate space. The scan processor converts to pixel coordinates using the scanned image DPI.

### File Structure

```
canteen-manager/backend/src/omr/
  omr-client.service.ts          ← add fallback routing
  local-form-renderer.ts         ← NEW: PDF generation + ROI builder
  local-form-renderer.spec.ts    ← (deferred)
```

---

## Part 2: Phone Scan Page

### Concept

A mobile-optimised web page accessible from any phone on the LAN. Staff opens `http://<LAN_IP>:3000/scan` in the phone browser, points the camera at a filled order form, captures it, and the backend auto-processes it into an order.

### Frontend — Scan Page

New route: `/scan` (public, accessible from phone browser without full app navigation).

Components:
- **Camera viewfinder** — uses `navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })` for the rear camera
- **Capture button** — takes a snapshot from the video stream onto a canvas
- **Preview + confirm** — shows the captured image, lets staff retake or submit
- **Processing indicator** — spinner while backend processes
- **Result display** — shows the extracted order (items + quantities) or error

Flow:
```
Camera viewfinder → [Capture] → Preview → [Submit] → POST /api/scan/process
  → Processing... → Order created: "Nguyen Van An — 3 items, 45,000₫"
  → [Scan another]
```

The page is a standalone React route. It does NOT require authentication for the MVP (it's on a trusted LAN), but can be gated behind a simple PIN or staff login later.

### Backend — Scan Processing Endpoint

New controller: `ScanProcessorController` with a single endpoint.

```
POST /api/scan/process
Content-Type: multipart/form-data
Body: { image: <file> }

Response 200:
{
  "formToken": "abc-123",
  "mode": "full_list",
  "items": [
    { "menuItemId": "uuid", "code": "001", "name": "Cơm trắng", "quantity": 3 },
    { "menuItemId": "uuid", "code": "002", "name": "Phở bò", "quantity": 1 }
  ],
  "orderId": "uuid" | null,
  "status": "created" | "review_required",
  "warnings": ["low_confidence_item_003"]
}
```

### Scan Processing Pipeline

The backend processing is a sequential pipeline:

```
Image upload
  → 1. Decode image (JPEG/PNG → raw pixels via `sharp`)
  → 2. Find registration marks (corner detection → perspective transform)
  → 3. Read QR code (jsQR) → get form token, revision, mode
  → 4. Look up ROI template from the form's revision
  → 5. Extract bubble regions using ROI coordinates
  → 6. Analyse each bubble (mean fill ratio → ticked/empty)
  → 7. Map ticked bubbles to menu items + quantities
  → 8. Create order via existing OrdersService
  → Return result
```

#### Step 2 — Registration Mark Detection

- Convert to grayscale, threshold to binary
- Scan the 4 corner quadrants for the darkest connected blob
- Compute a perspective transform matrix from the 4 detected corners to the expected corners
- Apply the transform to normalise the image to the expected page geometry

#### Step 5–6 — Bubble Analysis

For each bubble in the ROI template:
- Crop the circular region at `(cx, cy, r)` (transformed to pixel coords)
- Compute the mean pixel intensity (0=black, 255=white)
- Fill ratio = (255 − mean) / 255
- If fill ratio > `omr_ticked_min` → ticked
- If fill ratio < `omr_empty_max` → empty
- Between → flagged for review

Thresholds come from `ThresholdConfigService` (already exists).

#### Step 7 — Order Extraction

- For `full_list` mode: each ticked bubble maps directly to a `menu_item_id` + `quantity` via the ROI template
- For `code` mode: digit boxes are read via simple template-matching digit recognition (0–9), then looked up against the menu code table
- If a row has multiple bubbles ticked → take the highest quantity (or flag)
- If QR token identifies an issued form → link to the prisoner via `IssuedOmrForm`

### Dependencies

- `sharp` — image decode, resize, grayscale, crop (has prebuilt binaries for Windows/Electron)
- `jsqr` — pure JS QR code reader from pixel data

### File Structure

```
canteen-manager/backend/src/scan-local/
  scan-local.controller.ts       ← POST /scan/process endpoint
  scan-local.service.ts          ← orchestrates the pipeline
  scan-local.module.ts
  image-processor.ts             ← registration mark detection, perspective transform
  bubble-reader.ts               ← bubble fill analysis
  digit-reader.ts                ← digit box ICR (code mode)

canteen-manager/frontend/src/features/phone-scan/
  phone-scan-page.tsx            ← camera + capture + result UI
```

### Phone Scan Page — Accessibility from LAN

The app already binds to `0.0.0.0` and serves the frontend. The phone just needs to navigate to `http://<LAN_IP>:3000/scan`. The `LAN_IP` is already detected by the Electron app and could be shown as a QR code on the desktop UI for easy phone access.

---

## Scope Summary

| Component | New files | Deps to add |
|-----------|-----------|-------------|
| Local form renderer | `local-form-renderer.ts` | `pdf-lib`, `qrcode` |
| Phone scan page (frontend) | `phone-scan-page.tsx` | none (uses native camera API) |
| Scan processor (backend) | `scan-local/` (5 files) | `sharp`, `jsqr` |
| OmrClientService fallback | edit existing | none |

### Out of Scope

- Automated testing (deferred per user request)
- Personalized issued forms with pre-filled prisoner data (uses existing `OmrFormsService` flow)
- Scanner webhook integration (existing pipeline, unrelated)
- Authentication on the scan page (trusted LAN for MVP)
