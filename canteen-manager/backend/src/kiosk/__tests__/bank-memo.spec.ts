import { bankMemo } from '../bank-memo';
import { confirmationCode } from '../../orders/order-confirmation-code';

// A real order id is a UUID; its first 8 chars are hex, so the confirmation code is always
// memo-safe ([A-Z0-9]). These fixtures mirror that shape.
const ORDER_ID = 'aabbccdd-1111-2222-3333-444455556666';
const CODE = confirmationCode(ORDER_ID); // 'AABBCCDD'

describe('bankMemo', () => {
  it('prefixes the 8-char confirmation code then the folded name', () => {
    const memo = bankMemo(ORDER_ID, 'Nguyễn Văn Á');
    expect(memo.startsWith(CODE)).toBe(true);
    expect(memo).toBe(`${CODE} NGUYEN VAN A`);
  });

  it('never exceeds the 25-char budget, truncating the name not the code', () => {
    const memo = bankMemo(ORDER_ID, 'Nguyen Van A Very Long Name Indeed');
    expect(memo.length).toBeLessThanOrEqual(25);
    expect(memo.startsWith(CODE)).toBe(true);
  });

  it('falls back to code-only when the name folds to empty', () => {
    expect(bankMemo(ORDER_ID, '„”—')).toBe(CODE);
  });

  it('falls back to code-only for a blank name', () => {
    expect(bankMemo(ORDER_ID, '')).toBe(CODE);
  });

  it('emits only the memo-safe charset [A-Z0-9 ]', () => {
    expect(/^[A-Z0-9 ]+$/.test(bankMemo(ORDER_ID, 'Trần Thị Bưởi'))).toBe(true);
  });
});
