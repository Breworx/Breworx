import { calcABV } from "./brewing";
import { latestReading } from "./config";
import { CONTAINERS, packagedVolume, packagingEvents } from "./production";

// NZ Customs alcohol excise duty rates, effective 1 July 2026 (the annual
// CPI-indexed adjustment). Source: customs.govt.nz "New excise duty rates
// for alcohol from 1 July 2026". Two different calculation bases apply
// depending on strength — most craft beer (2.5–6% ABV) is charged per
// litre of pure alcohol, not per litre of beverage.
// For excise item classification — different product types get different
// item numbers on a real Customs declaration, on top of just the ABV band.
export const PRODUCT_TYPES = ["Beer", "Cider/Perry", "Wine", "Spirits", "RTD/Mixed drink", "Other"];

export const NZ_EXCISE_BANDS = [
  { min: 0, max: 1.15, rate: 0, basis: "exempt" },
  { min: 1.15, max: 2.5, rate: 0.58492, basis: "beverage" },
  { min: 2.5, max: 6, rate: 38.999, basis: "alcohol" },
  { min: 6, max: 9, rate: 3.1199, basis: "beverage" },
  { min: 9, max: 14, rate: 3.8999, basis: "beverage" },
  { min: 14, max: 23, rate: 71.034, basis: "alcohol" },
  { min: 23, max: Infinity, rate: 71.034, basis: "alcohol" },
];

// The 2.5–6% beer rate (per litre of alcohol) changes every 1 July, so
// each packaging date is charged at the rate in force on that day.
export const BEER_LAL_RATE_HISTORY = [
  { from: "2026-07-01", rate: 38.999 },
  { from: "2025-07-01", rate: 37.836 },
  { from: "2024-07-01", rate: 36.905 },
  { from: "0000-01-01", rate: 35.4505 },
];
export function exciseRateOn(band, date) {
  if (band.basis === "alcohol" && band.min === 2.5 && date) {
    return (BEER_LAL_RATE_HISTORY.find((r) => String(date) >= r.from) || BEER_LAL_RATE_HISTORY[0]).rate;
  }
  return band.rate;
}

export function exciseBandForAbv(abv) {
  return NZ_EXCISE_BANDS.find((b) => abv > b.min && abv <= b.max) || NZ_EXCISE_BANDS[0];
}

// Pae Ora (Healthy Futures) Alcohol Levy, in dollars per litre of beverage,
// by strength class, from Customs' published notices. It changes every
// 1 July. It applies to every product type, charged by strength class.
// Checked against a real TSW entry: 273.360L @ 6% in June 2026 →
// 273.360 × 0.024471 = $6.69. Excise duty itself doesn't attract GST;
// only the levy does, at 15%.
export const LEVY_CLASSES = [
  { min: 1.15, max: 2.5, cls: "A" },
  { min: 2.5, max: 6, cls: "B" },
  { min: 6, max: 9, cls: "C" },
  { min: 9, max: 14, cls: "D" },
  { min: 14, max: 23, cls: "E" },
  { min: 23, max: Infinity, cls: "F" },
];
export const LEVY_RATE_HISTORY = [
  { from: "2026-07-01", A: 0.008625, B: 0.02657, C: 0.046003, D: 0.057503, E: 0.095947, F: 0.218047 },
  { from: "2025-07-01", A: 0.00789, B: 0.024471, C: 0.042078, D: 0.052597, E: 0.093323, F: 0.202587 },
  { from: "2024-07-01", A: 0.00745, B: 0.023476, C: 0.039732, D: 0.049665, E: 0.086657, F: 0.185936 },
  { from: "0000-01-01", A: 0.005056, B: 0.015665, C: 0.026967, D: 0.033708, E: 0.056214, F: 0.127345 },
];
export const GST_RATE = 0.15;
export function levyRateOn(abv, date) {
  const c = LEVY_CLASSES.find((b) => abv > b.min && abv <= b.max);
  if (!c) return 0;
  const year = LEVY_RATE_HISTORY.find((r) => String(date || "9999") >= r.from) || LEVY_RATE_HISTORY[0];
  return year[c.cls];
}
export const round2 = (n) => Math.round((n || 0) * 100) / 100;
// Levy and GST for one TSW line: worked out on the line's litres, then GST on that levy.
export function lineLevy(litres, abv, date) {
  const levy = round2(litres * levyRateOn(abv, date));
  return { levy, levyGst: round2(levy * GST_RATE) };
}
// Levy and GST for a whole month's declared lines (a saved return).
export function levyForDeclaredLines(lines, period) {
  let levy = 0;
  let levyGst = 0;
  (lines || []).forEach((l) => {
    if (l.litres == null || l.abv == null) return;
    const x = lineLevy(Number(l.litres), Number(l.abv), `${period}-01`);
    levy += x.levy;
    levyGst += x.levyGst;
  });
  return { levy: round2(levy), levyGst: round2(levyGst) };
}
// What a saved return actually cost: duty + levy + GST on the levy.
export function returnPayable(ret) {
  if (!ret || ret.declaredDuty == null) return null;
  const duty = Number(ret.declaredDuty);
  const levy = ret.declaredLevy != null ? Number(ret.declaredLevy) : null;
  const levyGst = ret.declaredLevyGst != null ? Number(ret.declaredLevyGst) : null;
  return { duty, levy, levyGst, total: round2(duty + (levy || 0) + (levyGst || 0)) };
}
export const payableText = (p) =>
  p ? `Duty $${p.duty.toFixed(2)}${p.levy != null ? ` · Levy $${p.levy.toFixed(2)} · GST on levy $${(p.levyGst || 0).toFixed(2)} · Total $${p.total.toFixed(2)}` : ""}` : "";

// One row per packaging event, since excise is calculated on what actually
// left the licensed area on a given date — a batch packaged across several
// sessions can straddle two different reporting periods.
export function exciseRowsForBatches(batches, abvMethod) {
  const rows = [];
  batches.forEach((b) => {
    if (b.mergedIntoBatchId) return;
    const latest = b.og ? latestReading(b) : null;
    const measured = b.og && latest && latest.gravity != null ? calcABV(b.og, latest.gravity) : null;
    const measuredAbv = measured != null && measured > 0 ? measured : null;
    // Label strength is a genuine Customs-recognised method for smaller
    // beer producers (≤2 million L/year, with conditions) — falls back to
    // measured and flags it if no label ABV has been recorded for a batch.
    // eligibleForLabel tracks whether label mode even applies to this
    // product (beer only) — separate from usedLabel, which tracks whether
    // a real label value was actually available and used, so a non-beer
    // row can never be mistaken for "used label" just because it wasn't
    // a fallback either.
    const eligibleForLabel = abvMethod === "label" && (b.productType || "Beer") === "Beer";
    const usedLabel = eligibleForLabel && !!b.labelAbv;
    const usedFallback = eligibleForLabel && !b.labelAbv;
    const abv = usedLabel ? Number(b.labelAbv) : measuredAbv;
    // No label strength and no gravity to measure from — left out here and
    // flagged by the self-audit instead.
    if (abv == null || abv <= 0) return;
    const band = exciseBandForAbv(abv);
    packagingEvents(b).forEach((e) => {
      const volumeL = packagedVolume(e);
      if (volumeL <= 0) return;
      const rate = exciseRateOn(band, e.date);
      const duty = band.basis === "alcohol" ? volumeL * (abv / 100) * rate : band.basis === "beverage" ? volumeL * rate : 0;
      const { levy, levyGst } = lineLevy(volumeL, abv, e.date);
      rows.push({ batchId: b.id, batchName: b.name, batchNumber: b.number, productType: b.productType || "Beer", date: e.date, event: e, abv, measuredAbv, labelAbv: b.labelAbv, usedLabel, usedFallback, volumeL, band, duty, levy, levyGst });
    });
  });
  return rows.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
}

// ─── Excise self-audit ──────────────────────────────────────────────────────
// Duty here is declared at packaging (that's how this brewery files), so
// each month's TSW return should match what was packaged that month. The
// check compares litres and litres of alcohol (LAL), never dollars — duty
// rates change every 1 July, so a dollar comparison against today's rates
// would flag every month filed under an older rate.

// TSW truncates LAL to 3 decimals rather than rounding (confirmed against
// a real entry), so the expected figure has to be built the same way.
// The tiny nudge stops floating-point error (4.6079999…) cutting a whole 0.001 off.
export const exciseLal = (volumeL, abv) => Math.floor(volumeL * (abv / 100) * 1000 + 1e-6) / 1000;
export const round3 = (n) => Math.round((n || 0) * 1000) / 1000;

export function addMonthsToKey(key, n) {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Customs' standard due date for a monthly excise return is the 20th of
// the following month — shown as a guide, since arrangements can differ.
export const exciseDueDate = (period) => `${addMonthsToKey(period, 1)}-20`;

// Differences this small are rounding, not a real discrepancy.
export const litresTolerance = (expected) => Math.max(1, Math.abs(expected) * 0.005);
export const lalTolerance = (expected) => Math.max(0.05, Math.abs(expected) * 0.005);

export function exciseAuditMonths({ batches, abvMethod, exciseReturns, exciseItemCodes, todayStr }) {
  const rows = exciseRowsForBatches(batches, abvMethod);
  const byMonth = {};
  const ensure = (k) => byMonth[k] || (byMonth[k] = { litres: 0, lal: 0, rows: [], noAbv: [] });
  let undated = 0;

  rows.forEach((r) => {
    const k = monthKeyFromDate(r.date);
    if (k === "unknown") { undated += 1; return; }
    const m = ensure(k);
    m.litres += r.volumeL;
    m.lal += exciseLal(r.volumeL, r.abv);
    m.rows.push(r);
  });

  // exciseRowsForBatches skips a batch entirely when it has no measured
  // ABV — that beer is still packaged and still owes duty, so it's the
  // single most important thing for the audit to surface.
  const counted = new Set(rows.map((r) => r.batchId));
  batches.forEach((b) => {
    if (counted.has(b.id)) return;
    packagingEvents(b).forEach((e) => {
      const v = packagedVolume(e);
      if (v <= 0) return;
      const k = monthKeyFromDate(e.date);
      if (k === "unknown") { undated += 1; return; }
      ensure(k).noAbv.push({ batchName: b.name, batchNumber: b.number, date: e.date, volumeL: v });
    });
  });

  const returnsByPeriod = {};
  exciseReturns.forEach((r) => (returnsByPeriod[r.period] = r));

  const keys = [...Object.keys(byMonth), ...Object.keys(returnsByPeriod)].sort();
  if (keys.length === 0) return { months: [], undated };
  const thisMonth = todayStr.slice(0, 7);
  const last = keys[keys.length - 1] > thisMonth ? keys[keys.length - 1] : thisMonth;
  const months = [];

  for (let k = keys[0]; k <= last; k = addMonthsToKey(k, 1)) {
    const m = byMonth[k] || { litres: 0, lal: 0, rows: [], noAbv: [] };
    const ret = returnsByPeriod[k] || null;
    const appLitres = round3(m.litres);
    const appLal = round3(m.lal);
    const due = exciseDueDate(k);
    const notDueYet = todayStr <= due;
    const issues = [];
    const red = (text) => issues.push({ level: "red", text });
    const amber = (text) => issues.push({ level: "amber", text });
    const hasActivity = appLitres > 0 || m.noAbv.length > 0;

    if (m.noAbv.length > 0) {
      const v = round3(m.noAbv.reduce((s, x) => s + x.volumeL, 0));
      red(`${v} L packaged with no ABV recorded (${m.noAbv.map((x) => x.batchName).join(", ")}) — log a final gravity so it's counted.`);
    }
    const fallbacks = [...new Set(m.rows.filter((r) => r.usedFallback).map((r) => r.batchName))];
    if (fallbacks.length > 0) amber(`No label ABV set for ${fallbacks.join(", ")} — measured ABV used instead.`);
    const types = [...new Set(m.rows.map((r) => r.productType))];
    const noCode = types.filter((t) => !exciseItemCodes.find((e) => e.productType === t)?.itemNumber);
    if (noCode.length > 0) amber(`No excise item number set for ${noCode.join(", ")}.`);

    let litresDiff = null;
    let lalDiff = null;
    let status;

    if (!ret) {
      if (!hasActivity) status = "nil";
      else if (notDueYet) status = "notdue";
      else {
        red("Beer was packaged this month but no return has been recorded here.");
        status = "missing";
      }
    } else {
      const explained = !!(ret.varianceExplanation || "").trim();
      if (ret.declaredLitres == null && ret.declaredLal == null) {
        amber("Return recorded, but no declared litres or LAL entered yet.");
      }
      if (ret.declaredLitres != null) {
        litresDiff = round3(ret.declaredLitres - appLitres);
        if (Math.abs(litresDiff) > litresTolerance(appLitres)) {
          const text = `Declared ${ret.declaredLitres} L but ${appLitres} L was packaged (${litresDiff > 0 ? "+" : ""}${litresDiff} L).`;
          explained ? amber(`${text} Explained.`) : red(text);
        }
      }
      if (ret.declaredLal != null) {
        lalDiff = round3(ret.declaredLal - appLal);
        if (Math.abs(lalDiff) > lalTolerance(appLal)) {
          const text = `Declared ${ret.declaredLal} LAL but records give ${appLal} LAL (${lalDiff > 0 ? "+" : ""}${lalDiff}).`;
          explained ? amber(`${text} Explained.`) : red(text);
        }
      }
      if ((ret.declaredLines || []).length > 0) {
        const offRows = exciseAbvComparison(m.rows, ret.declaredLines).filter((r) => r.off);
        if (offRows.length > 0) {
          const detail = offRows.slice(0, 3).map((r) => `${r.abv === "?" ? "unknown ABV" : `${r.abv}%`}: packaged ${Math.round(r.packedL)} L, declared ${Math.round(r.declaredL)} L`).join("; ");
          amber(`By strength — ${detail}${offRows.length > 3 ? `; and ${offRows.length - 3} more` : ""}.`);
        }
      }
      if (ret.appLitresAtFiling != null && Math.abs(ret.appLitresAtFiling - appLitres) > 0.01) {
        amber(`Packaging records for this month changed after the return was recorded (was ${ret.appLitresAtFiling} L, now ${appLitres} L).`);
      }
      // TSW's return screens don't show a lodgement date or entry number,
      // so their absence isn't flagged — only a known late filing is.
      if (ret.filedDate && ret.filedDate > due) amber(`Filed ${ret.filedDate}, after the usual due date of ${due}.`);
      if (!(ret.screenshotPaths || []).length) amber("No TSW screenshot attached as evidence.");
      status = issues.some((i) => i.level === "red") ? "attention" : issues.length > 0 ? "check" : "ok";
    }
    if (status === "nil" && issues.length > 0) status = "check";

    months.push({ period: k, appLitres, appLal, rows: m.rows, noAbv: m.noAbv, ret, litresDiff, lalDiff, due, issues, status });
  }
  return { months: months.reverse(), undated };
}

export const AUDIT_STATUS = {
  ok: { label: "Matches", color: "#3F7A28", bg: "#E4F0DA" },
  check: { label: "Check notes", color: "#8A6D0B", bg: "#FBF0CC" },
  attention: { label: "Needs attention", color: "#B5502F", bg: "#F8DDD3" },
  missing: { label: "No return", color: "#B5502F", bg: "#F8DDD3" },
  notdue: { label: "Not due yet", color: "#5C6B54", bg: "#EBE8D6" },
  nil: { label: "Nothing packaged", color: "#9BA88A", bg: "#F0EDE0" },
};

// Screenshots straight off an iPad are large PNGs. Shrinking to a sharp
// JPEG keeps them well inside the image limit for reading, makes uploads
// quick, and is still perfectly legible as stored evidence.
export function shrinkImageFile(file, maxSide = 2400) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob(
        (blob) => {
          if (!blob) return reject(new Error("Couldn't process that image."));
          const reader = new FileReader();
          reader.onload = () => resolve({ blob, base64: String(reader.result).split(",")[1], previewUrl: URL.createObjectURL(blob) });
          reader.onerror = () => reject(new Error("Couldn't read that image."));
          reader.readAsDataURL(blob);
        },
        "image/jpeg",
        0.88
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That file isn't an image this device can open.")); };
    img.src = url;
  });
}

// A TSW line doesn't always show all three figures. Any two of litres,
// LAL and ABV give the third: LAL = litres × ABV%, litres = LAL ÷ ABV%,
// ABV = LAL ÷ litres. Worked-out figures are flagged so the review
// screen can show which ones weren't read straight off the screenshot.
// LAL follows TSW's truncation; litres derived from a truncated LAL can be
// out by a fraction of a litre, which sits inside the matching tolerance.
export function completeTswLine(line) {
  const out = { ...line, derived: [] };
  const has = (v) => v != null && Number.isFinite(v) && v > 0;
  if (!has(out.lal) && has(out.litres) && has(out.abv)) {
    out.lal = exciseLal(out.litres, out.abv);
    out.derived.push("lal");
  }
  if (!has(out.litres) && has(out.lal) && has(out.abv)) {
    out.litres = round3(out.lal / (out.abv / 100));
    out.derived.push("litres");
  }
  if (!has(out.abv) && has(out.lal) && has(out.litres)) {
    out.abv = Math.round((out.lal / out.litres) * 100 * 100) / 100;
    out.derived.push("abv");
  }
  return out;
}

// Reads the images out of a .zip without any extra library — the zip's
// central directory lists every file, and deflated entries are unpacked
// with the browser's own DecompressionStream (Safari 16.4+, Chrome, Firefox).
// Folders, Mac "__MACOSX" metadata and non-image files are skipped.
export const ZIP_IMAGE_TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", heic: "image/heic", heif: "image/heif", webp: "image/webp", gif: "image/gif" };

export async function imagesFromZip(zipFile) {
  const buf = new Uint8Array(await zipFile.arrayBuffer());
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // End-of-central-directory record sits in the last 64 KB of the file.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error(`${zipFile.name} isn't a zip file this can open.`);
  const count = view.getUint16(eocd + 10, true);
  let ptr = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  const out = [];
  for (let n = 0; n < count; n += 1) {
    if (view.getUint32(ptr, true) !== 0x02014b50) break;
    const method = view.getUint16(ptr + 10, true);
    const compSize = view.getUint32(ptr + 20, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const localOffset = view.getUint32(ptr + 42, true);
    const name = decoder.decode(buf.subarray(ptr + 46, ptr + 46 + nameLen));
    ptr += 46 + nameLen + extraLen + commentLen;

    const base = name.split("/").pop();
    const ext = (base.split(".").pop() || "").toLowerCase();
    if (name.endsWith("/") || name.startsWith("__MACOSX/") || base.startsWith(".") || !ZIP_IMAGE_TYPES[ext]) continue;

    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localNameLen + localExtraLen;
    const raw = buf.subarray(start, start + compSize);
    let data;
    if (method === 0) data = raw;
    else if (method === 8) {
      if (typeof DecompressionStream === "undefined") throw new Error("This device's browser can't unzip files — update iPadOS, or pick the screenshots directly.");
      const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      data = new Uint8Array(await new Response(stream).arrayBuffer());
    } else continue;
    const blob = new Blob([data], { type: ZIP_IMAGE_TYPES[ext] });
    blob.name = base;
    out.push(blob);
  }
  // Keep the zip's own name order, so screenshots named by month read in order.
  return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

export const isZipFile = (f) => /\.zip$/i.test(f.name || "") || f.type === "application/zip" || f.type === "application/x-zip-compressed";

// Two lines count as the same line only when every figure matches. The
// same line on two different screenshots is the overlap from scrolling
// (or the same page picked twice), so it's counted once; identical lines
// on one screenshot are genuinely separate entries and both stay.
export const sameTswLine = (a, b) =>
  String(a.itemCode || "") === String(b.itemCode || "") && a.litres === b.litres && a.lal === b.lal && (a.abv ?? null) === (b.abv ?? null);

export function mergeTswLines(base, extra) {
  const out = [...base];
  extra.forEach((l) => {
    if (!out.some((x) => x.source !== l.source && sameTswLine(x, l))) out.push(l);
  });
  return out;
}

export function tswTotals(lines) {
  const sum = (k, dp) => (lines.some((l) => l[k] != null) ? Math.round(lines.reduce((acc, l) => acc + (l[k] || 0), 0) * 10 ** dp) / 10 ** dp : null);
  return { litres: sum("litres", 3), lal: sum("lal", 3), duty: sum("duty", 2) };
}

// One TSW return often runs over two or three screens, and only the first
// usually shows the month. Screenshots are matched to a return by entry
// number first, then by month, and a page with neither is treated as the
// next page of the screenshot before it.
export function groupScreenshotReadings(readings) {
  const norm = (v) => String(v || "").replace(/\s/g, "").toUpperCase();
  const groups = [];
  let prev = null;
  readings.forEach((r, idx) => {
    let g = null;
    if (r.entryNumber) g = groups.find((x) => x.entryNumber && norm(x.entryNumber) === norm(r.entryNumber)) || null;
    if (!g && r.period) g = groups.find((x) => x.period === r.period) || null;
    if (!g && !r.period && prev) g = prev;
    if (!g) {
      g = { period: "", images: [], lines: [], entryNumber: "", filedDate: "", totalDuty: null, notes: [] };
      groups.push(g);
    }
    if (!g.period && r.period) g.period = r.period;
    g.images.push(r.image);
    g.lines = mergeTswLines(g.lines, (r.lines || []).map((l) => ({ ...completeTswLine(l), source: `img${idx}` })));
    if (!g.entryNumber && r.entryNumber) g.entryNumber = r.entryNumber;
    if (!g.filedDate && r.filedDate) g.filedDate = r.filedDate;
    // A grand total is usually on the last page — keep the latest one seen
    // rather than adding up the same total read off two pages.
    if (r.totalDuty != null) g.totalDuty = r.totalDuty;
    if (r.notes) g.notes.push(r.notes);
    prev = g;
  });
  return groups;
}

// Lines up what was packaged against what was declared, strength by
// strength. TSW lists each ABV as its own line, so this shows which beer
// a difference comes from — something the monthly totals can hide when
// an over and an under cancel out.
export function exciseAbvComparison(rows, declaredLines) {
  const key = (abv) => (abv == null || !Number.isFinite(abv) ? "?" : (Math.round(abv * 10) / 10).toFixed(1));
  const map = {};
  const get = (k) => map[k] || (map[k] = { abv: k, packedL: 0, packedLal: 0, beers: new Set(), declaredL: 0, declaredLal: 0, descriptions: new Set() });
  rows.forEach((r) => {
    const g = get(key(r.abv));
    g.packedL += r.volumeL;
    g.packedLal += exciseLal(r.volumeL, r.abv);
    g.beers.add(r.batchName);
  });
  (declaredLines || []).forEach((l) => {
    const g = get(key(l.abv));
    g.declaredL += l.litres || 0;
    g.declaredLal += l.lal || 0;
    if (l.description) g.descriptions.add(l.description);
  });
  return Object.values(map)
    .map((g) => {
      const packedL = round3(g.packedL);
      const declaredL = round3(g.declaredL);
      return {
        ...g,
        packedL,
        declaredL,
        packedLal: round3(g.packedLal),
        declaredLal: round3(g.declaredLal),
        beers: [...g.beers],
        descriptions: [...g.descriptions],
        diff: round3(declaredL - packedL),
        off: Math.abs(declaredL - packedL) > litresTolerance(packedL),
      };
    })
    .sort((a, b) => (a.abv === "?") - (b.abv === "?") || Number(a.abv) - Number(b.abv));
}

export function monthKeyFromDate(dateStr) {
  return dateStr && dateStr.length >= 7 ? dateStr.slice(0, 7) : "unknown";
}

export function monthLabelFromKey(key) {
  if (key === "unknown") return "Unknown date";
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

// Groups every packaging event across every batch by month, with a running
// volume/container total per month and a per-batch breakdown within it.
export function packagingByMonth(batches) {
  const groups = {};
  batches.forEach((b) => {
    packagingEvents(b).forEach((e) => {
      const key = monthKeyFromDate(e.date);
      if (!groups[key]) groups[key] = { volume: 0, counts: {}, batches: {} };
      const vol = packagedVolume(e);
      groups[key].volume = Math.round((groups[key].volume + vol) * 100) / 100;
      CONTAINERS.forEach((c) => {
        groups[key].counts[c.key] = (groups[key].counts[c.key] || 0) + (e[c.key] || 0);
      });
      if (!groups[key].batches[b.id]) groups[key].batches[b.id] = { id: b.id, name: b.name, number: b.number, volume: 0 };
      groups[key].batches[b.id].volume = Math.round((groups[key].batches[b.id].volume + vol) * 100) / 100;
    });
  });
  return Object.keys(groups)
    .sort()
    .reverse()
    .map((key) => ({ key, label: monthLabelFromKey(key), ...groups[key], batches: Object.values(groups[key].batches) }));
}
