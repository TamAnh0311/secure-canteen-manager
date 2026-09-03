// Deploy-timezone calendar date as YYYY-MM-DD. The app server-stamps every scan and
// order with this so a sheet ingested near midnight buckets to the correct local day.
//
// Intl en-CA formats as ISO-shaped YYYY-MM-DD and honours the timeZone option, so the
// rollover follows the deploy clock. A toISOString().slice(0,10) would format in UTC and
// mis-bucket every instant after 17:00Z (Saigon = UTC+7) onto the previous day — a wrong
// day debits prisoners against the wrong day's menu, so that shortcut is deliberately avoided.
//
// APP_TZ comes from the environment (default Asia/Saigon, set in env-validation). Read at call
// time rather than module load so a test or redeploy can change it without a stale capture.
export function todayInDeployTz(now: Date = new Date()): string {
  const tz = process.env.APP_TZ || 'Asia/Saigon';
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now);
}

// Next calendar day after todayInDeployTz(), as YYYY-MM-DD. Orders are stamped for the
// next collection day, so every order source uses this rather than today's date.
//
// Derive today's deploy-tz string first (so the day boundary already follows APP_TZ),
// then add one calendar day with pure UTC date arithmetic — Date.UTC rolls month and
// year, and the increment carries no timezone so DST can never shift it (Saigon has no
// DST regardless). The bare toISOString().slice(0,10) form is avoided for the same
// mis-bucketing reason documented above for todayInDeployTz.
export function tomorrowInDeployTz(now: Date = new Date()): string {
  const [y, m, d] = todayInDeployTz(now).split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
}
