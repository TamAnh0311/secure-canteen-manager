const DIGITS = [
  'không',
  'một',
  'hai',
  'ba',
  'bốn',
  'năm',
  'sáu',
  'bảy',
  'tám',
  'chín',
] as const;

const GROUP_SCALES = ['', 'nghìn', 'triệu', 'tỷ', 'nghìn tỷ', 'triệu tỷ'] as const;

function readUnits(units: number, tens: number): string {
  if (units === 1 && tens >= 2) return 'mốt';
  if (units === 4 && tens >= 2) return 'tư';
  if (units === 5 && tens >= 1) return 'lăm';
  return DIGITS[units];
}

function readThreeDigits(value: number, forceHundreds: boolean): string[] {
  const hundreds = Math.floor(value / 100);
  const tens = Math.floor((value % 100) / 10);
  const units = value % 10;
  const words: string[] = [];

  if (hundreds > 0 || forceHundreds) {
    words.push(DIGITS[hundreds], 'trăm');
  }

  if (tens >= 2) {
    words.push(DIGITS[tens], 'mươi');
  } else if (tens === 1) {
    words.push('mười');
  } else if (units > 0 && (hundreds > 0 || forceHundreds)) {
    words.push('lẻ');
  }

  if (units > 0) {
    words.push(readUnits(units, tens));
  }

  return words;
}

export function toVietnameseAmountWords(integerVnd: number): string {
  if (!Number.isSafeInteger(integerVnd) || integerVnd < 0) {
    throw new RangeError('VND amount must be a non-negative safe integer');
  }
  if (integerVnd === 0) return 'không đồng';

  const groups: number[] = [];
  let remainder = integerVnd;
  while (remainder > 0) {
    groups.push(remainder % 1000);
    remainder = Math.floor(remainder / 1000);
  }

  const words: string[] = [];
  let hasHigherGroup = false;
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index];
    if (group === 0) continue;

    words.push(...readThreeDigits(group, hasHigherGroup && group < 100));
    const scale = GROUP_SCALES[index];
    if (scale) words.push(scale);
    hasHigherGroup = true;
  }

  return `${words.join(' ')} đồng`;
}
