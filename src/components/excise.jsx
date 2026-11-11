import { useState, useMemo, useRef, Suspense } from "react";
import { createPortal } from "react-dom";
import { X, AlertTriangle, FileText } from "lucide-react";
// Charts: recharts is imported directly. Lazy-loading each piece separately
// (as this used to) breaks recharts — a chart only draws children it
// recognises by type, so lazy-wrapped bars, lines and axes were skipped and
// every chart rendered as an empty frame.
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { productKeyForBatch, cleanProductName } from "../lib/brewPlanner";
import { downloadExciseReportPdf } from "../lib/excisePdf";
import { BackdateField, EmptyState, Modal, NumberField, SHEET_BACKDROP_STYLE, SHEET_PANEL_STYLE, TextField } from "./ui";
import { AUDIT_STATUS, PRODUCT_TYPES, addMonthsToKey, completeTswLine, exciseAbvComparison, exciseAuditMonths, exciseLal, exciseRateOn, exciseRowsForBatches, groupScreenshotReadings, imagesFromZip, isZipFile, lalTolerance, lineLevy, litresTolerance, mergeTswLines, monthKeyFromDate, monthLabelFromKey, packagingByMonth, payableText, returnPayable, round2, round3, shrinkImageFile, tswTotals } from "../lib/excise";
import { CANS_PER_CASE, CONTAINERS, aggregatePackagingCounts, packagingEvents, remainingVolume, totalPackagedVolume } from "../lib/production";
import { downloadCSV, today } from "../lib/utils";

export const auditLabelStyle = { fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A" };
export const auditTextareaStyle = { width: "100%", boxSizing: "border-box", background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 5, padding: "9px 10px", color: "#2A3324", fontFamily: "'Inter', sans-serif", fontSize: 14, resize: "vertical" };
export const auditPrimaryBtn = (enabled = true) => ({ background: enabled ? "#5C9A3C" : "#E8E4D4", border: "none", borderRadius: 5, padding: "12px", color: enabled ? "#16191A" : "#A3AC94", fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 15, cursor: enabled ? "pointer" : "default" });
export const auditSecondaryBtn = { background: "#EBE8D6", border: "1px solid #C9D1AC", borderRadius: 5, padding: "10px", color: "#2A3324", fontFamily: "'Inter', sans-serif", fontSize: 13, cursor: "pointer" };
// The audit shows figures the way they're declared on TSW — whole litres
// and LAL to one decimal — so packaged and declared read the same when
// they agree, instead of 159.8 L against 160 L from 330ml can rounding.
export const fmtL = (n) => (n == null ? "—" : `${Math.round(n).toLocaleString("en-NZ")} L`);
export const fmtLal = (n) => (n == null ? "—" : `${(Math.round(n * 10) / 10).toFixed(1)} LAL`);
export const fmtDiffL = (n) => `${n > 0 ? "+" : ""}${Math.round(n)} L`;
// Exact figures for checking a screenshot reading line by line.
export const fmtLExact = (n) => (n == null ? "—" : `${round3(n)} L`);
export const fmtLalExact = (n) => (n == null ? "—" : `${round3(n)} LAL`);

export function AuditStatusPill({ status }) {
  const s = AUDIT_STATUS[status] || AUDIT_STATUS.nil;
  return <span style={{ background: s.bg, color: s.color, borderRadius: 999, padding: "3px 9px", fontSize: 11.5, fontWeight: 600, whiteSpace: "nowrap" }}>{s.label}</span>;
}

// Side-by-side "what Brewpoint says" vs "what was declared".
export function AuditFigures({ appLitres, appLal, declaredLitres, declaredLal }) {
  const cell = (label, app, declared, fmt, tol) => {
    const off = declared != null && Math.abs(declared - app) > tol(app);
    return (
      <div style={{ background: "#F5F1E4", borderRadius: 5, padding: "8px 10px" }}>
        <div style={auditLabelStyle}>{label}</div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: "#2A3324", marginTop: 3 }}>Records: {fmt(app)}</div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: off ? "#B5502F" : "#2A3324" }}>Declared: {fmt(declared)}</div>
      </div>
    );
  };
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
      {cell("Litres", appLitres, declaredLitres, fmtL, litresTolerance)}
      {cell("Pure alcohol", appLal, declaredLal, fmtLal, lalTolerance)}
    </div>
  );
}

export function ExciseReturnModal({ month, onClose, onSave, onDelete }) {
  const r = month.ret || {};
  const s = (v) => (v == null ? "" : String(v));
  const [declaredLitres, setDeclaredLitres] = useState(s(r.declaredLitres));
  const [declaredLal, setDeclaredLal] = useState(s(r.declaredLal));
  const [declaredDuty, setDeclaredDuty] = useState(s(r.declaredDuty));
  const [declaredAbv, setDeclaredAbv] = useState("");
  const [entryNumber, setEntryNumber] = useState(r.entryNumber || "");
  const [filedDate, setFiledDate] = useState(r.filedDate || today());
  // Fill whichever of litres / LAL is blank from the other plus ABV.
  const worked = completeTswLine({ litres: declaredLitres === "" ? null : Number(declaredLitres), lal: declaredLal === "" ? null : Number(declaredLal), abv: declaredAbv === "" ? null : Number(declaredAbv) });
  const [varianceExplanation, setVarianceExplanation] = useState(r.varianceExplanation || "");
  const [notes, setNotes] = useState(r.notes || "");
  const [saving, setSaving] = useState(false);
  const canSave = !saving && (declaredLitres !== "" || declaredLal !== "");

  const submit = async () => {
    setSaving(true);
    await onSave({ ...r, period: month.period, declaredLitres: worked.litres ?? declaredLitres, declaredLal: worked.lal ?? declaredLal, declaredDuty, entryNumber: entryNumber.trim(), filedDate, varianceExplanation: varianceExplanation.trim(), notes: notes.trim() });
    setSaving(false);
    onClose();
  };

  return (
    <Modal title={`${month.ret ? "Edit" : "Record"} return — ${monthLabelFromKey(month.period)}`} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ color: "#5C6B54", fontSize: 12.5, lineHeight: 1.5 }}>
          Enter the figures exactly as they appear on the return you lodged in TSW — not Brewpoint's numbers. The point is to compare the two.
        </div>
        <div style={{ background: "#F5F1E4", borderRadius: 5, padding: "8px 10px", fontSize: 12.5, color: "#5C6B54" }}>
          Brewpoint's records for this month: <strong style={{ fontFamily: "'JetBrains Mono', monospace" }}>{fmtL(month.appLitres)} · {fmtLal(month.appLal)}</strong>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <NumberField label="Declared litres" value={declaredLitres} onChange={setDeclaredLitres} suffix="L" />
          <NumberField label="Declared LAL" value={declaredLal} onChange={setDeclaredLal} suffix="LAL" />
        </div>
        <NumberField label="ABV on the return (only if a figure above is missing)" value={declaredAbv} onChange={setDeclaredAbv} suffix="%" />
        {(worked.derived.includes("litres") || worked.derived.includes("lal")) && (
          <div style={{ fontSize: 12.5, color: "#8A6D0B", marginTop: -6 }}>
            {worked.derived.includes("litres") ? `Litres worked out as ${worked.litres} L (LAL ÷ ABV%).` : `LAL worked out as ${worked.lal} (litres × ABV%).`}
          </div>
        )}
        <NumberField label="Duty paid (optional)" value={declaredDuty} onChange={setDeclaredDuty} suffix="$" />
        <TextField label="TSW entry number" value={entryNumber} onChange={setEntryNumber} />
        <BackdateField label="Date filed" value={filedDate} onChange={setFiledDate} />
        <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B54" }}>Explanation for any difference</span>
          <textarea value={varianceExplanation} onChange={(e) => setVarianceExplanation(e.target.value)} rows={3} placeholder="e.g. 48 cans packaged 31st, declared on next month's return" style={auditTextareaStyle} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B54" }}>Notes (optional)</span>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} style={auditTextareaStyle} />
        </label>
        <button onClick={submit} disabled={!canSave} style={auditPrimaryBtn(canSave)}>{saving ? "Saving..." : "Save return"}</button>
        {month.ret && (
          <button
            onClick={async () => {
              if (!window.confirm(`Delete the recorded return for ${monthLabelFromKey(month.period)}? Its screenshots are deleted too.`)) return;
              await onDelete(month.ret);
              onClose();
            }}
            style={{ background: "none", border: "none", color: "#B5502F", fontSize: 13, cursor: "pointer", padding: 6 }}
          >
            Delete this return
          </button>
        )}
      </div>
    </Modal>
  );
}

// Review what was read off the screenshots before anything is saved —
// the reading can be wrong, so every figure stays editable and nothing
// lands in the audit without a person confirming it.
export function TswImportModal({ groups, monthsByPeriod, onClose, onSaveGroup }) {
  // Works out what saving this draft would put on the month: just these
  // pages, or — when the month already has a return and "add" is chosen —
  // these pages on top of what's saved, with any page imported twice
  // counted once.
  const withTotals = (d) => {
    const existing = d.period ? monthsByPeriod[d.period]?.ret : null;
    let lines = d.lines;
    let totals = tswTotals(d.lines);
    if (existing && d.mode === "evidence") {
      // Figures stay exactly as saved; only the screenshots are added.
      const r2 = (v) => (v == null ? "" : String(v));
      return { ...d, saveLines: existing.declaredLines || [], declaredLitres: r2(existing.declaredLitres), declaredLal: r2(existing.declaredLal), declaredDuty: r2(existing.declaredDuty) };
    }
    if (existing && d.mode === "add") {
      if ((existing.declaredLines || []).length > 0) {
        lines = mergeTswLines(existing.declaredLines.map((l) => ({ ...l, source: "saved" })), d.lines);
        totals = tswTotals(lines);
      } else {
        const plus = (a, b, dp) => (a == null && b == null ? null : Math.round(((a || 0) + (b || 0)) * 10 ** dp) / 10 ** dp);
        totals = { litres: plus(existing.declaredLitres, totals.litres, 3), lal: plus(existing.declaredLal, totals.lal, 3), duty: plus(existing.declaredDuty, totals.duty, 2) };
      }
    }
    const duty = totals.duty != null ? totals.duty : d.totalDuty != null ? Math.round(d.totalDuty * 100) / 100 : null;
    return {
      ...d,
      saveLines: lines,
      declaredLitres: totals.litres == null ? "" : String(totals.litres),
      declaredLal: totals.lal == null ? "" : String(totals.lal),
      declaredDuty: duty == null ? "" : String(duty),
    };
  };
  // A month that already has its return saved line by line just needs the
  // screenshots as evidence; one saved without lines gets these pages added.
  const defaultMode = (period) => {
    const ret = period ? monthsByPeriod[period]?.ret : null;
    if (!ret) return "replace";
    return (ret.declaredLines || []).length > 0 ? "evidence" : "add";
  };
  const [savingAll, setSavingAll] = useState(false);
  const draftCanSave = (d) => !d.saving && !d.saved && /^\d{4}-\d{2}$/.test(d.period) && (d.mode === "evidence" || d.declaredLitres !== "" || d.declaredLal !== "");
  const saveAll = async () => {
    setSavingAll(true);
    for (let i = 0; i < drafts.length; i += 1) {
      const d = drafts[i];
      if (!draftCanSave(d)) continue;
      update(i, { saving: true });
      const ok = await onSaveGroup(d, { quiet: true });
      update(i, { saving: false, saved: !!ok });
    }
    setSavingAll(false);
  };

  const [drafts, setDrafts] = useState(() =>
    groups.map((g) => withTotals({ ...g, mode: defaultMode(g.period), saved: false, saving: false }))
  );
  const update = (i, patch) => setDrafts((prev) => prev.map((d, j) => (j === i ? { ...d, ...patch } : d)));

  // Picking the same month on two cards means they're pages of one
  // return, so they become one card.
  const setPeriod = (i, period) =>
    setDrafts((prev) => {
      const target = period ? prev.findIndex((d, j) => j !== i && !d.saved && d.period === period) : -1;
      if (target < 0) return prev.map((d, j) => (j === i ? withTotals({ ...d, period, mode: defaultMode(period) }) : d));
      const a = prev[target];
      const b = prev[i];
      const merged = withTotals({
        ...a,
        images: [...a.images, ...b.images],
        lines: mergeTswLines(a.lines, b.lines),
        entryNumber: a.entryNumber || b.entryNumber,
        filedDate: a.filedDate || b.filedDate,
        totalDuty: b.totalDuty ?? a.totalDuty,
        notes: [...a.notes, ...b.notes],
      });
      return prev.map((d, j) => (j === target ? merged : d)).filter((_, j) => j !== i);
    });

  const periodOptions = useMemo(() => {
    const opts = [];
    let k = today().slice(0, 7);
    for (let n = 0; n < 48; n += 1) { opts.push(k); k = addMonthsToKey(k, -1); }
    return opts;
  }, []);

  return createPortal(
    // A full-screen sheet rather than a centred pop-up: a zip of a few
    // years' returns makes dozens of cards, and the save button has to stay
    // reachable on an iPad however far down the list you are.
    <>
    <div style={SHEET_BACKDROP_STYLE} />
    <div style={SHEET_PANEL_STYLE}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 18px", borderBottom: "1px solid #DDE0C8", flexShrink: 0 }}>
        <h2 style={{ fontFamily: "'Oswald', sans-serif", fontSize: 20, color: "#2A3324", margin: 0, fontWeight: 500 }}>Check what was read</h2>
        <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", color: "#5C6B54", cursor: "pointer", padding: 10 }}>
          <X size={20} />
        </button>
      </div>
      <div style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 640, margin: "0 auto", padding: "16px 18px 24px" }}>
        <div style={{ color: "#5C6B54", fontSize: 12.5, lineHeight: 1.5 }}>
          Pages of the same return are put together automatically. If one ends up on its own card, set its month to match the others and it joins them. Check every figure against the screenshots before saving.
        </div>
        {drafts.map((d, i) => {
          const month = d.period ? monthsByPeriod[d.period] : null;
          const existing = month?.ret;
          const canSave = !savingAll && draftCanSave(d);
          const comparison = month ? exciseAbvComparison(month.rows, d.saveLines) : [];
          return (
            <div key={`${d.period}-${i}`} style={{ border: "1px solid #DDE0C8", borderRadius: 7, padding: 12, background: "#FFFFFF", display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", gap: 6, overflowX: "auto" }}>
                {d.images.map((img, j) => (
                  <img key={j} src={img.previewUrl} alt={`TSW screenshot page ${j + 1}`} onClick={() => window.open(img.previewUrl, "_blank")} style={{ height: 90, borderRadius: 4, border: "1px solid #DDE0C8", cursor: "zoom-in" }} />
                ))}
              </div>
              <div style={{ fontSize: 11.5, color: "#9BA88A" }}>{d.images.length} screenshot{d.images.length === 1 ? "" : "s"} · {d.lines.length} line{d.lines.length === 1 ? "" : "s"} read</div>
              <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B54" }}>Return period</span>
                <select value={d.period} onChange={(e) => setPeriod(i, e.target.value)} style={{ background: "#F5F1E4", border: `1px solid ${d.period ? "#DDE0C8" : "#B5502F"}`, borderRadius: 4, padding: "9px 10px", fontSize: 14, color: "#2A3324" }}>
                  <option value="">Choose the month…</option>
                  {[...new Set([d.period, ...periodOptions].filter(Boolean))].map((k) => <option key={k} value={k}>{monthLabelFromKey(k)}</option>)}
                </select>
              </label>
              {d.lines.length > 0 && (
                <div style={{ fontSize: 12, color: "#5C6B54", background: "#F5F1E4", borderRadius: 5, padding: "8px 10px" }}>
                  {d.lines.map((l, j) => (
                    <div key={j} style={{ fontFamily: "'JetBrains Mono', monospace", padding: "2px 0" }}>
                      {l.description || l.itemCode || "Line"} — {fmtLExact(l.litres)}{l.derived?.includes("litres") ? "*" : ""} · {fmtLalExact(l.lal)}{l.derived?.includes("lal") ? "*" : ""}{l.abv != null ? ` · ${l.abv}%${l.derived?.includes("abv") ? "*" : ""}` : ""}
                    </div>
                  ))}
                  {d.lines.some((l) => l.derived?.length) && (
                    <div style={{ marginTop: 4, color: "#8A6D0B" }}>* Worked out from the other two figures (LAL = litres × ABV%), not read directly.</div>
                  )}
                </div>
              )}
              {existing && !d.saved && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ fontSize: 12, color: "#8A6D0B" }}>{monthLabelFromKey(d.period)} already has a return saved ({(existing.screenshotPaths || []).length} screenshot{(existing.screenshotPaths || []).length === 1 ? "" : "s"}).</div>
                  <div style={{ display: "flex", border: "1px solid #DDE0C8", borderRadius: 4, overflow: "hidden" }}>
                    {[...((existing.declaredLines || []).length > 0 ? [["evidence", "Attach screenshots only"]] : []), ["add", "Add these pages"], ["replace", "Replace it"]].map(([k, l]) => (
                      <button key={k} onClick={() => update(i, withTotals({ ...d, mode: k }))} style={{ flex: 1, background: d.mode === k ? "#5C9A3C" : "#F5F1E4", border: "none", padding: 9, color: d.mode === k ? "#16191A" : "#5C6B54", fontSize: 12.5, cursor: "pointer" }}>{l}</button>
                    ))}
                  </div>
                </div>
              )}
              {d.mode === "evidence" && existing ? (
                <div style={{ fontSize: 12.5, color: "#3F7A28", background: "#E4F0DA", borderRadius: 5, padding: "8px 10px", lineHeight: 1.5 }}>
                  The saved figures stay exactly as they are ({fmtLal(existing.declaredLal)} across {(existing.declaredLines || []).length} lines) — these screenshots are just attached as evidence.
                </div>
              ) : (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <NumberField label="Declared litres" value={d.declaredLitres} onChange={(v) => update(i, { declaredLitres: v })} suffix="L" />
                    <NumberField label="Declared LAL" value={d.declaredLal} onChange={(v) => update(i, { declaredLal: v })} suffix="LAL" />
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <NumberField label="Duty paid" value={d.declaredDuty} onChange={(v) => update(i, { declaredDuty: v })} suffix="$" />
                    <TextField label="Entry number" value={d.entryNumber} onChange={(v) => update(i, { entryNumber: v })} />
                  </div>
                  <TextField label="Date filed" type="date" value={d.filedDate} onChange={(v) => update(i, { filedDate: v })} />
                </>
              )}
              {month && comparison.length > 0 && <AbvComparisonTable rows={comparison} hasDeclaredLines={d.saveLines.length > 0} />}
              {d.notes.length > 0 && <div style={{ fontSize: 12, color: "#8A6D0B" }}>Reading note: {d.notes.join(" ")}</div>}
              <button
                disabled={!canSave}
                onClick={async () => {
                  update(i, { saving: true });
                  const ok = await onSaveGroup(d);
                  update(i, { saving: false, saved: !!ok });
                }}
                style={auditPrimaryBtn(canSave)}
              >
                {d.saved ? "Saved ✓" : d.saving ? "Saving..." : d.mode === "evidence" && existing ? "Attach screenshots" : "Save this return"}
              </button>
            </div>
          );
        })}
      </div>
      </div>
      <div style={{ flexShrink: 0, borderTop: "1px solid #DDE0C8", background: "#F8F5EA", padding: "12px 18px", display: "flex", gap: 10, justifyContent: "center" }}>
        <div style={{ display: "flex", gap: 10, width: "100%", maxWidth: 640 }}>
          {drafts.some((d) => !d.saved) && drafts.length > 1 && (
            <button onClick={saveAll} disabled={savingAll || !drafts.some(draftCanSave)} style={{ ...auditPrimaryBtn(!savingAll && drafts.some(draftCanSave)), flex: 2 }}>
              {savingAll
                ? `Saving… ${drafts.filter((d) => d.saved).length} of ${drafts.length}`
                : `Save all (${drafts.filter(draftCanSave).length})`}
            </button>
          )}
          <button onClick={onClose} style={{ ...auditSecondaryBtn, flex: 1 }}>{drafts.every((d) => d.saved) ? "Done" : "Close"}</button>
        </div>
      </div>
    </div>
    </>,
    document.body
  );
}

// Packaged vs declared, one row per strength.
export function AbvComparisonTable({ rows, hasDeclaredLines }) {
  const cell = { padding: "6px 4px", borderBottom: "1px solid #EBE8D6", verticalAlign: "top" };
  const num = { ...cell, textAlign: "right", fontFamily: "'JetBrains Mono', monospace", whiteSpace: "nowrap" };
  return (
    <div style={{ background: "#F8F5EA", border: "1px solid #EBE8D6", borderRadius: 5, padding: "8px 10px" }}>
      <div style={{ ...auditLabelStyle, marginBottom: 4 }}>Packaged vs declared, by ABV</div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, color: "#2A3324" }}>
        <thead>
          <tr style={{ color: "#5C6B54", textAlign: "left" }}>
            <th style={{ ...cell, fontWeight: 500 }}>ABV</th>
            <th style={{ ...cell, fontWeight: 500, textAlign: "right" }}>Packaged</th>
            <th style={{ ...cell, fontWeight: 500, textAlign: "right" }}>Declared</th>
            <th style={{ ...cell, fontWeight: 500, textAlign: "right" }}>Diff</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.abv}>
              <td style={cell}>
                <div style={{ fontFamily: "'JetBrains Mono', monospace" }}>{r.abv === "?" ? "—" : `${r.abv}%`}</div>
                {r.beers.length > 0 && <div style={{ color: "#5C6B54", fontSize: 11 }}>{r.beers.join(", ")}</div>}
                {r.beers.length === 0 && r.descriptions.length > 0 && <div style={{ color: "#5C6B54", fontSize: 11 }}>{r.descriptions.join(", ")}</div>}
              </td>
              <td style={num}>{fmtL(r.packedL)}</td>
              <td style={num}>{hasDeclaredLines ? fmtL(r.declaredL) : "—"}</td>
              <td style={{ ...num, color: hasDeclaredLines && r.off ? "#B5502F" : "#3F7A28", fontWeight: hasDeclaredLines && r.off ? 600 : 400 }}>
                {hasDeclaredLines ? (r.off ? fmtDiffL(r.diff) : "✓") : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ fontSize: 11.5, color: "#9BA88A", marginTop: 6 }}>
        {hasDeclaredLines ? "Litres to the nearest litre, as declared on TSW." : "Import this month's TSW screenshots to compare each line."}
      </div>
    </div>
  );
}

// What went into a packaging run, e.g. "2 × 50L keg, 30 × 330ml can".
export const containersLabel = (e) =>
  CONTAINERS.filter((c) => Number(e?.[c.key]) > 0)
    .map((c) => {
      const n = Number(e[c.key]);
      if (c.key !== "cans330") return `${n} × ${c.shortLabel || c.label}`;
      const cases = Math.floor(n / CANS_PER_CASE);
      const loose = n % CANS_PER_CASE;
      return `${n} cans${cases ? ` (${cases} case${cases === 1 ? "" : "s"}${loose ? ` + ${loose}` : ""})` : ""}`;
    })
    .join(", ");

export function auditRunDetail(r, batchById) {
  const b = batchById[r.batchId] || {};
  const brewed = Number(b.volume) || null;
  const loss = b.packaging && b.packaging.discarded != null ? Number(b.packaging.discarded) : null;
  return {
    date: r.date,
    batch: `#${r.batchNumber}`,
    beer: r.batchName,
    containers: containersLabel(r.event),
    litres: round3(r.volumeL),
    abv: r.abv,
    abvSource: r.usedLabel ? "label" : "measured",
    lal: exciseLal(r.volumeL, r.abv),
    brewDate: b.startDate || "",
    tank: b.tankName || "",
    brewedL: brewed,
    lossL: loss,
    og: b.og || null,
  };
}

export function ExciseAuditReport({ months, batches = [], companyName, abvMethod, onClose, closeLabel = "Close" }) {
  const active = months.filter((m) => m.status !== "nil" || m.ret);
  const keys = active.map((m) => m.period).sort();
  const [from, setFrom] = useState(keys[0] || "");
  const [to, setTo] = useState(keys[keys.length - 1] || "");
  const [full, setFull] = useState(true);
  const batchById = useMemo(() => Object.fromEntries(batches.map((b) => [b.id, b])), [batches]);
  const lo = from <= to ? from : to;
  const hi = from <= to ? to : from;
  const checked = active.filter((m) => m.period >= lo && m.period <= hi);
  const ordered = [...checked].sort((a, b) => a.period.localeCompare(b.period));
  const periodRange = ordered.length ? `${monthLabelFromKey(ordered[0].period)} – ${monthLabelFromKey(ordered[ordered.length - 1].period)}` : "No periods";
  const count = (st) => checked.filter((m) => m.status === st).length;
  const sum = (f) => ordered.reduce((s, m) => s + (Number(f(m)) || 0), 0);
  const totals = {
    litres: round3(sum((m) => m.appLitres)),
    lal: round3(sum((m) => m.appLal)),
    declaredLitres: round3(sum((m) => m.ret?.declaredLitres)),
    declaredLal: round3(sum((m) => m.ret?.declaredLal)),
    duty: Math.round(sum((m) => m.ret?.declaredDuty) * 100) / 100,
    levy: round2(sum((m) => m.ret?.declaredLevy)),
    levyGst: round2(sum((m) => m.ret?.declaredLevyGst)),
    ticked: ordered.filter((m) => m.ret?.declaredOnTsw).length,
  };
  const fileTag = ordered.length ? `${ordered[0].period}_to_${ordered[ordered.length - 1].period}` : "none";
  const oneMonth = ordered.length === 1;
  const [pdfBusy, setPdfBusy] = useState(false);
  // A real PDF file, downloaded straight away — same content as the page.
  const savePdf = async () => {
    if (!ordered.length) return;
    setPdfBusy(true);
    try {
      const tag = oneMonth ? ordered[0].period : `${ordered[0].period} to ${ordered[ordered.length - 1].period}`;
      await downloadExciseReportPdf({
        months: ordered,
        companyName,
        periodRange,
        abvMethod,
        full,
        fileName: `${companyName || "Brewery"} excise ${tag}.pdf`,
        intro: "",
        counts: "",
        summaryLine: "",
        // Kept simple: what was declared and what was packaged, no notes.
        renderMonth: (m, { text, table, ensure }) => {
          ensure(30);
          text(monthLabelFromKey(m.period), { size: 12, bold: true, gap: 0.8 });
          text(
            `${m.ret ? `Entry ${m.ret.entryNumber || "—"} · Filed ${m.ret.filedDate || "—"} · ` : "Not declared · "}Packaged ${fmtL(m.appLitres)} / ${round3(m.appLal).toFixed(3)} LAL · Declared ${fmtL(m.ret?.declaredLitres)} / ${m.ret?.declaredLal != null ? Number(m.ret.declaredLal).toFixed(3) : "—"} LAL`,
            { size: 8.5, color: [92, 107, 84], gap: 2 }
          );
          const dl = m.ret?.declaredLines || [];
          if (dl.length) {
            text("Declared on TSW", { size: 8, bold: true, gap: 0.5 });
            table(["Item", "Description", "ABV %", "Litres", "LAL"], dl.map((l) => [l.itemCode || "—", l.description || "—", l.abv != null ? Number(l.abv).toFixed(1) : "—", l.litres != null ? Number(l.litres).toLocaleString("en-NZ", { maximumFractionDigits: 3 }) : "—", l.lal != null ? Number(l.lal).toFixed(3) : "—"]), [0.15, 0.43, 0.12, 0.15, 0.15], [2, 3, 4]);
          }
          const runs = [...m.rows].sort((a, b) => String(a.date).localeCompare(String(b.date))).map((r) => auditRunDetail(r, batchById));
          if (runs.length) {
            text("Packaged", { size: 8, bold: true, gap: 0.5 });
            table(
              ["Date", "Batch", "Packaged as", "Litres", "ABV %", "LAL"],
              runs.map((d) => [d.date, `${d.batch} ${d.beer}`, d.containers, d.litres.toLocaleString("en-NZ", { maximumFractionDigits: 3 }), d.abv.toFixed(1), d.lal.toFixed(3)]),
              [0.13, 0.33, 0.24, 0.1, 0.09, 0.11],
              [3, 4, 5]
            );
          }
        },
      });
    } catch (e) {
      console.error(e);
      alert("Couldn't make the PDF — try Print instead.");
    }
    setPdfBusy(false);
  };
  // Name the saved PDF after the month(s): browsers use the page title.
  const printReport = () => {
    const before = document.title;
    const tag = !ordered.length ? "" : oneMonth ? ordered[0].period : `${ordered[0].period} to ${ordered[ordered.length - 1].period}`;
    document.title = `${companyName || "Brewery"} excise ${tag}`.trim();
    const restore = () => { document.title = before; window.removeEventListener("afterprint", restore); };
    window.addEventListener("afterprint", restore);
    window.print();
    setTimeout(restore, 60000);
  };

  const exportSummary = () =>
    downloadCSV(
      `excise-audit-summary-${fileTag}.csv`,
      ["Month", "Status", "Declared on TSW", "Entry number", "Filed", "Packaged litres", "Packaged LAL", "Declared litres", "Declared LAL", "Litres difference", "LAL difference", "Screenshots", "Reviewed by", "Notes / issues"],
      ordered.map((m) => {
        return [
          monthLabelFromKey(m.period),
          AUDIT_STATUS[m.status]?.label || m.status,
          m.ret?.declaredOnTsw ? `Yes${m.ret.declaredOnTswAt ? ` (${String(m.ret.declaredOnTswAt).slice(0, 10)})` : ""}` : "No",
          m.ret?.entryNumber || "",
          m.ret?.filedDate || "",
          round3(m.appLitres),
          round3(m.appLal),
          m.ret?.declaredLitres ?? "",
          m.ret?.declaredLal ?? "",
          m.ret?.declaredLitres != null ? round3(m.ret.declaredLitres - m.appLitres) : "",
          m.ret?.declaredLal != null ? round3(m.ret.declaredLal - m.appLal) : "",
          (m.ret?.screenshotPaths || []).length,
          m.ret?.reviewedBy || "",
          [...m.issues.map((i) => i.text), m.ret?.varianceExplanation ? `Explanation: ${m.ret.varianceExplanation}` : ""].filter(Boolean).join(" | "),
        ];
      })
    );

  const exportRuns = () =>
    downloadCSV(
      `excise-audit-packaging-runs-${fileTag}.csv`,
      ["Month", "Packaged on", "Batch", "Beer", "Containers", "Litres", "ABV %", "ABV source", "LAL", "Brew date", "Tank", "Brewed (L)", "Loss (L)", "OG", "Month declared on TSW"],
      ordered.flatMap((m) =>
        [...m.rows]
          .sort((a, b) => String(a.date).localeCompare(String(b.date)))
          .map((r) => {
            const d = auditRunDetail(r, batchById);
            return [monthLabelFromKey(m.period), d.date, d.batch, d.beer, d.containers, d.litres, d.abv.toFixed(2), d.abvSource, d.lal.toFixed(3), d.brewDate, d.tank, d.brewedL ?? "", d.lossL ?? "", d.og ?? "", m.ret?.declaredOnTsw ? "Yes" : "No"];
          })
      )
    );

  const sel = { background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 4, padding: "7px 8px", fontSize: 13, color: "#2A3324" };
  const th = { textAlign: "left", fontWeight: 600, padding: "4px 6px", borderBottom: "1px solid #C9D1AC", fontSize: 11, color: "#5C6B54", whiteSpace: "nowrap" };
  const td = { padding: "3px 6px", borderBottom: "1px solid #EEF0E2", fontSize: 11.5, verticalAlign: "top" };
  const num = { ...td, textAlign: "right", fontFamily: "'JetBrains Mono', monospace", whiteSpace: "nowrap" };

  return createPortal(
    <div id="excise-audit-print" style={{ position: "fixed", inset: 0, zIndex: 200, background: "#F5F1E4", overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #excise-audit-print, #excise-audit-print * { visibility: visible; }
          #excise-audit-print { position: absolute; top: 0; left: 0; width: 100%; background: #FFFFFF; overflow: visible; }
          .no-print { display: none !important; }
          .audit-month { page-break-inside: avoid; }
          .audit-month-page + .audit-month-page { page-break-before: always; }
        }
      `}</style>
      <div className="no-print" style={{ position: "sticky", top: 0, background: "#F5F1E4", borderBottom: "1px solid #DDE0C8", padding: "calc(10px + env(safe-area-inset-top)) 16px 10px", zIndex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <button onClick={onClose} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#5C6B54", cursor: "pointer", fontFamily: "'Inter', sans-serif", fontSize: 13.5, padding: 6 }}>
            <X size={16} /> {closeLabel}
          </button>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={printReport} style={{ ...auditSecondaryBtn, padding: "9px 14px" }}>Print</button>
            <button onClick={savePdf} disabled={pdfBusy || !ordered.length} style={{ background: "#5C9A3C", border: "none", borderRadius: 5, padding: "9px 16px", color: "#16191A", fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 13.5, cursor: "pointer", opacity: pdfBusy ? 0.6 : 1 }}>
              {pdfBusy ? "Making PDF…" : oneMonth ? `Save ${monthLabelFromKey(ordered[0].period)} as PDF` : "Save as PDF"}
            </button>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", fontSize: 12.5, color: "#5C6B54" }}>
          <span>One month</span>
          <select value={oneMonth ? from : ""} onChange={(e) => { if (e.target.value) { setFrom(e.target.value); setTo(e.target.value); } }} style={sel}>
            <option value="">Pick a month…</option>
            {[...keys].reverse().map((k) => <option key={k} value={k}>{monthLabelFromKey(k)}</option>)}
          </select>
          <button onClick={() => { setFrom(keys[0] || ""); setTo(keys[keys.length - 1] || ""); }} style={{ ...auditSecondaryBtn, padding: "6px 10px" }}>All months</button>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", fontSize: 12.5, color: "#5C6B54" }}>
          <span>From</span>
          <select value={from} onChange={(e) => setFrom(e.target.value)} style={sel}>
            {keys.map((k) => <option key={k} value={k}>{monthLabelFromKey(k)}</option>)}
          </select>
          <span>to</span>
          <select value={to} onChange={(e) => setTo(e.target.value)} style={sel}>
            {keys.map((k) => <option key={k} value={k}>{monthLabelFromKey(k)}</option>)}
          </select>
          <label style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 4 }}>
            <input type="checkbox" checked={full} onChange={(e) => setFull(e.target.checked)} style={{ width: 18, height: 18, accentColor: "#5C9A3C" }} />
            Full breakdown
          </label>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={exportSummary} disabled={!ordered.length} style={{ ...auditSecondaryBtn, padding: "8px 12px", flex: "1 1 180px" }}>Spreadsheet — monthly summary</button>
          <button onClick={exportRuns} disabled={!ordered.length} style={{ ...auditSecondaryBtn, padding: "8px 12px", flex: "1 1 180px" }}>Spreadsheet — every packaging run</button>
        </div>
      </div>
      <div style={{ maxWidth: 860, margin: "0 auto", padding: "30px 24px 60px", color: "#1A1F16" }}>
        <div className="no-print" style={{ fontFamily: "'Oswald', sans-serif", fontSize: 13, letterSpacing: "0.08em", textTransform: "uppercase", color: "#5C6B54" }}>{companyName || "Brewery"}</div>
        <h1 className="no-print" style={{ fontFamily: "'Oswald', sans-serif", fontSize: 26, fontWeight: 500, margin: "4px 0 6px" }}>Excise Self-Audit Report</h1>
        <div style={{ fontSize: 13, color: "#5C6B54", marginBottom: 16 }}>Period: {periodRange} · Generated {today()}</div>
        <div style={{ fontSize: 12.5, lineHeight: 1.55, marginBottom: 18, color: "#2A3324" }}>
          Volumes only — no dollar amounts are included. Each month's declared excise return is compared with production records. Duty is declared at packaging, so declared litres and litres of alcohol (LAL) are checked against beer packaged that month, using {abvMethod === "label" ? "label" : "measured"} ABV. LAL is litres × ABV cut to 3 decimals, as TSW calculates it. Differences within rounding (0.5%, or 1 L / 0.05 LAL) are treated as matching. This is an internal check prepared by the brewery, not a Customs assessment.
        </div>

        {ordered.map((m) => {
          const lines = tswLinesForRows(m.rows);
          const runs = [...m.rows].sort((a, b) => String(a.date).localeCompare(String(b.date))).map((r) => auditRunDetail(r, batchById));
          return (
            <div key={m.period} className="audit-month audit-month-page" style={{ borderTop: "1px solid #DDE0C8", padding: "14px 0", fontSize: 12.5 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, gap: 8 }}>
                <strong style={{ fontSize: 15 }}>{monthLabelFromKey(m.period)}</strong>
                <span style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                  {m.ret?.declaredOnTsw && <span style={{ background: "#E4F0DA", color: "#3F7A28", borderRadius: 999, padding: "3px 9px", fontSize: 11.5, fontWeight: 600 }}>✓ Declared on TSW</span>}
                  <AuditStatusPill status={m.status} />
                </span>
              </div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", color: "#2A3324" }}>
                Packaged {fmtL(m.appLitres)} / {round3(m.appLal).toFixed(3)} LAL · Declared {fmtL(m.ret?.declaredLitres)} / {m.ret?.declaredLal != null ? Number(m.ret.declaredLal).toFixed(3) : "—"} LAL
              </div>
              {m.ret && (
                <div style={{ color: "#5C6B54", marginTop: 3 }}>
                  Entry {m.ret.entryNumber || "—"} · Filed {m.ret.filedDate || "—"} · {(m.ret.screenshotPaths || []).length} screenshot(s) on file
                  {m.ret.declaredOnTsw && m.ret.declaredOnTswAt ? ` · Ticked declared ${String(m.ret.declaredOnTswAt).slice(0, 10)}${m.ret.declaredOnTswBy ? ` by ${m.ret.declaredOnTswBy}` : ""}` : ""}
                </div>
              )}
              {m.issues.map((iss, j) => (
                <div key={j} style={{ color: iss.level === "red" ? "#B5502F" : "#8A6D0B", marginTop: 3 }}>• {iss.text}</div>
              ))}
              {m.ret?.varianceExplanation && <div style={{ marginTop: 3 }}>Explanation: {m.ret.varianceExplanation}</div>}
              {m.ret?.reviewedBy && <div style={{ color: "#3F7A28", marginTop: 3 }}>Reviewed by {m.ret.reviewedBy} on {String(m.ret.reviewedAt || "").slice(0, 10)}</div>}

              {full && lines.length > 0 && (
                <>
                  <div style={{ marginTop: 10, fontSize: 11, letterSpacing: "0.05em", textTransform: "uppercase", color: "#5C6B54" }}>Excise worked out from packaging</div>
                  <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 4 }}>
                    <thead><tr><th style={th}>Product</th><th style={{ ...th, textAlign: "right" }}>ABV %</th><th style={{ ...th, textAlign: "right" }}>Litres</th><th style={{ ...th, textAlign: "right" }}>LAL</th></tr></thead>
                    <tbody>
                      {lines.map((l) => (
                        <tr key={l.key}>
                          <td style={td}>{l.name}</td>
                          <td style={num}>{l.abv.toFixed(1)}</td>
                          <td style={num}>{l.litres.toLocaleString("en-NZ", { maximumFractionDigits: 3 })}</td>
                          <td style={num}>{l.lal.toFixed(3)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}

              {full && (m.ret?.declaredLines || []).length > 0 && (() => {
                const dl = m.ret.declaredLines;
                return (
                  <>
                    <div style={{ marginTop: 10, fontSize: 11, letterSpacing: "0.05em", textTransform: "uppercase", color: "#5C6B54" }}>Declared on TSW</div>
                    <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 4 }}>
                      <thead><tr><th style={th}>Item</th><th style={th}>Description</th><th style={{ ...th, textAlign: "right" }}>ABV %</th><th style={{ ...th, textAlign: "right" }}>Litres</th><th style={{ ...th, textAlign: "right" }}>LAL</th></tr></thead>
                      <tbody>
                        {dl.map((l, j) => (
                          <tr key={j}>
                            <td style={{ ...td, whiteSpace: "nowrap" }}>{l.itemCode || "—"}</td>
                            <td style={td}>{l.description || "—"}</td>
                            <td style={num}>{l.abv != null ? Number(l.abv).toFixed(1) : "—"}</td>
                            <td style={num}>{l.litres != null ? Number(l.litres).toLocaleString("en-NZ", { maximumFractionDigits: 3 }) : "—"}</td>
                            <td style={num}>{l.lal != null ? Number(l.lal).toFixed(3) : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {dl.some((l) => (l.derived || []).includes("litres")) && <div style={{ fontSize: 10.5, color: "#5C6B54", marginTop: 3 }}>Litres worked out from LAL ÷ ABV where TSW showed LAL only.</div>}
                  </>
                );
              })()}

              {(m.ret?.declaredLines || []).length > 0 && (
                <>
                  <div style={{ marginTop: 10, fontSize: 11, letterSpacing: "0.05em", textTransform: "uppercase", color: "#5C6B54" }}>Declared vs packaged, by strength</div>
                  <div style={{ marginTop: 4, fontFamily: "'JetBrains Mono', monospace", fontSize: 11.5, color: "#2A3324" }}>
                    {exciseAbvComparison(m.rows, m.ret.declaredLines).map((r) => (
                      <div key={r.abv} style={{ color: r.off ? "#B5502F" : "#2A3324" }}>
                        {r.abv === "?" ? "Unknown ABV" : `${r.abv}%`}: packaged {fmtL(r.packedL)} · declared {fmtL(r.declaredL)}{r.off ? ` (${fmtDiffL(r.diff)})` : " ✓"}{r.beers.length ? ` — ${r.beers.join(", ")}` : ""}
                      </div>
                    ))}
                  </div>
                </>
              )}

              {full && runs.length > 0 && (
                <>
                  <div style={{ marginTop: 10, fontSize: 11, letterSpacing: "0.05em", textTransform: "uppercase", color: "#5C6B54" }}>Packaging runs</div>
                  <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 4 }}>
                    <thead><tr><th style={th}>Date</th><th style={th}>Batch</th><th style={th}>Packaged as</th><th style={{ ...th, textAlign: "right" }}>Litres</th><th style={{ ...th, textAlign: "right" }}>ABV</th><th style={{ ...th, textAlign: "right" }}>LAL</th></tr></thead>
                    <tbody>
                      {runs.map((d, j) => (
                        <tr key={j}>
                          <td style={{ ...td, whiteSpace: "nowrap" }}>{d.date}</td>
                          <td style={td}>
                            {d.batch} {d.beer}
                            <div style={{ fontSize: 10.5, color: "#5C6B54" }}>
                              {[d.brewDate && `brewed ${d.brewDate}`, d.tank, d.brewedL && `${d.brewedL} L brewed`, d.lossL != null && `${d.lossL} L loss`, d.og && `OG ${Number(d.og).toFixed(3)}`].filter(Boolean).join(" · ")}
                            </div>
                          </td>
                          <td style={td}>{d.containers}</td>
                          <td style={num}>{d.litres.toLocaleString("en-NZ", { maximumFractionDigits: 3 })}</td>
                          <td style={num}>{d.abv.toFixed(1)}%{d.abvSource === "measured" ? "*" : ""}</td>
                          <td style={num}>{d.lal.toFixed(3)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {runs.some((d) => d.abvSource === "measured") && <div style={{ fontSize: 10.5, color: "#8A6D0B", marginTop: 3 }}>* measured ABV — no label strength recorded</div>}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>,
    document.body
  );
}

export function ExciseSelfAudit({ batches, abvMethod, exciseItemCodes, exciseReturns, companyName, onSaveReturn, onDeleteReturn, onReviewReturn, onReadScreenshot, onImportGroup, onViewScreenshot, onSetDeclared, onShareWithAuditor }) {
  const [filter, setFilter] = useState("all");
  const [editingMonth, setEditingMonth] = useState(null);
  const [importGroups, setImportGroups] = useState(null);
  const [reading, setReading] = useState(null);
  const [readError, setReadError] = useState("");
  const [showReport, setShowReport] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const fileRef = useRef(null);

  const { months, undated } = useMemo(
    () => exciseAuditMonths({ batches, abvMethod, exciseReturns, exciseItemCodes, todayStr: today() }),
    [batches, abvMethod, exciseReturns, exciseItemCodes]
  );
  const monthsByPeriod = useMemo(() => Object.fromEntries(months.map((m) => [m.period, m])), [months]);
  const needsAttention = (m) => m.status === "attention" || m.status === "missing" || m.status === "check";
  const shown = filter === "attention" ? months.filter(needsAttention) : months.filter((m) => m.status !== "nil" || m.ret);
  const counted = months.filter((m) => m.status !== "nil");
  const n = (st) => counted.filter((m) => st.includes(m.status)).length;

  const handleFiles = async (fileList) => {
    const picked = [...(fileList || [])];
    if (picked.length === 0) return;
    setReadError("");
    const files = [];
    for (const f of picked) {
      if (!isZipFile(f)) { files.push(f); continue; }
      setReading(`Unzipping ${f.name}…`);
      try {
        const imgs = await imagesFromZip(f);
        if (imgs.length === 0) setReadError((e) => `${e}No screenshots found inside ${f.name}. `);
        files.push(...imgs);
      } catch (err) {
        setReadError((e) => `${e}${err.message} `);
      }
    }
    if (files.length === 0) { setReading(null); if (fileRef.current) fileRef.current.value = ""; return; }
    const readings = [];
    for (let i = 0; i < files.length; i += 1) {
      setReading(`Preparing screenshot ${i + 1} of ${files.length}…`);
      try {
        const img = await shrinkImageFile(files[i]);
        // A file already named by month ("2024-02 page 1.jpg") for a month
        // whose return is saved line by line only needs attaching as
        // evidence — no need to send it off to be read.
        const named = /^(\d{4})-(0[1-9]|1[0-2])\b/.exec(files[i].name || "");
        const namedPeriod = named ? `${named[1]}-${named[2]}` : null;
        if (namedPeriod && (exciseReturns.find((r) => r.period === namedPeriod)?.declaredLines || []).length > 0) {
          readings.push({ period: namedPeriod, lines: [], image: img });
          continue;
        }
        const result = await onReadScreenshot(img.base64);
        if (!result) continue;
        if (result.isTswExcise === false) {
          setReadError((e) => `${e}${files[i].name || "One image"} doesn't look like a TSW excise screen — skipped. `);
          continue;
        }
        readings.push({ ...result, image: img });
      } catch (err) {
        setReadError((e) => `${e}${err.message} `);
      }
    }
    setReading(null);
    if (fileRef.current) fileRef.current.value = "";
    if (readings.length > 0) setImportGroups(groupScreenshotReadings(readings));
  };

  const exportCsv = () =>
    downloadCSV(
      `excise-self-audit-${today()}.csv`,
      ["Period", "Status", "Packaged litres", "Packaged LAL", "Declared litres", "Declared LAL", "Litres difference", "LAL difference", "TSW entry number", "Filed date", "Usual due date", "Screenshots on file", "Issues", "Explanation", "Reviewed by", "Reviewed on"],
      [...counted].reverse().map((m) => [
        m.period,
        AUDIT_STATUS[m.status].label,
        m.appLitres,
        m.appLal,
        m.ret?.declaredLitres ?? "",
        m.ret?.declaredLal ?? "",
        m.litresDiff ?? "",
        m.lalDiff ?? "",
        m.ret?.entryNumber || "",
        m.ret?.filedDate || "",
        m.due,
        (m.ret?.screenshotPaths || []).length,
        m.issues.map((x) => x.text).join(" | "),
        m.ret?.varianceExplanation || "",
        m.ret?.reviewedBy || "",
        String(m.ret?.reviewedAt || "").slice(0, 10),
      ])
    );

  return (
    <div>
      <div style={{ background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "12px 14px", marginBottom: 16, fontSize: 12.5, lineHeight: 1.55, color: "#2A3324" }}>
        Checks each month's TSW return against what you packaged that month, so you find any gaps before Customs does. It compares litres and pure alcohol (LAL), not dollars, because duty rates change every July. A clean result is a good sign, not a guarantee — if it turns up an underpayment, Customs' voluntary disclosure process is the way to put it right.
      </div>

      <input ref={fileRef} type="file" accept="image/*,.zip,application/zip" multiple style={{ display: "none" }} onChange={(e) => handleFiles(e.target.files)} />
      <button onClick={() => fileRef.current?.click()} disabled={!!reading} style={{ ...auditPrimaryBtn(!reading), width: "100%", marginBottom: 8 }}>
        {reading || "Import TSW screenshots"}
      </button>
      <div style={{ color: "#9BA88A", fontSize: 11.5, marginBottom: 12, lineHeight: 1.5 }}>
        Screenshot the excise entry in TSW (one month or several), then pick the screenshots here — or a single .zip of them from the Files app. You'll check every figure before it's saved.
      </div>
      {readError && <div style={{ color: "#B5502F", fontSize: 12.5, marginBottom: 12 }}>{readError}</div>}

      {counted.length === 0 ? (
        <EmptyState icon={FileText} title="Nothing to check yet" subtitle="Once you've packaged beer or recorded a return, each month shows up here." />
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 12 }}>
            {[["Matching", n(["ok"]), "#3F7A28"], ["Check notes", n(["check"]), "#8A6D0B"], ["Attention", n(["attention", "missing"]), "#B5502F"]].map(([l, v, c]) => (
              <div key={l} style={{ background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "10px 12px" }}>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 20, color: c }}>{v}</div>
                <div style={auditLabelStyle}>{l}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
            <button onClick={() => setShowReport(true)} style={auditSecondaryBtn}>Audit report &amp; export</button>
            <button onClick={exportCsv} style={auditSecondaryBtn}>Export audit pack (CSV)</button>
          </div>
          {onShareWithAuditor && (
            <button onClick={onShareWithAuditor} style={{ ...auditSecondaryBtn, width: "100%", marginBottom: 12 }}>Share with auditor (read-only link)</button>
          )}
          <div style={{ display: "flex", border: "1px solid #DDE0C8", borderRadius: 4, overflow: "hidden", marginBottom: 12 }}>
            {[["all", "All months"], ["attention", "Needs a look"]].map(([k, l]) => (
              <button key={k} onClick={() => setFilter(k)} style={{ flex: 1, background: filter === k ? "#5C9A3C" : "#F5F1E4", border: "none", padding: 9, color: filter === k ? "#16191A" : "#5C6B54", fontSize: 12.5, cursor: "pointer" }}>{l}</button>
            ))}
          </div>
          {undated > 0 && <div style={{ color: "#B5502F", fontSize: 12.5, marginBottom: 12 }}>{undated} packaging run(s) have no date, so they can't be placed in any month.</div>}

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {shown.map((m) => (
              <div key={m.period} style={{ background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "12px 14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 16, color: "#2A3324" }}>{monthLabelFromKey(m.period)}</div>
                  <AuditStatusPill status={m.status} />
                </div>
                {onSetDeclared && (m.status !== "nil" || m.ret) && (
                  <div style={{ marginBottom: 10 }}>
                    <DeclaredOnTswTick period={m.period} ret={m.ret} onSetDeclared={onSetDeclared} />
                  </div>
                )}
                {m.status !== "nil" && <AuditFigures appLitres={m.appLitres} appLal={m.appLal} declaredLitres={m.ret?.declaredLitres} declaredLal={m.ret?.declaredLal} />}
                {returnPayable(m.ret) && <div style={{ marginTop: 8, fontSize: 12.5, color: "#2A3324", fontFamily: "'JetBrains Mono', monospace" }}>{payableText(returnPayable(m.ret))}</div>}
                {(m.rows.length > 0 || (m.ret?.declaredLines || []).length > 0) && (
                  <div style={{ marginTop: 10 }}>
                    <AbvComparisonTable rows={exciseAbvComparison(m.rows, m.ret?.declaredLines)} hasDeclaredLines={(m.ret?.declaredLines || []).length > 0} />
                  </div>
                )}
                {m.issues.length > 0 && (
                  <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 4 }}>
                    {m.issues.map((iss, j) => (
                      <div key={j} style={{ fontSize: 12.5, color: iss.level === "red" ? "#B5502F" : "#8A6D0B", lineHeight: 1.45 }}>• {iss.text}</div>
                    ))}
                  </div>
                )}
                {m.ret?.varianceExplanation && <div style={{ marginTop: 8, fontSize: 12.5, color: "#5C6B54" }}>Explanation: {m.ret.varianceExplanation}</div>}
                {m.ret?.reviewedBy && <div style={{ marginTop: 8, fontSize: 12, color: "#3F7A28" }}>✓ Reviewed by {m.ret.reviewedBy} on {String(m.ret.reviewedAt).slice(0, 10)}</div>}
                {(m.ret?.screenshotPaths || []).length > 0 && (
                  <div style={{ marginTop: 8, display: "flex", gap: 10, flexWrap: "wrap" }}>
                    {m.ret.screenshotPaths.map((p, j) => (
                      <button key={p} onClick={() => onViewScreenshot(p)} style={{ background: "none", border: "none", padding: 0, color: "#5C9A3C", fontSize: 12.5, cursor: "pointer", textDecoration: "underline" }}>Screenshot {j + 1}</button>
                    ))}
                  </div>
                )}
                {expanded === m.period && m.rows.length > 0 && (
                  <div style={{ marginTop: 10, background: "#F5F1E4", borderRadius: 5, padding: "8px 10px" }}>
                    {m.rows.map((r, j) => (
                      <div key={j} style={{ fontSize: 12, fontFamily: "'JetBrains Mono', monospace", color: "#2A3324", padding: "2px 0" }}>
                        {r.date} · {r.batchName} · {round3(r.volumeL)} L @ {r.abv.toFixed(2)}% = {exciseLal(r.volumeL, r.abv)} LAL
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                  <button onClick={() => setEditingMonth(m)} style={{ ...auditSecondaryBtn, padding: "8px 12px" }}>{m.ret ? "Edit return" : "Enter manually"}</button>
                  {m.rows.length > 0 && (
                    <button onClick={() => setExpanded(expanded === m.period ? null : m.period)} style={{ ...auditSecondaryBtn, padding: "8px 12px" }}>{expanded === m.period ? "Hide packaging runs" : "Show packaging runs"}</button>
                  )}
                  {m.ret && !m.ret.reviewedBy && (
                    <button onClick={() => onReviewReturn(m.ret)} style={{ ...auditSecondaryBtn, padding: "8px 12px" }}>Mark reviewed</button>
                  )}
                </div>
              </div>
            ))}
            {shown.length === 0 && <div style={{ color: "#9BA88A", fontSize: 13, padding: "12px 0" }}>Nothing needs a look right now.</div>}
          </div>
        </>
      )}

      {editingMonth && <ExciseReturnModal month={editingMonth} onClose={() => setEditingMonth(null)} onSave={(r) => onSaveReturn(r, editingMonth)} onDelete={onDeleteReturn} />}
      {importGroups && (
        <TswImportModal
          groups={importGroups}
          monthsByPeriod={monthsByPeriod}
          onClose={() => setImportGroups(null)}
          onSaveGroup={(g, opts) => onImportGroup(g, monthsByPeriod[g.period] || { period: g.period, appLitres: 0, appLal: 0 }, opts)}
        />
      )}
      {showReport && <ExciseAuditReport months={months} batches={batches} companyName={companyName} abvMethod={abvMethod} onClose={() => setShowReport(false)} />}
    </div>
  );
}

// Label strengths: one ABV per beer, applied to its batches. Batches in a
// month already ticked as declared on TSW are left alone.
export function LabelStrengthsView({ batches, recipes, exciseReturns, strengths, onSave }) {
  const [drafts, setDrafts] = useState({});
  const [replace, setReplace] = useState({});
  const [showOld, setShowOld] = useState(false);
  const [busy, setBusy] = useState("");
  const fam = useMemo(() => Object.fromEntries(recipes.map((r) => [r.id, r.familyId || r.id])), [recipes]);
  const declared = useMemo(() => new Set(exciseReturns.filter((r) => r.declaredOnTsw).map((r) => r.period)), [exciseReturns]);
  const locked = (b) => packagingEvents(b).some((e) => declared.has(monthKeyFromDate(e.date)));
  const beers = useMemo(() => {
    const by = {};
    batches.filter((b) => !b.mergedIntoBatchId).forEach((b) => {
      const k = productKeyForBatch(b, fam);
      (by[k] = by[k] || []).push(b);
    });
    return Object.entries(by)
      .map(([key, list]) => {
        const sorted = [...list].sort((a, b) => String(b.startDate).localeCompare(String(a.startDate)));
        const lastLabel = sorted.find((b) => b.labelAbv != null)?.labelAbv ?? null;
        const open = sorted.filter((b) => !locked(b));
        return {
          key,
          name: cleanProductName(sorted[0].name) || sorted[0].name,
          type: sorted[0].productType || "Beer",
          last: sorted[0].startDate,
          count: sorted.length,
          lastLabel,
          open,
          missing: open.filter((b) => b.labelAbv == null).length,
        };
      })
      .sort((a, b) => String(b.last).localeCompare(String(a.last)));
  }, [batches, fam, declared]);
  const cutoff = (() => { const d = new Date(); d.setFullYear(d.getFullYear() - 1); return d.toISOString().slice(0, 10); })();
  const shown = showOld ? beers : beers.filter((b) => b.last >= cutoff);
  const card = { background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "12px 14px", marginBottom: 10 };
  return (
    <div>
      <div style={{ fontSize: 13, color: "#5C6B54", lineHeight: 1.5, marginBottom: 14 }}>
        Set the strength on each beer's label once. It's used for every batch of that beer not yet declared, and for new batches from now on. Batches in months already ticked as declared on TSW aren't changed.
      </div>
      {shown.map((b) => {
        const saved = strengths[b.key];
        const value = drafts[b.key] ?? (saved != null ? String(saved) : b.lastLabel != null ? String(b.lastLabel) : "");
        const v = Number(value);
        const valid = value !== "" && Number.isFinite(v) && v > 0 && v < 70;
        const targets = b.open.filter((x) => x.labelAbv == null || (replace[b.key] && Number(x.labelAbv) !== v));
        const differ = b.open.filter((x) => x.labelAbv != null && valid && Number(x.labelAbv) !== v).length;
        return (
          <div key={b.key} style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, color: "#2A3324" }}>{b.name}</div>
                <div style={{ fontSize: 11.5, color: b.missing ? "#B5502F" : "#9BA88A" }}>
                  {b.type} · {b.count} batch{b.count === 1 ? "" : "es"}{b.missing && b.type === "Beer" ? ` · ${b.missing} with no label strength` : ""}
                </div>
                {b.type !== "Beer" && (
                  <div style={{ fontSize: 11.5, color: "#8A6D0B", marginTop: 2, lineHeight: 1.4 }}>
                    For the label only. Customs allows label strength for beer, so excise uses the measured ABV for this.
                  </div>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  value={value}
                  onChange={(e) => setDrafts((p) => ({ ...p, [b.key]: e.target.value }))}
                  style={{ width: 70, boxSizing: "border-box", background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 4, padding: "8px", fontFamily: "'JetBrains Mono', monospace", fontSize: 14, color: "#2A3324", textAlign: "right" }}
                />
                <span style={{ fontSize: 13, color: "#5C6B54" }}>%</span>
                <button
                  type="button"
                  disabled={!valid || busy === b.key || (saved === v && targets.length === 0)}
                  onClick={async () => {
                    setBusy(b.key);
                    await onSave(b.key, v, targets.map((x) => x.id), b.name);
                    setDrafts((p) => { const n = { ...p }; delete n[b.key]; return n; });
                    setBusy("");
                  }}
                  style={{ background: "#5C9A3C", border: "none", borderRadius: 5, padding: "8px 12px", color: "#16191A", fontSize: 12.5, cursor: "pointer", opacity: !valid || (saved === v && targets.length === 0) ? 0.45 : 1 }}
                >
                  {busy === b.key ? "Saving…" : saved === v && targets.length === 0 ? "Saved ✓" : "Save"}
                </button>
              </div>
            </div>
            {differ > 0 && (
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#5C6B54", marginTop: 8 }}>
                <input type="checkbox" checked={!!replace[b.key]} onChange={(e) => setReplace((p) => ({ ...p, [b.key]: e.target.checked }))} style={{ accentColor: "#5C9A3C" }} />
                Also change {differ} undeclared batch{differ === 1 ? "" : "es"} that already have a different strength
              </label>
            )}
          </div>
        );
      })}
      {beers.length > shown.length && (
        <button type="button" onClick={() => setShowOld(true)} style={{ background: "none", border: "none", color: "#5C9A3C", textDecoration: "underline", cursor: "pointer", fontSize: 13 }}>
          Show {beers.length - shown.length} beer{beers.length - shown.length === 1 ? "" : "s"} not brewed in the last year
        </button>
      )}
    </div>
  );
}

export function ExciseReportView(props) {
  const [tab, setTab] = useState("calculate");
  return (
    <div>
      <div style={{ display: "flex", border: "1px solid #DDE0C8", borderRadius: 5, overflow: "hidden", marginBottom: 18 }}>
        {[["calculate", "Calculate & export"], ["audit", "Self-audit"], ["labels", "Label strengths"]].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} style={{ flex: 1, background: tab === k ? "#5C9A3C" : "#F5F1E4", border: "none", padding: "10px", color: tab === k ? "#16191A" : "#5C6B54", fontFamily: "'Inter', sans-serif", fontSize: 13.5, fontWeight: tab === k ? 600 : 400, cursor: "pointer" }}>{l}</button>
        ))}
      </div>
      {tab === "calculate" ? <ExciseCalculateView {...props} /> : tab === "audit" ? <ExciseSelfAudit {...props} /> : <LabelStrengthsView batches={props.batches} recipes={props.recipes || []} exciseReturns={props.exciseReturns || []} strengths={props.labelStrengths || {}} onSave={props.onSaveLabelStrength} />}
    </div>
  );
}

// The lines to type into TSW for one month: one per product and strength,
// litres added up, LAL worked out on the line total and cut (not rounded)
// to 3 decimals, which is how TSW does it.
export function tswLinesForRows(rows) {
  const lines = {};
  rows.forEach((r) => {
    const abv = Math.round(r.abv * 100) / 100;
    const key = `${r.productType}::${r.batchName.trim().toLowerCase()}::${abv}`;
    if (!lines[key]) lines[key] = { key, name: r.batchName.trim(), productType: r.productType, abv, litres: 0, batchIds: new Set(), usedLabel: true, band: r.band, rate: exciseRateOn(r.band, r.date), date: r.date };
    const l = lines[key];
    l.litres += r.volumeL;
    l.batchIds.add(r.batchId);
    if (!r.usedLabel) l.usedLabel = false;
  });
  return Object.values(lines)
    .map((l) => {
      const litres = Math.round(l.litres * 1000) / 1000;
      const lal = exciseLal(litres, l.abv);
      const duty = l.band.basis === "alcohol" ? Math.round(lal * l.rate * 100) / 100 : l.band.basis === "beverage" ? Math.round(litres * l.rate * 100) / 100 : 0;
      const { levy, levyGst } = lineLevy(litres, l.abv, l.date);
      return { ...l, litres, lal, duty, levy, levyGst, batchIds: [...l.batchIds] };
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.abv - b.abv);
}

// "Declared on TSW" tick for one month. Ticking it locks the label
// strengths of everything packaged that month, so a declared figure can't
// quietly change afterwards; untick to correct something.
export function DeclaredOnTswTick({ period, ret, onSetDeclared }) {
  const [busy, setBusy] = useState(false);
  const on = !!ret?.declaredOnTsw;
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", background: on ? "#EBF3E4" : "#F8F5EA", border: `1px solid ${on ? "#9BC48A" : "#E8DFC0"}`, borderRadius: 6, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}>
      <input
        type="checkbox"
        checked={on}
        disabled={busy}
        onChange={async (e) => {
          setBusy(true);
          await onSetDeclared(period, e.target.checked);
          setBusy(false);
        }}
        style={{ width: 20, height: 20, accentColor: "#5C9A3C", flexShrink: 0 }}
      />
      <span style={{ fontSize: 13, color: "#2A3324", lineHeight: 1.35 }}>
        Declared on TSW
        <span style={{ display: "block", fontSize: 11.5, color: "#5C6B54" }}>
          {on
            ? `Ticked${ret.declaredOnTswBy ? ` by ${ret.declaredOnTswBy}` : ""}${ret.declaredOnTswAt ? ` on ${String(ret.declaredOnTswAt).slice(0, 10)}` : ""} — label strengths for this month are locked`
            : "Tick once this month is lodged — it locks the label strengths used"}
        </span>
      </span>
    </label>
  );
}

export function TswLinesTable({ rows, monthLabel, abvMethod, onSetLabelAbv, locked, tick }) {
  const lines = useMemo(() => tswLinesForRows(rows), [rows]);
  const [drafts, setDrafts] = useState({});
  const [saving, setSaving] = useState(null);
  if (lines.length === 0) return null;
  const totalLitres = Math.round(lines.reduce((s, l) => s + l.litres, 0) * 1000) / 1000;
  const totalLal = Math.round(lines.reduce((s, l) => s + l.lal, 0) * 1000) / 1000;
  const totalDuty = Math.round(lines.reduce((s, l) => s + l.duty, 0) * 100) / 100;
  const totalLevy = round2(lines.reduce((s, l) => s + l.levy, 0));
  const totalLevyGst = round2(lines.reduce((s, l) => s + l.levyGst, 0));
  const totalPayable = round2(totalDuty + totalLevy + totalLevyGst);
  const canEdit = abvMethod === "label" && !locked;

  const saveAbv = async (line) => {
    const raw = drafts[line.key];
    if (raw === undefined) return;
    const v = raw === "" ? null : Number(raw);
    if (v === line.abv || (v != null && (Number.isNaN(v) || v <= 0 || v > 70))) {
      setDrafts((p) => { const n = { ...p }; delete n[line.key]; return n; });
      return;
    }
    setSaving(line.key);
    for (const id of line.batchIds) await onSetLabelAbv(id, v);
    setSaving(null);
    setDrafts((p) => { const n = { ...p }; delete n[line.key]; return n; });
  };

  const cell = { fontFamily: "'JetBrains Mono', monospace", fontSize: 13, textAlign: "right", whiteSpace: "nowrap" };
  const head = { fontSize: 10.5, letterSpacing: "0.05em", textTransform: "uppercase", color: "#5C6B54" };
  const cols = "minmax(0,1fr) 78px 74px 70px 74px";
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 4 }}>TSW lines — {monthLabel}</div>
      <div style={{ color: "#9BA88A", fontSize: 11.5, marginBottom: 8, lineHeight: 1.45 }}>
        One line per product and strength, as entered in TSW. LAL is litres × ABV, cut to 3 decimals the way TSW does.
        {locked ? " This month is ticked as declared, so strengths are locked." : canEdit ? " Change a strength here and it's saved as the label ABV on every batch on that line this month — LAL and duty update straight away." : " Switch the ABV method to Label to edit strengths here."}
      </div>
      {tick && <div style={{ marginBottom: 8 }}>{tick}</div>}
      <div style={{ background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: cols, gap: 6, padding: "8px 10px", background: "#F5F1E4" }}>
          <span style={head}>Product</span>
          <span style={{ ...head, textAlign: "right" }}>ABV %</span>
          <span style={{ ...head, textAlign: "right" }}>Litres</span>
          <span style={{ ...head, textAlign: "right" }}>LAL</span>
          <span style={{ ...head, textAlign: "right" }}>Duty</span>
        </div>
        {lines.map((l) => (
          <div key={l.key} style={{ display: "grid", gridTemplateColumns: cols, gap: 6, alignItems: "center", padding: "8px 10px", borderTop: "1px solid #EEF0E2", opacity: saving === l.key ? 0.5 : 1 }}>
            <span style={{ minWidth: 0 }}>
              <span style={{ fontSize: 13, color: "#2A3324" }}>{l.name}</span>
              <span style={{ display: "block", fontSize: 11, color: l.usedLabel ? "#9BA88A" : "#B5502F" }}>
                {l.productType} · {l.batchIds.length} batch{l.batchIds.length === 1 ? "" : "es"}{l.usedLabel ? "" : " · measured ABV, no label set"}
              </span>
            </span>
            <span style={{ textAlign: "right" }}>
              {canEdit && l.productType === "Beer" ? (
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  value={drafts[l.key] ?? l.abv}
                  onChange={(e) => setDrafts((p) => ({ ...p, [l.key]: e.target.value }))}
                  onBlur={() => saveAbv(l)}
                  onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                  aria-label={`Label ABV for ${l.name}`}
                  style={{ width: 64, boxSizing: "border-box", background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 4, padding: "5px 6px", color: "#2A3324", fontFamily: "'JetBrains Mono', monospace", fontSize: 13, textAlign: "right" }}
                />
              ) : (
                <span style={cell}>{l.abv.toFixed(1)}</span>
              )}
            </span>
            <span style={cell}>{l.litres.toLocaleString("en-NZ", { maximumFractionDigits: 3 })}</span>
            <span style={cell}>{l.lal.toFixed(3)}</span>
            <span style={cell}>${l.duty.toFixed(2)}</span>
          </div>
        ))}
        <div style={{ display: "grid", gridTemplateColumns: cols, gap: 6, padding: "9px 10px", borderTop: "1px solid #DDE0C8", background: "#F8F5EA", fontWeight: 600 }}>
          <span style={{ fontSize: 13, color: "#2A3324" }}>Total</span>
          <span />
          <span style={cell}>{totalLitres.toLocaleString("en-NZ", { maximumFractionDigits: 3 })}</span>
          <span style={cell}>{totalLal.toFixed(3)}</span>
          <span style={cell}>${totalDuty.toFixed(2)}</span>
        </div>
        {[
          ["Alcohol levy", totalLevy, false],
          ["GST on levy (15%)", totalLevyGst, false],
          ["Total payable", totalPayable, true],
        ].map(([label, v, strong]) => (
          <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "8px 10px", borderTop: "1px solid #EEF0E2", background: strong ? "#EBF3E4" : "#FFFFFF", fontWeight: strong ? 600 : 400 }}>
            <span style={{ fontSize: 13, color: "#2A3324" }}>{label}</span>
            <span style={cell}>${v.toFixed(2)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ExciseCalculateView({ batches, exciseItemCodes, onSaveItemCode, abvMethod, onSetAbvMethod, onSetLabelAbv, exciseReturns = [], onSetDeclared }) {
  const lockedPeriods = useMemo(() => new Set(exciseReturns.filter((r) => r.declaredOnTsw).map((r) => r.period)), [exciseReturns]);
  // null = not chosen yet, which shows the latest month; "" = all time.
  const [monthChoice, setMonthFilter] = useState(null);
  const [labelDrafts, setLabelDrafts] = useState({});
  const [codeDrafts, setCodeDrafts] = useState(() => {
    const initial = {};
    PRODUCT_TYPES.forEach((t) => {
      initial[t] = exciseItemCodes.find((e) => e.productType === t)?.itemNumber || "";
    });
    return initial;
  });
  const allRows = useMemo(() => exciseRowsForBatches(batches, abvMethod), [batches, abvMethod]);
  const months = useMemo(() => {
    const keys = [...new Set(allRows.map((r) => monthKeyFromDate(r.date)))];
    return keys.sort().reverse();
  }, [allRows]);
  const monthFilter = monthChoice === null ? months[0] || "" : monthChoice;
  const rows = monthFilter ? allRows.filter((r) => monthKeyFromDate(r.date) === monthFilter) : allRows;
  const totalDuty = rows.reduce((s, r) => s + r.duty, 0);
  const totalVolume = Math.round(rows.reduce((s, r) => s + r.volumeL, 0) * 100) / 100;
  const totalLevy = round2(rows.reduce((s, r) => s + (r.levy || 0), 0));
  const totalLevyGst = round2(rows.reduce((s, r) => s + (r.levyGst || 0), 0));
  const totalPayable = round2(totalDuty + totalLevy + totalLevyGst);

  // Grouped by product type first — a real excise entry needs the right
  // item number per type, on top of the duty band — then by band within
  // each type, since that's what actually drives the duty rate.
  const byType = {};
  rows.forEach((r) => {
    if (!byType[r.productType]) byType[r.productType] = { volumeL: 0, duty: 0, byBand: {} };
    byType[r.productType].volumeL += r.volumeL;
    byType[r.productType].duty += r.duty;
    const bandKey = `${r.band.min}-${r.band.max}`;
    if (!byType[r.productType].byBand[bandKey]) byType[r.productType].byBand[bandKey] = { band: r.band, volumeL: 0, duty: 0 };
    byType[r.productType].byBand[bandKey].volumeL += r.volumeL;
    byType[r.productType].byBand[bandKey].duty += r.duty;
  });
  const typeGroups = Object.entries(byType).sort((a, b) => b[1].duty - a[1].duty);

  const itemNumberFor = (type) => exciseItemCodes.find((e) => e.productType === type)?.itemNumber;

  const saveCode = (type) => {
    onSaveItemCode(type, codeDrafts[type].trim());
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start", color: "#7A3E1D", background: "#FBE5D2", border: "1px solid #E3B37A", borderRadius: 6, padding: "12px 14px", marginBottom: 20 }}>
        <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
        <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>
          <strong>This is a guide, not a filing.</strong> Figures are estimated from NZ Customs rates effective 1 July 2026, based on each batch's packaged volume and either measured or label ABV. Confirm your actual filing obligations, reporting period, item classification, ABV method, and final figures with NZ Customs or your accountant before lodging a real return.
        </div>
      </div>

      <div style={{ marginBottom: 22 }}>
        <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 8 }}>
          ABV method for excise
        </div>
        <div style={{ display: "flex", border: "1px solid #DDE0C8", borderRadius: 4, overflow: "hidden", marginBottom: 8 }}>
          {[
            ["measured", "Measured — tested ABV"],
            ["label", "Label — beer only"],
          ].map(([m, label]) => (
            <button
              key={m}
              onClick={() => onSetAbvMethod(m)}
              style={{
                flex: 1,
                background: abvMethod === m ? "#5C9A3C" : "#F5F1E4",
                border: "none",
                padding: "9px",
                color: abvMethod === m ? "#16191A" : "#5C6B54",
                fontFamily: "'Inter', sans-serif",
                fontSize: 12.5,
                cursor: "pointer",
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {abvMethod === "label" && (
          <div style={{ color: "#7A3E1D", fontSize: 11.5, lineHeight: 1.5 }}>
            Label strength is only available for beer, and only if you produce 2 million litres or less per year — with the label strength either verified by three consistent tests within 6 months, or set equal to or above your target strength. Confirm you actually qualify before relying on this.
          </div>
        )}
      </div>

      <div style={{ marginBottom: 22 }}>
        <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 4 }}>
          Excise item numbers — set once per product type, from your own Working Tariff Document lookup
        </div>
        <div style={{ color: "#9BA88A", fontSize: 11.5, marginBottom: 8 }}>
          TSW wants these as 6 digits + a check letter, no dots or spaces — dots typed here are stripped automatically on export either way.
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {PRODUCT_TYPES.map((t) => (
            <div key={t} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ flex: 1, color: "#2A3324", fontSize: 13 }}>{t}</span>
              <input
                type="text"
                value={codeDrafts[t]}
                onChange={(e) => setCodeDrafts((prev) => ({ ...prev, [t]: e.target.value }))}
                onBlur={() => saveCode(t)}
                placeholder="e.g. 991050G"
                style={{ width: 130, boxSizing: "border-box", background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 4, padding: "7px 9px", color: "#2A3324", fontFamily: "'JetBrains Mono', monospace", fontSize: 12.5 }}
              />
            </div>
          ))}
        </div>
      </div>

      {months.length > 0 && (
        <select
          value={monthFilter}
          onChange={(e) => setMonthFilter(e.target.value)}
          style={{
            width: "100%",
            boxSizing: "border-box",
            background: "#F5F1E4",
            border: "1px solid #DDE0C8",
            borderRadius: 5,
            padding: "10px 12px",
            color: "#2A3324",
            fontFamily: "'Inter', sans-serif",
            fontSize: 14,
            marginBottom: 12,
          }}
        >
          <option value="">All time</option>
          {months.map((m) => (
            <option key={m} value={m}>
              {monthLabelFromKey(m)}
            </option>
          ))}
        </select>
      )}

      {monthFilter && (
        <TswLinesTable
          rows={rows}
          monthLabel={monthLabelFromKey(monthFilter)}
          abvMethod={abvMethod}
          onSetLabelAbv={onSetLabelAbv}
          locked={lockedPeriods.has(monthFilter)}
          tick={onSetDeclared ? <DeclaredOnTswTick period={monthFilter} ret={exciseReturns.find((r) => r.period === monthFilter)} onSetDeclared={onSetDeclared} /> : null}
        />
      )}

      {rows.length > 0 && (
        <button
          onClick={() =>
            downloadCSV(
              `excise-tsw-export-${monthFilter || "all"}.csv`,
              ["Goods Description", "Excise Item", "Statistical Quantity", "Statistical Unit", "Supplementary Quantity", "Supplementary Unit", "Percentage (%) Volume of Alcohol", "Estimated duty ($) — reference only, TSW calculates the real figure", "Estimated alcohol levy ($)", "Estimated GST on levy ($)"],
              rows.map((r) => {
                // TSW's own help text: "6 digits + CHECK LETTER... Do not
                // transmit dots or spaces" — strip whatever punctuation
                // was typed in, regardless of how it was entered.
                const rawCode = (exciseItemCodes.find((e) => e.productType === r.productType)?.itemNumber) || "";
                const itemCode = rawCode ? rawCode.replace(/[.\s]/g, "") : "NOT SET";
                // TSW truncates this figure rather than rounding it —
                // confirmed against a real entry (273.360L @ 6% shows as
                // 16.401, not 16.402 which straight rounding would give).
                const lal = exciseLal(r.volumeL, r.abv);
                return [
                  `${r.productType} - ${r.batchName} ${r.abv.toFixed(1)}%`,
                  itemCode,
                  lal.toFixed(3),
                  "Litre Pure Alcohol (LAL)",
                  r.volumeL.toFixed(3),
                  "Litre (L)",
                  r.abv.toFixed(2),
                  r.duty.toFixed(2),
                  r.levy != null ? r.levy.toFixed(2) : "N/A",
                  r.levyGst != null ? r.levyGst.toFixed(2) : "N/A",
                ];
              })
            )
          }
          style={{ width: "100%", background: "#EBE8D6", border: "1px solid #C9D1AC", borderRadius: 5, padding: "10px", color: "#2A3324", fontFamily: "'Inter', sans-serif", fontSize: 13, cursor: "pointer", marginBottom: 16 }}
        >
          Export for TSW filing (CSV)
        </button>
      )}

      {rows.length === 0 ? (
        <EmptyState icon={FileText} title="Nothing packaged yet" subtitle="Excise is calculated from packaging events, so this fills in once you've packaged a batch with a logged final gravity." />
      ) : (
        <>
          {/* With a month picked, the TSW lines table above already has the exact
              totals, so these summary boxes only show for a longer period. */}
          {!monthFilter && (<>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div style={{ background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "14px 16px" }}>
              <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 4 }}>Volume packaged</div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 20, color: "#2A3324" }}>{totalVolume} L</div>
            </div>
            <div style={{ background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "14px 16px" }}>
              <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 4 }}>Estimated duty</div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 20, color: "#2A3324" }}>${totalDuty.toFixed(2)}</div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 8 }}>
            <div style={{ background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "14px 16px" }}>
              <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 4 }}>Alcohol levy</div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 20, color: "#2A3324" }}>${totalLevy.toFixed(2)}</div>
            </div>
            <div style={{ background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "14px 16px" }}>
              <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 4 }}>GST on levy (15%)</div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 20, color: "#2A3324" }}>${totalLevyGst.toFixed(2)}</div>
            </div>
          </div>
          <div style={{ background: "#EBF3E4", border: "1px solid #9BC48A", borderRadius: 6, padding: "14px 16px", marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#3F7A28" }}>Total payable (duty + levy + GST on levy)</div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 20, color: "#2A3324" }}>${totalPayable.toFixed(2)}</div>
          </div>
          </>)}
          <div style={{ color: "#9BA88A", fontSize: 11.5, marginBottom: 22 }}>
            Duty and levy use Customs' published rates for the date each batch was packaged. GST is charged on the levy only, not on the duty. TSW works out the final figures, so allow a few cents for rounding.
          </div>

          <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>By product type</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
            {typeGroups.map(([type, g]) => (
              <div key={type} style={{ background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "12px 14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div>
                    <span style={{ color: "#2A3324", fontSize: 13.5, fontWeight: 500 }}>{type}</span>
                    <span style={{ color: itemNumberFor(type) ? "#9BA88A" : "#B5502F", fontSize: 11.5, marginLeft: 8, fontFamily: "'JetBrains Mono', monospace" }}>
                      {itemNumberFor(type) || "no item number set"}
                    </span>
                  </div>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#5C6B54" }}>${g.duty.toFixed(2)}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  {Object.values(g.byBand).sort((a, b) => a.band.min - b.band.min).map((b) => (
                    <div key={`${b.band.min}-${b.band.max}`} style={{ display: "flex", justifyContent: "space-between", padding: "7px 10px", background: "#F8F5EA", border: "1px solid #EBE8D6", borderRadius: 4, fontSize: 12.5, color: "#2A3324" }}>
                      <span>
                        {b.band.min}–{b.band.max === Infinity ? "23+" : b.band.max}% ABV
                        <span style={{ color: "#9BA88A", fontSize: 11 }}> · {Math.round(b.volumeL * 100) / 100} L</span>
                      </span>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#5C6B54" }}>${b.duty.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>Packaging events</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {rows.map((r, i) => (
              <div key={i} style={{ padding: "10px 12px", background: "#FFFFFF", border: `1px solid ${r.usedFallback ? "#E3B37A" : "#DDE0C8"}`, borderRadius: 5, fontSize: 13 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ color: "#2A3324" }}>
                    {r.batchName} <span style={{ color: "#9BA88A" }}>· {r.productType} · {r.abv.toFixed(1)}% ABV{r.usedLabel ? " (label)" : r.usedFallback ? " (measured, no label set)" : ""} · {r.volumeL}L · {r.date}</span>
                  </span>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#5C6B54", flexShrink: 0, textAlign: "right" }}>
                    ${r.duty.toFixed(2)}
                    {r.levy != null && <div style={{ fontSize: 11, color: "#9BA88A" }}>+${r.levy.toFixed(2)} levy</div>}
                  </span>
                </div>
                {abvMethod === "label" && r.productType === "Beer" && !lockedPeriods.has(monthKeyFromDate(r.date)) && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
                    <span style={{ color: "#9BA88A", fontSize: 11.5 }}>Label ABV:</span>
                    <input
                      type="number"
                      step="0.1"
                      value={labelDrafts[r.batchId] ?? r.labelAbv ?? ""}
                      onChange={(e) => setLabelDrafts((prev) => ({ ...prev, [r.batchId]: e.target.value }))}
                      onBlur={() => {
                        const v = labelDrafts[r.batchId];
                        if (v !== undefined) onSetLabelAbv(r.batchId, v === "" ? null : Number(v));
                      }}
                      placeholder="e.g. 5.0"
                      style={{ width: 70, boxSizing: "border-box", background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 4, padding: "5px 7px", color: "#2A3324", fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}
                    />
                    <span style={{ color: "#9BA88A", fontSize: 11 }}>%</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function PackagedView({ batches, onOpenBatch }) {
  const [query, setQuery] = useState("");
  const [monthFilter, setMonthFilter] = useState("");

  const matchingBatches =
    query.trim().length === 0
      ? []
      : batches.filter(
          (b) =>
            (b.packaging && packagingEvents(b).length > 0) &&
            (b.name.toLowerCase().includes(query.trim().toLowerCase()) || String(b.number).includes(query.trim()))
        );

  const allMonths = packagingByMonth(batches);
  const months = monthFilter ? allMonths.filter((m) => m.key === monthFilter) : allMonths;

  return (
    <div>
      <div style={{ position: "relative", marginBottom: 12 }}>
        <input
          data-tour="page-packaged-search"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search batches by name or number…"
          style={{
            width: "100%",
            boxSizing: "border-box",
            background: "#F5F1E4",
            border: "1px solid #DDE0C8",
            borderRadius: 5,
            padding: "10px 12px",
            color: "#2A3324",
            fontFamily: "'Inter', sans-serif",
            fontSize: 14,
          }}
        />
      </div>

      {query.trim().length === 0 && !monthFilter && allMonths.length > 1 && (
        <div style={{ background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "16px 12px 6px", marginBottom: 22 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 6, marginLeft: 8 }}>
            Volume packaged by month (L)
          </div>
          <Suspense fallback={<div style={{ height: 160 }} />}>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={[...allMonths].reverse()} margin={{ top: 5, right: 14, left: -14, bottom: 0 }}>
              <CartesianGrid stroke="#DDE0C8" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" stroke="#9BA88A" fontSize={11} />
              <YAxis stroke="#9BA88A" fontSize={11} />
              <Tooltip
                contentStyle={{ background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 4, fontSize: 12 }}
                labelStyle={{ color: "#5C6B54" }}
              />
              <Bar dataKey="volume" fill="#5C9A3C" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          </Suspense>
        </div>
      )}

      {query.trim().length === 0 && (
        <div style={{ marginBottom: 24 }}>
          <span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B54", display: "block", marginBottom: 5 }}>
            Search by date
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="month"
              value={monthFilter}
              onChange={(e) => setMonthFilter(e.target.value)}
              style={{
                flex: 1,
                boxSizing: "border-box",
                background: "#F5F1E4",
                border: "1px solid #DDE0C8",
                borderRadius: 5,
                padding: "9px 12px",
                color: "#2A3324",
                fontFamily: "'Inter', sans-serif",
                fontSize: 13.5,
              }}
            />
            {monthFilter && (
              <button
                onClick={() => setMonthFilter("")}
                style={{ background: "none", border: "none", color: "#5C6B54", cursor: "pointer", fontSize: 12.5, fontFamily: "'Inter', sans-serif", padding: "0 4px" }}
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}

      {query.trim().length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {matchingBatches.map((b) => {
            const totals = aggregatePackagingCounts(b);
            const rem = remainingVolume(b);
            const parts = CONTAINERS.filter((c) => totals[c.key] > 0).map((c) => `${totals[c.key]}× ${c.shortLabel}`);
            return (
              <button
                key={b.id}
                onClick={() => onOpenBatch(b.id)}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "12px 14px",
                  background: "#FFFFFF",
                  border: "1px solid #DDE0C8",
                  borderRadius: 6,
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <div>
                  <div style={{ color: "#2A3324", fontSize: 14, fontFamily: "'Oswald', sans-serif", fontWeight: 500 }}>
                    {b.name} <span style={{ color: "#9BA88A", fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>#{b.number}</span>
                  </div>
                  <div style={{ color: "#5C6B54", fontSize: 12, marginTop: 3 }}>
                    {totalPackagedVolume(b).toFixed(2)}L packaged{parts.length ? ` · ${parts.join(" · ")}` : ""}
                    {rem > 0 ? ` · ${rem}L in tank` : ""}
                  </div>
                </div>
              </button>
            );
          })}
          {matchingBatches.length === 0 && (
            <div style={{ color: "#9BA88A", fontSize: 13.5, padding: "20px 4px" }}>
              No packaged batches match "{query}".
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          {months.map((m) => (
            <div key={m.key}>
              <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 16, color: "#2A3324", fontWeight: 500, marginBottom: 8 }}>
                {m.label}
              </div>
              <div style={{ background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "12px 14px", marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ color: "#5C6B54", fontSize: 12.5 }}>Total packaged</span>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#2A3324", fontSize: 15 }}>{m.volume.toFixed(2)} L</span>
                </div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11.5, color: "#9BA88A", marginTop: 6 }}>
                  {CONTAINERS.filter((c) => m.counts[c.key] > 0)
                    .map((c) => `${m.counts[c.key]}× ${c.shortLabel}`)
                    .join(" · ") || "No containers logged"}
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {m.batches
                  .sort((a, b) => b.volume - a.volume)
                  .map((b) => (
                    <button
                      key={b.id}
                      onClick={() => onOpenBatch(b.id)}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "9px 12px",
                        background: "#F8F5EA",
                        border: "1px solid #EBE8D6",
                        borderRadius: 5,
                        fontSize: 13,
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      <span style={{ color: "#2A3324" }}>
                        {b.name} <span style={{ color: "#9BA88A", fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}>#{b.number}</span>
                      </span>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#5C6B54", fontSize: 12 }}>{b.volume.toFixed(2)} L</span>
                    </button>
                  ))}
              </div>
            </div>
          ))}
          {months.length === 0 && (
            <div style={{ color: "#9BA88A", fontSize: 13.5, padding: "20px 4px" }}>
              {monthFilter
                ? `Nothing packaged in ${monthLabelFromKey(monthFilter)}.`
                : "Nothing packaged yet — once you log a packaging run on a batch, it'll show up here by month."}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
