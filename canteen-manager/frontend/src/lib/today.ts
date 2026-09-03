// Calendar date as YYYY-MM-DD in the browser's local timezone, which on the
// on-prem deploy is the same wall clock the backend stamps service_date with.
//
// Intl en-CA formats as ISO-shaped YYYY-MM-DD and honours the local zone, so the
// day rollover follows the local clock. A toISOString().slice(0,10) would format
// in UTC and mis-bucket every instant after 17:00 local (Saigon = UTC+7) onto the
// previous day — a wrong day filters the wrong service_date bucket, so that
// shortcut is deliberately avoided here.
export function today(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

// Next calendar day after today() in the same local zone. Orders are stamped for the
// next collection day, so the collection-day dashboards default their range here.
// Increment via pure UTC date arithmetic (rolls month/year, immune to DST) on top of
// today()'s already-localised string, rather than adding 24h to a Date (which a DST
// jump could shift) — Saigon has no DST, but the calendar-string increment keeps this
// correct anywhere the bundle runs.
export function tomorrow(now: Date = new Date()): string {
  const [y, m, d] = today(now).split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
}
