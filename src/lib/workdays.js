// NZ working days: weekdays that aren't national public holidays (with
// Mondayisation). Regional anniversary days aren't counted, so a due date
// worked out here is never later than the real one.
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const utc = (y, m, d) => new Date(Date.UTC(y, m - 1, d));
const plus = (d, n) => new Date(d.getTime() + n * 86400000);

function easterSunday(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return utc(y, month, day);
}
const nthMonday = (y, m, n) => { const d = utc(y, m, 1); const first = plus(d, (8 - d.getUTCDay()) % 7); return plus(first, 7 * (n - 1)); };
const mondayise = (d) => (d.getUTCDay() === 6 ? plus(d, 2) : d.getUTCDay() === 0 ? plus(d, 1) : d);
const MATARIKI = { 2024: "2024-06-28", 2025: "2025-06-20", 2026: "2026-07-10", 2027: "2027-06-25", 2028: "2028-07-14", 2029: "2029-07-06", 2030: "2030-06-21", 2031: "2031-07-11", 2032: "2032-07-02" };

const cache = {};
export function nzHolidays(y) {
  if (cache[y]) return cache[y];
  const s = new Set();
  // New Year: 1 and 2 Jan, pushed to the next weekdays if on a weekend.
  const j1 = utc(y, 1, 1), j2 = utc(y, 1, 2);
  if (j1.getUTCDay() === 6) { s.add(ymd(utc(y, 1, 3))); s.add(ymd(utc(y, 1, 4))); }
  else if (j1.getUTCDay() === 0) { s.add(ymd(j2)); s.add(ymd(utc(y, 1, 3))); }
  else if (j1.getUTCDay() === 5) { s.add(ymd(j1)); s.add(ymd(utc(y, 1, 4))); }
  else { s.add(ymd(j1)); s.add(ymd(j2)); }
  s.add(ymd(mondayise(utc(y, 2, 6)))); // Waitangi Day
  const easter = easterSunday(y);
  s.add(ymd(plus(easter, -2))); s.add(ymd(plus(easter, 1)));
  s.add(ymd(mondayise(utc(y, 4, 25)))); // Anzac Day
  s.add(ymd(nthMonday(y, 6, 1))); // King's Birthday
  if (MATARIKI[y]) s.add(MATARIKI[y]);
  s.add(ymd(nthMonday(y, 10, 4))); // Labour Day
  // Christmas and Boxing Day, Mondayised as a pair.
  const c = utc(y, 12, 25);
  if (c.getUTCDay() === 6) { s.add(ymd(utc(y, 12, 27))); s.add(ymd(utc(y, 12, 28))); }
  else if (c.getUTCDay() === 0) { s.add(ymd(utc(y, 12, 26))); s.add(ymd(utc(y, 12, 27))); }
  else if (c.getUTCDay() === 5) { s.add(ymd(c)); s.add(ymd(utc(y, 12, 28))); }
  else { s.add(ymd(c)); s.add(ymd(utc(y, 12, 26))); }
  return (cache[y] = s);
}

export function isWorkingDay(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = utc(y, m, d);
  const dow = dt.getUTCDay();
  return dow !== 0 && dow !== 6 && !nzHolidays(y).has(dateStr);
}

// The nth working day counting from (and including) dateStr.
export function nthWorkingDayFrom(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  let dt = utc(y, m, d), count = 0;
  for (let i = 0; i < 400; i++) {
    const s = ymd(dt);
    if (isWorkingDay(s)) { count += 1; if (count === n) return s; }
    dt = plus(dt, 1);
  }
  return ymd(dt);
}

// Working days left from today up to and including the due date.
export function workingDaysUntil(fromStr, toStr) {
  if (toStr < fromStr) return 0;
  const [y, m, d] = fromStr.split("-").map(Number);
  let dt = utc(y, m, d), n = 0;
  for (let i = 0; i < 400; i++) {
    const s = ymd(dt);
    if (s > toStr) break;
    if (isWorkingDay(s)) n += 1;
    dt = plus(dt, 1);
  }
  return n;
}
