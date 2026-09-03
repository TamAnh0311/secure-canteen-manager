import { normalizeZone } from '../zone-normalization';

describe('normalizeZone', () => {
  it.each([
    [null, null],
    [undefined, null],
    ['', null],
    ['   ', null],
    ['  Khu A1  ', 'Khu A1'],
    ['khu Á', 'khu Á'],
  ])('normalizes %p to %p', (input, expected) => {
    expect(normalizeZone(input)).toBe(expected);
  });
});
