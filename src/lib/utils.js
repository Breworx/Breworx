
export function downloadCSV(filename, headers, rows) {
  const escape = (v) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers.map(escape).join(","), ...rows.map((r) => r.map(escape).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function downloadJSON(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Local calendar date, not UTC — .toISOString() always returns the UTC
// date, which for anyone east of Greenwich (NZ included) shows yesterday's
// date for a large chunk of every day. This uses the browser's own local
// time, which is already correct automatically — no timezone setting needed.
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// Readings are read as "first = OG, last = latest", so a backdated entry must
// slot into date order rather than land at the end. Stable for same-day ones.
export const withStageDate = (batch, stage, date) => ({ ...(batch.stageDates || {}), [stage]: date || today() });

export const insertByDate = (list, item) => {
  const withIdx = [...(list || []), item].map((r, i) => ({ r, i }));
  withIdx.sort((a, b) => ((a.r.date || "").slice(0, 10) < (b.r.date || "").slice(0, 10) ? -1 : (a.r.date || "").slice(0, 10) > (b.r.date || "").slice(0, 10) ? 1 : a.i - b.i));
  return withIdx.map((x) => x.r);
};

export const daysBetween = (a, b) => Math.max(0, Math.round((new Date(b) - new Date(a)) / 86400000));
// Stays in local time the whole way through — parsing as local, adding
// days as local, and extracting local components at the end. The old
// version round-tripped through .toISOString() (UTC) on the way out,
// which shifted the result back a day for anyone east of Greenwich.
export const addDays = (dateStr, n) => {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + n);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

// Scrolls a just-focused field into view after a short delay — long enough
// for the iOS on-screen keyboard to finish sliding up, so the field doesn't
// end up hidden behind it inside a scrollable modal.
export const scrollFieldIntoView = (e) => {
  const el = e.target;
  setTimeout(() => {
    el.scrollIntoView({ block: "center", behavior: "smooth" });
  }, 300);
};
