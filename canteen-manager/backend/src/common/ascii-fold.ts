// Fold an arbitrary (often Vietnamese) string down to the ASCII subset a VietQR TLV value and
// a bank beneficiary name accept: strip diacritics, map the stroke-D, uppercase, keep only
// [A-Z0-9 ], collapse runs of whitespace, trim. Pure + offline.
//
// Vietnamese bank beneficiary names are themselves stored ASCII-uppercase without diacritics,
// so folding the configured account name to match is faithful, and it guarantees no multibyte
// char can ever desync a TLV LEN (a 1-char glyph occupying >1 byte) if the value is embedded.
export function asciiFold(input: string): string {
  return input
    .normalize('NFD') // split base letters from their combining diacritics
    .replace(/[\u0300-\u036f]/g, "") // drop the combining marks
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D') // stroke-D does not decompose under NFD
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ') // anything still non-ASCII (incl. control chars) → space
    .replace(/\s+/g, ' ')
    .trim();
}
