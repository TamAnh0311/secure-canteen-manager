import { meanIntensityInCircle } from './image-processor';

/** A confirmed order line extracted from a scanned bubble sheet. */
export interface OrderLineDetection {
  menu_item_id: string;
  code_snapshot: string;
  quantity: number;
  confidence: 'high' | 'low';
}

/** Per-bubble descriptor from the form layout. */
interface BubbleDescriptor {
  row_index: number;
  menu_item_id: string;
  quantity: number;
  cx: number;
  cy: number;
  r: number;
}

/** Classification of a single bubble. */
type BubbleState = 'ticked' | 'empty' | 'ambiguous';

/**
 * Classifies a single bubble by its mean fill intensity.
 *
 * @param intensity   Mean pixel intensity (0.0 = black, 1.0 = white).
 * @param emptyMax    Threshold below which a bubble is considered empty.
 * @param tickedMin   Threshold above which a bubble is considered ticked.
 * @returns 'ticked', 'empty', or 'ambiguous'.
 */
function classifyBubble(
  intensity: number,
  emptyMax: number,
  tickedMin: number,
): BubbleState {
  // Inverted: low intensity = dark = ticked
  const fill = 1.0 - intensity;
  if (fill >= tickedMin) return 'ticked';
  if (fill <= emptyMax) return 'empty';
  return 'ambiguous';
}

/**
 * Reads bubble fill states from a grayscale image and resolves order line detections.
 *
 * For each distinct row (menu item), all bubbles are evaluated. The bubble with the
 * highest quantity whose state is 'ticked' wins that row. If only ambiguous fills are
 * found for a row, the highest-quantity ambiguous bubble is selected with 'low' confidence.
 * Rows where all bubbles are 'empty' are omitted from the result.
 *
 * @param grayscale   Grayscale image buffer (1 byte per pixel).
 * @param width       Image width in pixels.
 * @param bubbles     Bubble descriptors from the form layout, sorted by quantity.
 * @param pxPerPt     Pixels per PDF point (used to scale radii if needed; coords are already in pixels).
 * @param thresholds  OMR fill thresholds.
 * @returns Detected order lines and any diagnostic warnings.
 */
export function readFullListBubbles(
  grayscale: Buffer,
  width: number,
  bubbles: Array<BubbleDescriptor>,
  pxPerPt: number,
  thresholds: { omrEmptyMax: number; omrTickedMin: number },
): { detections: OrderLineDetection[]; warnings: string[] } {
  const warnings: string[] = [];
  const detections: OrderLineDetection[] = [];

  // Group bubbles by row_index to process each menu-item row independently.
  const rowMap = new Map<number, BubbleDescriptor[]>();
  for (const bubble of bubbles) {
    const group = rowMap.get(bubble.row_index) ?? [];
    group.push(bubble);
    rowMap.set(bubble.row_index, group);
  }

  for (const [rowIndex, rowBubbles] of rowMap) {
    // Evaluate every bubble in the row.
    const evaluated: Array<{ bubble: BubbleDescriptor; state: BubbleState }> = rowBubbles.map(
      (bubble) => {
        const intensity = meanIntensityInCircle(grayscale, width, bubble.cx, bubble.cy, bubble.r * pxPerPt);
        return { bubble, state: classifyBubble(intensity, thresholds.omrEmptyMax, thresholds.omrTickedMin) };
      },
    );

    const ticked = evaluated.filter((e) => e.state === 'ticked');
    const ambiguous = evaluated.filter((e) => e.state === 'ambiguous');

    if (ticked.length > 1) {
      warnings.push(
        `Row ${rowIndex}: multiple ticked bubbles detected (quantities: ${ticked.map((e) => e.bubble.quantity).join(', ')}); highest quantity selected`,
      );
    }

    let chosen: { bubble: BubbleDescriptor; confidence: 'high' | 'low' } | null = null;

    if (ticked.length >= 1) {
      // Pick highest quantity among ticked bubbles.
      const best = ticked.reduce((a, b) =>
        a.bubble.quantity >= b.bubble.quantity ? a : b,
      );
      chosen = { bubble: best.bubble, confidence: 'high' };
    } else if (ambiguous.length >= 1) {
      // No clearly ticked — fall back to highest-quantity ambiguous.
      const best = ambiguous.reduce((a, b) =>
        a.bubble.quantity >= b.bubble.quantity ? a : b,
      );
      chosen = { bubble: best.bubble, confidence: 'low' };
      warnings.push(
        `Row ${rowIndex}: ambiguous bubble fill for item ${best.bubble.menu_item_id} (quantity ${best.bubble.quantity})`,
      );
    }
    // All-empty rows are silently skipped.

    if (chosen) {
      detections.push({
        menu_item_id: chosen.bubble.menu_item_id,
        code_snapshot: '', // Populated by the service once enriched with menu data.
        quantity: chosen.bubble.quantity,
        confidence: chosen.confidence,
      });
    }
  }

  return { detections, warnings };
}
