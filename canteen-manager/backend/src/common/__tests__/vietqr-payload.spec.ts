import { buildVietQrPayload, crc16Ccitt } from '../vietqr-payload';

// Independent CRC oracle: the published check value for CRC-16/CCITT-FALSE (poly 0x1021,
// init 0xFFFF, no reflection, no final XOR) over the ASCII string "123456789" is 0x29B1.
// This validates the hand-rolled CRC engine against an external constant — NOT against the
// encoder's own output — so a CRC regression cannot hide behind a self-generated golden.
describe('crc16Ccitt', () => {
  it('matches the canonical CRC-16/CCITT-FALSE check value for "123456789"', () => {
    expect(crc16Ccitt('123456789')).toBe('29B1');
  });

  it('left-pads the checksum to 4 upper-hex chars', () => {
    expect(crc16Ccitt('123456789')).toMatch(/^[0-9A-F]{4}$/);
  });
});

describe('buildVietQrPayload', () => {
  const account = { bankBin: '970436', accountNumber: '1234567890' };

  it('buildsDynamicPayloadWithAmountAndMemo', () => {
    const payload = buildVietQrPayload(account, 50000, 'CANTEEN A1B2C3D4');

    expect(payload.startsWith('000201')).toBe(true); // payload format indicator 00=01
    expect(payload).toContain('010212'); // 01=12 dynamic (one-time, amount present)
    expect(payload).toContain('A000000727'); // NAPAS GUID under field 38→00
    expect(payload).toContain('0006970436'); // acquirer BIN nested 01→00
    expect(payload).toContain('01101234567890'); // account number nested 01→01
    expect(payload).toContain('0208QRIBFTTA'); // service code field 38→02
    expect(payload).toContain('5303704'); // currency 53=704 (VND)
    expect(payload).toContain('540550000'); // amount 54=50000
    expect(payload).toContain('5802VN'); // country 58=VN
    expect(payload).toContain('0816CANTEEN A1B2C3D4'); // memo under 62→08
  });

  // CRC round-trip: recomputing the checksum over everything but the trailing 4 chars must
  // reproduce them. Independent of the canonical-vector test above (exercises the assembled
  // VietQR string, not "123456789").
  it('appends a CRC that round-trips over the preceding payload', () => {
    const payload = buildVietQrPayload(account, 50000, 'CANTEEN A1B2C3D4');
    expect(crc16Ccitt(payload.slice(0, -4))).toBe(payload.slice(-4));
  });

  // Regression pin (provenance: this encoder; the CRC engine is independently validated above
  // and the end-to-end real-bank-app scan is the owner-gated oracle). Guards against silent
  // field-ordering / length regressions.
  it('is byte-stable for a fixed input', () => {
    expect(buildVietQrPayload(account, 50000, 'CANTEEN A1B2C3D4')).toBe(
      '00020101021238540010A00000072701240006970436011012345678900208QRIBFTTA53037045405500005802VN62200816CANTEEN A1B2C3D46304EF8D',
    );
  });

  // TLV LEN is measured on the FINAL value string; a budget-length memo must report its own
  // length verbatim under field 08 — no off-by-one between LEN and value.
  it('emits a memo LEN equal to the memo length', () => {
    const memo = 'A1B2C3D4 NGUYEN VAN A'; // 21 chars
    const payload = buildVietQrPayload(account, 12000, memo);
    expect(payload).toContain('08' + String(memo.length).padStart(2, '0') + memo);
  });

  it('preserves single spaces inside the memo', () => {
    const payload = buildVietQrPayload(account, 12000, 'A1B2C3D4 NAME');
    expect(payload).toContain('0813A1B2C3D4 NAME');
  });

  it('rejects a zero or negative amount', () => {
    expect(() => buildVietQrPayload(account, 0, 'X')).toThrow();
    expect(() => buildVietQrPayload(account, -1, 'X')).toThrow();
  });

  it('rejects a non-integer amount', () => {
    expect(() => buildVietQrPayload(account, 100.5, 'X')).toThrow();
  });

  it('rejects a memo containing non-ascii-folded characters', () => {
    expect(() => buildVietQrPayload(account, 12000, 'Nguyễn')).toThrow();
    expect(() => buildVietQrPayload(account, 12000, 'name')).toThrow(); // lowercase not folded
  });

  it('rejects a malformed bank BIN or account number', () => {
    expect(() => buildVietQrPayload({ bankBin: '12345', accountNumber: '1234567890' }, 1000, 'X')).toThrow();
    expect(() => buildVietQrPayload({ bankBin: '970436', accountNumber: '123' }, 1000, 'X')).toThrow();
  });
});
