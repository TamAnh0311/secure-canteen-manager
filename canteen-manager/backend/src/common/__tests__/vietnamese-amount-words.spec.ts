import { toVietnameseAmountWords } from '../vietnamese-amount-words';

describe('toVietnameseAmountWords', () => {
  it.each([
    [0, 'không đồng'],
    [5, 'năm đồng'],
    [10, 'mười đồng'],
    [15, 'mười lăm đồng'],
    [21, 'hai mươi mốt đồng'],
    [24, 'hai mươi tư đồng'],
    [105, 'một trăm lẻ năm đồng'],
    [115, 'một trăm mười lăm đồng'],
    [999, 'chín trăm chín mươi chín đồng'],
    [1_000, 'một nghìn đồng'],
    [1_005, 'một nghìn không trăm lẻ năm đồng'],
    [1_010, 'một nghìn không trăm mười đồng'],
    [999_999, 'chín trăm chín mươi chín nghìn chín trăm chín mươi chín đồng'],
    [1_000_000, 'một triệu đồng'],
    [1_000_000_001, 'một tỷ không trăm lẻ một đồng'],
    [1_000_000_000_000, 'một nghìn tỷ đồng'],
    [12_345_678_901, 'mười hai tỷ ba trăm bốn mươi lăm triệu sáu trăm bảy mươi tám nghìn chín trăm lẻ một đồng'],
  ])('renders %i deterministically', (amount, expected) => {
    expect(toVietnameseAmountWords(amount)).toBe(expected);
  });

  it('supports the largest safe integer VND amount', () => {
    expect(toVietnameseAmountWords(Number.MAX_SAFE_INTEGER)).toMatch(/ đồng$/);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects unsupported amount %s',
    (amount) => {
      expect(() => toVietnameseAmountWords(amount)).toThrow(RangeError);
    },
  );
});
