import { CELL_NORMALIZATION_VERSION, normalizeCell, normalizeCellV1 } from '../cell-normalization';

describe('cell normalization', () => {
  it.each([
    [null, null],
    ['', null],
    ['   ', null],
    ['A-01', 'A01'],
    [' a / 01 ', 'A01'],
    ['Ａ－０１', 'A01'],
    ['buồng-đ.2', 'BUỒNGĐ2'],
  ])('normalizes %p to %p', (raw, expected) => {
    expect(normalizeCellV1(raw)).toBe(expected);
  });

  it('returns the frozen algorithm version with every normalized value', () => {
    expect(normalizeCell('A-01')).toEqual({ value: 'A01', version: CELL_NORMALIZATION_VERSION });
  });
});
