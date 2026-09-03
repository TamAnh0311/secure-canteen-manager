import { confirmationCode } from '../orders/order-confirmation-code';
import { asciiFold } from '../common/ascii-fold';

// VietQR additional-data memos are kept short so they survive every bank app's content field.
const MEMO_MAX = 25;

// Build the transfer memo for a bank kiosk order. Keys on the order's 8-char confirmation code
// (fixed width, reserved first) as a BONUS eyeball cross-check — the cashier's load-bearing
// match is amount + name, never the memo (a Vietnamese bank app is not assumed to surface it).
// The ascii-folded prisoner name is appended only if it fits the remaining budget; an empty fold
// (rare legacy data) falls back to code-only so the memo is never just whitespace.
export function bankMemo(orderId: string, prisonerName: string): string {
  const code = confirmationCode(orderId);
  const foldedName = asciiFold(prisonerName);
  const remaining = MEMO_MAX - code.length - 1; // -1 for the separating space
  if (!foldedName || remaining <= 0) return code;
  const namePart = foldedName.slice(0, remaining).trim();
  return namePart ? `${code} ${namePart}` : code;
}
