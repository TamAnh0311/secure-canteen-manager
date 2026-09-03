import { todayInDeployTz, tomorrowInDeployTz } from '../today-in-tz';

// The deploy timezone is Asia/Saigon (UTC+7). Bucketing a scan/order to the wrong
// calendar day debits prisoners on the wrong day's menu, so the day boundary is
// money-critical. These cases pin the rollover to the local TZ, never UTC.
describe('todayInDeployTz', () => {
  const realNow = Date.now;

  afterEach(() => {
    Date.now = realNow;
    jest.useRealTimers();
  });

  function freezeAt(iso: string): void {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(iso));
  }

  it('returns a YYYY-MM-DD string', () => {
    freezeAt('2026-06-18T05:00:00.000Z');
    expect(todayInDeployTz()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('rolls to the next Saigon day once UTC passes 17:00 (07:00+ next local day)', () => {
    // 17:30Z on the 18th = 00:30 on the 19th in Saigon (UTC+7) → next day.
    freezeAt('2026-06-18T17:30:00.000Z');
    expect(todayInDeployTz()).toBe('2026-06-19');
  });

  it('stays on the same Saigon day just before the UTC rollover boundary', () => {
    // 16:30Z on the 18th = 23:30 on the 18th in Saigon → still the 18th.
    freezeAt('2026-06-18T16:30:00.000Z');
    expect(todayInDeployTz()).toBe('2026-06-18');
  });

  it('does not collapse to the UTC date the way toISOString would near midnight', () => {
    // A naive toISOString().slice(0,10) on this instant yields 2026-06-18 (UTC),
    // but the local Saigon calendar date is already the 19th.
    freezeAt('2026-06-18T23:00:00.000Z');
    expect(new Date().toISOString().slice(0, 10)).toBe('2026-06-18');
    expect(todayInDeployTz()).toBe('2026-06-19');
  });
});

// Orders are stamped for the NEXT collection day, so the day boundary is just as
// money-critical here: tomorrow must be the deploy-tz calendar day after today's,
// and the increment must survive month/year rollover (pure date arithmetic, no UTC drift).
describe('tomorrowInDeployTz', () => {
  const realNow = Date.now;

  afterEach(() => {
    Date.now = realNow;
    jest.useRealTimers();
  });

  function freezeAt(iso: string): void {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(iso));
  }

  it('returns a YYYY-MM-DD string', () => {
    freezeAt('2026-06-20T05:00:00.000Z');
    expect(tomorrowInDeployTz()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('is the deploy-tz day after today (mid-day, no boundary ambiguity)', () => {
    freezeAt('2026-06-20T05:00:00.000Z'); // 12:00 Saigon on the 20th
    expect(todayInDeployTz()).toBe('2026-06-20');
    expect(tomorrowInDeployTz()).toBe('2026-06-21');
  });

  it('rolls across a month boundary', () => {
    freezeAt('2026-06-30T05:00:00.000Z'); // 12:00 Saigon on the 30th
    expect(tomorrowInDeployTz()).toBe('2026-07-01');
  });

  it('rolls across a year boundary', () => {
    freezeAt('2026-12-31T05:00:00.000Z'); // 12:00 Saigon on Dec 31
    expect(tomorrowInDeployTz()).toBe('2027-01-01');
  });

  it('increments the LOCAL Saigon day near midnight, not the UTC day', () => {
    // 17:30Z on the 20th = 00:30 on the 21st in Saigon → today is the 21st, tomorrow the 22nd.
    freezeAt('2026-06-20T17:30:00.000Z');
    expect(todayInDeployTz()).toBe('2026-06-21');
    expect(tomorrowInDeployTz()).toBe('2026-06-22');
  });
});
