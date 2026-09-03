// EMVCo TLV builder for a NAPAS-247 dynamic VietQR (amount embedded). Pure + offline: the
// payment string is assembled deterministically with no network / CDN / runtime fetch, so the
// kiosk renders a transfer QR fully air-gapped. Only payment *verification* is manual (a human
// reads the bank app). Mirrors the pure-util shape of today-in-tz.ts.
//
// EMVCo Merchant-Presented Mode: every field = ID(2) + LEN(2, zero-padded) + VALUE; nested
// templates re-encode TLV inside their VALUE. The CRC is CRC-16/CCITT-FALSE over the whole
// string INCLUDING the literal "6304" tag+len, emitted as 4 upper-hex chars.

export interface BankAccount {
  bankBin: string;
  accountNumber: string;
}

// CRC-16/CCITT-FALSE: poly 0x1021, init 0xFFFF, no input/output reflection, no final XOR.
// Computed over the UTF-8 bytes so the checksum matches what a bank QR parser counts. The
// VietQR payload is ASCII-only (account = digits, memo ascii-folded upstream), where bytes ==
// chars; computing over bytes also keeps the function correct for any UTF-8 input.
export function crc16Ccitt(input: string): string {
  const bytes = Buffer.from(input, 'utf8');
  let crc = 0xffff;
  for (const b of bytes) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

// Encode one EMVCo TLV field. LEN is the length of the FINAL value string (after any upstream
// folding/truncation), 2 digits zero-padded — measured here so a LEN can never desync from the
// value the bank parser reads. Every VietQR field is well under the 2-digit (99) ceiling.
function tlv(id: string, value: string): string {
  const len = value.length;
  if (len > 99) {
    throw new Error(`TLV value too long for field ${id}: ${len} chars`);
  }
  return id + len.toString().padStart(2, '0') + value;
}

// Build the dynamic VietQR payload string for a single transfer to {bankBin, accountNumber}
// of amountVnd, with memo carried under additional-data field 62→08. Service code QRIBFTTA
// (transfer to account), currency 704 (VND), country VN, dynamic init method (one-time, amount
// present). Throws on any value that would desync a LEN or produce an unscannable string.
export function buildVietQrPayload(account: BankAccount, amountVnd: number, memo: string): string {
  if (!Number.isInteger(amountVnd) || amountVnd <= 0) {
    throw new Error('VietQR amount must be a positive integer VND');
  }
  if (!/^\d{6}$/.test(account.bankBin)) {
    throw new Error('bankBin must be 6 digits');
  }
  if (!/^\d{6,19}$/.test(account.accountNumber)) {
    throw new Error('accountNumber must be 6-19 digits');
  }
  // Only ascii-folded chars may reach a TLV value; a stray multibyte char would make a 1-char
  // string occupy >1 byte and desync the bank parser's LEN count.
  if (!/^[A-Z0-9 ]*$/.test(memo)) {
    throw new Error('memo must be ascii-folded [A-Z0-9 ] only');
  }

  // Field 38 — merchant account information (nested):
  //   00 = NAPAS GUID, 01 = nested(00=acquirer BIN, 01=account number), 02 = service code.
  const merchantAccount =
    tlv('00', 'A000000727') +
    tlv('01', tlv('00', account.bankBin) + tlv('01', account.accountNumber)) +
    tlv('02', 'QRIBFTTA');

  // Field 62 — additional data; 08 = purpose-of-transaction memo (bonus cross-check at counter).
  const additionalData = tlv('08', memo);

  const withoutCrc =
    tlv('00', '01') + // payload format indicator
    tlv('01', '12') + // dynamic (one-time, amount present)
    tlv('38', merchantAccount) +
    tlv('53', '704') + // currency VND
    tlv('54', String(amountVnd)) + // transaction amount
    tlv('58', 'VN') + // country
    tlv('62', additionalData);

  // CRC tag (63) + fixed len (04) are part of the CRC input; the 4 hex chars follow.
  const crc = crc16Ccitt(withoutCrc + '6304');
  return withoutCrc + '6304' + crc;
}
