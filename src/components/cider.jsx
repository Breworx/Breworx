import { useState, useMemo, useEffect } from "react";
import { X, Trash2 } from "lucide-react";
import { fmtL } from "./excise";
import { Modal, NumberField, TextField } from "./ui";
import { calcABV } from "../lib/brewing";
import { latestReading } from "../lib/config";
import { normItemName, remainingVolume, tankIsOccupied, uid, unitFactor } from "../lib/production";
import { scrollFieldIntoView, today } from "../lib/utils";

// ─── Cider ──────────────────────────────────────────────────────────────────
// Juice intake, additions, blending and back-sweetening for Cider/Perry
// batches. The maths is standard cider-making practice; every figure is a
// starting point to check against your own measurements and product labels.

export const CIDER_TYPE = "Cider/Perry";
export const cnum = (v) => (v === "" || v == null || Number.isNaN(Number(v)) ? null : Number(v));
export const r1 = (n) => Math.round(n * 10) / 10;
export const r3c = (n) => Math.round(n * 1000) / 1000;
export const brixToSg = (brix) => 1 + brix / (258.6 - (brix / 258.2) * 227.1);
export const sgToBrix = (sg) => -616.868 + 1111.14 * sg - 630.272 * sg * sg + 135.997 * sg * sg * sg;
export const abvFrom = (og, fg) => (og - fg) * 131.25;
// Sucrose raises gravity by about 0.384 points for each g/L added.
export const SUGAR_POINTS_PER_G_L = 0.384;
// Free SO2 needed to give a molecular SO2 level at a given pH; K-meta is 57.6% SO2.
export const freeSo2For = (ph, molecular) => molecular * (1 + Math.pow(10, ph - 1.81));
export const kmetaGrams = (freeSo2MgL, litres) => (freeSo2MgL * litres) / 576;
// pH doesn't average linearly — blend by hydrogen-ion concentration instead.
export const blendPh = (parts) => {
  const v = parts.reduce((s, p) => s + p.litres, 0);
  if (!v) return null;
  const h = parts.reduce((s, p) => s + p.litres * Math.pow(10, -p.ph), 0) / v;
  return -Math.log10(h);
};
export const weighted = (parts, key) => {
  const withVal = parts.filter((p) => p[key] != null && p.litres > 0);
  const v = withVal.reduce((s, p) => s + p.litres, 0);
  return v ? withVal.reduce((s, p) => s + p.litres * p[key], 0) / v : null;
};
export const fmtSg = (sg) => (sg == null ? "—" : sg.toFixed(3));

export function juiceLotSg(l) {
  if (cnum(l.sg) != null) return Number(l.sg);
  if (cnum(l.brix) != null) return brixToSg(Number(l.brix));
  return null;
}

// Pectic enzyme rate (g per 100L) — product-specific, so whatever was last
// typed is remembered on this device and used as the default next time.
const ENZYME_KEY = "bp.cider.enzymeRate";
const DEFAULT_ENZYME_RATE = "3";
function savedEnzymeRate() {
  try { return localStorage.getItem(ENZYME_KEY) || DEFAULT_ENZYME_RATE; } catch { return DEFAULT_ENZYME_RATE; }
}
function rememberEnzymeRate(v) {
  try { if (v) localStorage.setItem(ENZYME_KEY, v); } catch { /* storage unavailable */ }
}
// Most recent pH on the batch: tank readings, lab measurements, then the juice.
function latestBatchPh(batch) {
  if (!batch) return null;
  const pts = [
    ...(batch.readings || []).filter((r) => r && r.ph != null && !isNaN(Number(r.ph))).map((r) => ({ at: r.date || r.at || "", ph: Number(r.ph) })),
    ...(batch.labMeasurements || []).filter((m) => m && m.ph != null && m.ph !== "" && !isNaN(Number(m.ph))).map((m) => ({ at: m.date || m.at || "", ph: Number(m.ph) })),
  ].sort((a, b) => String(b.at).localeCompare(String(a.at)));
  if (pts.length) return pts[0].ph;
  const j = juiceSummary(batch.juiceIntake);
  return j.ph != null ? j.ph : null;
}
const ASSUMED_PH = 3.5;

export function juiceSummary(lots) {
  const parts = (lots || []).map((l) => ({ litres: Number(l.litres) || 0, sg: juiceLotSg(l), ph: cnum(l.ph), ta: cnum(l.ta) }));
  const litres = parts.reduce((s, p) => s + p.litres, 0);
  const sg = weighted(parts, "sg");
  const phParts = parts.filter((p) => p.ph != null && p.litres > 0);
  return { litres, sg, brix: sg != null ? sgToBrix(sg) : null, ph: phParts.length ? blendPh(phParts) : null, ta: weighted(parts, "ta") };
}

export const ciderCard = { background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "14px 14px", marginBottom: 14 };
export const ciderHead = { fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 };
export const ciderNote = { fontSize: 12, color: "#5C6B54", lineHeight: 1.5 };
export const ciderWarn = { fontSize: 12.5, color: "#7A3E1D", background: "#FBE5D2", border: "1px solid #E3B37A", borderRadius: 6, padding: "9px 11px", lineHeight: 1.5 };
export const ciderBtn = { background: "#5C9A3C", border: "none", borderRadius: 5, padding: "10px 14px", color: "#16191A", fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 13.5, cursor: "pointer" };
export const ciderBtn2 = { background: "#FFFFFF", border: "1px solid #C9D1AC", borderRadius: 5, padding: "8px 12px", color: "#2A3324", fontFamily: "'Inter', sans-serif", fontSize: 12.5, cursor: "pointer" };
export const grid2 = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 };

export function CiderStat({ label, value }) {
  return (
    <div style={{ background: "#F8F5EA", border: "1px solid #EBE8D6", borderRadius: 5, padding: "8px 10px" }}>
      <div style={{ fontSize: 10.5, letterSpacing: "0.05em", textTransform: "uppercase", color: "#9BA88A" }}>{label}</div>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 16, color: "#2A3324", marginTop: 2 }}>{value}</div>
    </div>
  );
}

// A calculated dose with a "Log on batch" action that records it as a batch
// addition and takes it out of stock (converted into the item's own unit).
export function DoseRow({ label, grams, detail, batch, inventory, onLogAddition, guess }) {
  const [itemId, setItemId] = useState(() => inventory.find((it) => guess && guess.test(it.name))?.id || "");
  const [done, setDone] = useState(false);
  if (grams == null || !(grams > 0)) return null;
  const item = inventory.find((it) => it.id === itemId);
  const f = item ? unitFactor("g", item.unit) : null;
  return (
    <div style={{ borderTop: "1px solid #EEF0E2", padding: "10px 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
        <span style={{ fontSize: 13.5, color: "#2A3324" }}>{label}</span>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 15, color: "#2A3324", whiteSpace: "nowrap" }}>
          {grams >= 1000 ? `${r3c(grams / 1000)} kg` : `${r1(grams)} g`}
        </span>
      </div>
      {detail && <div style={{ ...ciderNote, marginTop: 2 }}>{detail}</div>}
      {batch && onLogAddition && (
        <div style={{ display: "flex", gap: 6, marginTop: 8, alignItems: "center" }}>
          <select value={itemId} onChange={(e) => setItemId(e.target.value)} style={{ flex: 1, minWidth: 0, background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 4, padding: "7px 8px", fontSize: 12.5, color: "#2A3324" }}>
            <option value="">Pick the stock item…</option>
            {inventory.map((it) => (
              <option key={it.id} value={it.id}>{it.name} ({it.qty}{it.unit})</option>
            ))}
          </select>
          <button
            type="button"
            disabled={!item || f == null || done}
            onClick={async () => {
              await onLogAddition(batch.id, { name: item.name, qty: r3c(grams * f), unit: item.unit, note: label, date: today() });
              setDone(true);
            }}
            style={{ ...ciderBtn2, opacity: !item || f == null || done ? 0.5 : 1, whiteSpace: "nowrap" }}
          >
            {done ? "Logged ✓" : "Log on batch"}
          </button>
        </div>
      )}
      {item && f == null && <div style={{ fontSize: 11.5, color: "#B5502F", marginTop: 4 }}>{item.name} is counted in {item.unit}, so it can't be logged in grams.</div>}
    </div>
  );
}

export function CiderJuiceTab({ batch, onSaveCider, onSetBatchFigures }) {
  const blank = { date: today(), variety: "", orchard: "", litres: "", mode: "brix", value: "", ph: "", ta: "" };
  const [draft, setDraft] = useState(blank);
  const [fg, setFg] = useState("1.000");
  const lots = batch?.juiceIntake || [];
  const sum = juiceSummary(lots);
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const add = async () => {
    if (!batch || !(Number(draft.litres) > 0)) return;
    const lot = {
      id: uid(),
      date: draft.date || today(),
      variety: draft.variety.trim(),
      orchard: draft.orchard.trim(),
      litres: Number(draft.litres),
      brix: draft.mode === "brix" ? cnum(draft.value) : null,
      sg: draft.mode === "sg" ? cnum(draft.value) : null,
      ph: cnum(draft.ph),
      ta: cnum(draft.ta),
    };
    await onSaveCider(batch.id, { juiceIntake: [...lots, lot] });
    setDraft({ ...blank, orchard: draft.orchard, date: draft.date });
  };
  const remove = (id) => onSaveCider(batch.id, { juiceIntake: lots.filter((l) => l.id !== id) });
  const potential = sum.sg != null && cnum(fg) != null ? abvFrom(sum.sg, Number(fg)) : null;

  if (!batch) return <div style={ciderNote}>Pick or start a cider batch above to log juice against it.</div>;
  return (
    <>
      <div style={ciderCard}>
        <div style={ciderHead}>Juice in {batch.name}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 10 }}>
          <CiderStat label="Litres" value={r1(sum.litres)} />
          <CiderStat label="SG" value={fmtSg(sum.sg)} />
          <CiderStat label="Brix" value={sum.brix != null ? r1(sum.brix) : "—"} />
          <CiderStat label="pH" value={sum.ph != null ? sum.ph.toFixed(2) : "—"} />
          <CiderStat label="TA g/L" value={sum.ta != null ? r1(sum.ta) : "—"} />
          <CiderStat label="ABV if dry" value={potential != null ? `${r1(potential)}%` : "—"} />
        </div>
        <div style={{ ...grid2, alignItems: "end" }}>
          <NumberField label="Expected final SG" value={fg} onChange={setFg} step="0.001" />
          {sum.sg != null && (
            <button type="button" onClick={() => onSetBatchFigures(batch.id, { og: r3c(sum.sg), fg: cnum(fg) ?? batch.fg, volume: r1(sum.litres) })} style={ciderBtn2}>
              Set batch OG, FG &amp; volume
            </button>
          )}
        </div>
        {sum.ph != null && sum.ph > 3.8 && <div style={{ ...ciderWarn, marginTop: 10 }}>pH {sum.ph.toFixed(2)} is high for cider — sulphite works poorly above 3.8. Consider adding malic acid, or blending with a sharper juice.</div>}
        {lots.length > 0 && (
          <div style={{ marginTop: 12 }}>
            {lots.map((l) => {
              const sg = juiceLotSg(l);
              return (
                <div key={l.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, borderTop: "1px solid #EEF0E2", padding: "8px 0", fontSize: 12.5, color: "#2A3324" }}>
                  <span>
                    {l.variety || "Juice"}{l.orchard ? ` · ${l.orchard}` : ""}
                    <span style={{ display: "block", color: "#9BA88A", fontSize: 11.5 }}>
                      {l.date} · {l.litres}L · SG {fmtSg(sg)}{l.brix != null ? ` (${l.brix}°Bx)` : ""}{l.ph != null ? ` · pH ${l.ph}` : ""}{l.ta != null ? ` · TA ${l.ta}` : ""}
                    </span>
                  </span>
                  <button type="button" onClick={() => remove(l.id)} aria-label="Remove" style={{ background: "none", border: "none", color: "#9BA88A", cursor: "pointer" }}><Trash2 size={14} /></button>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div style={ciderCard}>
        <div style={ciderHead}>Add juice</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={grid2}>
            <TextField label="Apple / pear variety" value={draft.variety} onChange={(v) => set({ variety: v })} />
            <TextField label="Orchard" value={draft.orchard} onChange={(v) => set({ orchard: v })} />
          </div>
          <div style={grid2}>
            <NumberField label="Litres" value={draft.litres} onChange={(v) => set({ litres: v })} suffix="L" />
            <TextField label="Date" type="date" value={draft.date} onChange={(v) => set({ date: v })} />
          </div>
          <div style={{ display: "flex", border: "1px solid #DDE0C8", borderRadius: 4, overflow: "hidden" }}>
            {[["brix", "Brix (refractometer)"], ["sg", "SG (hydrometer)"]].map(([m, label]) => (
              <button key={m} type="button" onClick={() => set({ mode: m })} style={{ flex: 1, background: draft.mode === m ? "#5C9A3C" : "#F5F1E4", border: "none", padding: 8, fontSize: 12.5, color: draft.mode === m ? "#16191A" : "#5C6B54", cursor: "pointer" }}>{label}</button>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <NumberField label={draft.mode === "brix" ? "Brix" : "SG"} value={draft.value} onChange={(v) => set({ value: v })} step={draft.mode === "brix" ? "0.1" : "0.001"} />
            <NumberField label="pH" value={draft.ph} onChange={(v) => set({ ph: v })} step="0.01" />
            <NumberField label="TA g/L" value={draft.ta} onChange={(v) => set({ ta: v })} step="0.1" />
          </div>
          <div style={ciderNote}>TA as g/L malic acid. Leave anything you haven't measured blank.</div>
          <button type="button" onClick={add} disabled={!(Number(draft.litres) > 0)} style={{ ...ciderBtn, opacity: Number(draft.litres) > 0 ? 1 : 0.5 }}>Add juice</button>
        </div>
      </div>
    </>
  );
}

export function CiderAdditionsTab({ batch, inventory, onLogAddition }) {
  const sum = juiceSummary(batch?.juiceIntake);
  const [litres, setLitres] = useState(String(batch ? sum.litres || batch.volume || "" : ""));
  const [ph, setPh] = useState(sum.ph != null ? sum.ph.toFixed(2) : "");
  const [sg, setSg] = useState(sum.sg != null ? sum.sg.toFixed(3) : batch?.og ? String(batch.og) : "");
  const [molecular, setMolecular] = useState("0.8");
  const [existingFree, setExistingFree] = useState("");
  const [targetAbv, setTargetAbv] = useState("");
  const [fg, setFg] = useState("1.000");
  const [enzymeRate, setEnzymeRateRaw] = useState(savedEnzymeRate);
  const setEnzymeRate = (v) => { setEnzymeRateRaw(v); rememberEnzymeRate(v); };
  const [nutrientRate, setNutrientRate] = useState("");
  const L = cnum(litres) || 0;
  const phN = cnum(ph);
  const freeNeeded = phN != null && cnum(molecular) != null ? freeSo2For(phN, Number(molecular)) : null;
  const freeToAdd = freeNeeded != null ? Math.max(0, freeNeeded - (cnum(existingFree) || 0)) : null;
  const kmeta = freeToAdd != null && L ? kmetaGrams(freeToAdd, L) : null;
  const sgN = cnum(sg);
  const targetOg = cnum(targetAbv) != null && cnum(fg) != null ? Number(fg) + Number(targetAbv) / 131.25 : null;
  const sugarGL = targetOg != null && sgN != null ? ((targetOg - sgN) * 1000) / SUGAR_POINTS_PER_G_L : null;
  const sugar = sugarGL != null && sugarGL > 0 && L ? sugarGL * L : null;
  return (
    <>
      <div style={ciderCard}>
        <div style={ciderHead}>Juice to treat</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          <NumberField label="Litres" value={litres} onChange={setLitres} suffix="L" />
          <NumberField label="pH" value={ph} onChange={setPh} step="0.01" />
          <NumberField label="SG now" value={sg} onChange={setSg} step="0.001" />
        </div>
        {batch && sum.litres > 0 && <div style={{ ...ciderNote, marginTop: 8 }}>Filled in from the juice logged on {batch.name}.</div>}
      </div>

      <div style={ciderCard}>
        <div style={ciderHead}>Sulphite (potassium metabisulfite)</div>
        <div style={grid2}>
          <NumberField label="Molecular SO₂ target" value={molecular} onChange={setMolecular} step="0.1" suffix="mg/L" />
          <NumberField label="Free SO₂ already in" value={existingFree} onChange={setExistingFree} step="1" suffix="mg/L" />
        </div>
        {phN != null && phN > 3.8 && <div style={{ ...ciderWarn, marginTop: 10 }}>At pH {phN.toFixed(2)} you'd need a lot of sulphite to protect the juice. Lower the pH (malic acid or a sharper juice blend) before dosing.</div>}
        {freeNeeded != null && <div style={{ ...ciderNote, marginTop: 8 }}>At pH {phN.toFixed(2)}, {molecular} mg/L molecular needs {Math.round(freeNeeded)} mg/L free SO₂{cnum(existingFree) ? ` — ${Math.round(freeToAdd)} mg/L to add` : ""}. 0.8 is the usual target; 0.5 is common for low-sulphite cider.</div>}
        <DoseRow label="Potassium metabisulfite" grams={kmeta} detail={kmeta ? `${r1((kmeta / L) * 100)} g per 100L. Dissolve in a little water first.` : null} batch={batch} inventory={inventory} onLogAddition={onLogAddition} guess={/metabisul|k-?meta|campden/i} />
        {phN == null && <div style={ciderNote}>Enter the pH to work out the dose.</div>}
      </div>

      <div style={ciderCard}>
        <div style={ciderHead}>Sugar to reach a target ABV</div>
        <div style={grid2}>
          <NumberField label="Target ABV" value={targetAbv} onChange={setTargetAbv} step="0.1" suffix="%" />
          <NumberField label="Expected final SG" value={fg} onChange={setFg} step="0.001" />
        </div>
        {targetOg != null && sgN != null && (
          <div style={{ ...ciderNote, marginTop: 8 }}>
            Needs a starting SG of {fmtSg(targetOg)}.{" "}
            {sugarGL > 0 ? `That's ${r1(sugarGL)} g/L of sugar.` : `The juice is already at or above that (would reach about ${r1(abvFrom(sgN, Number(fg)))}% dry).`}
          </div>
        )}
        <DoseRow label="Sugar (sucrose)" grams={sugar} batch={batch} inventory={inventory} onLogAddition={onLogAddition} guess={/^sugar|sucrose|dextrose/i} />
      </div>

      <div style={ciderCard}>
        <div style={ciderHead}>Pectic enzyme &amp; yeast nutrient</div>
        <div style={grid2}>
          <NumberField label="Enzyme rate" value={enzymeRate} onChange={setEnzymeRate} step="0.1" suffix="g/hL" />
          <NumberField label="Nutrient rate" value={nutrientRate} onChange={setNutrientRate} step="1" suffix="g/hL" />
        </div>
        <div style={{ ...ciderNote, marginTop: 8 }}>Rates vary a lot between products — use the dose on your product's label (g per 100L).</div>
        <DoseRow label="Pectic enzyme" grams={cnum(enzymeRate) && L ? (Number(enzymeRate) * L) / 100 : null} batch={batch} inventory={inventory} onLogAddition={onLogAddition} guess={/pectic|pectin|enzyme|lallzyme/i} />
        <DoseRow label="Yeast nutrient" grams={cnum(nutrientRate) && L ? (Number(nutrientRate) * L) / 100 : null} batch={batch} inventory={inventory} onLogAddition={onLogAddition} guess={/nutrient|fermaid|yeast vit|dap/i} />
      </div>
    </>
  );
}

export function CiderBlendTab({ ciderBatches, onSaveCider }) {
  const blankRow = () => ({ id: uid(), batchId: "", name: "", litres: "", abv: "", sg: "", ph: "", ta: "" });
  const [rows, setRows] = useState([blankRow(), blankRow()]);
  const [targetAbv, setTargetAbv] = useState("");
  const [targetLitres, setTargetLitres] = useState("");
  const [destId, setDestId] = useState("");
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState(false);
  const update = (id, patch) => { setRows((p) => p.map((r) => (r.id === id ? { ...r, ...patch } : r))); setSaved(false); };
  const fromBatch = (id, batchId) => {
    const b = ciderBatches.find((x) => x.id === batchId);
    if (!b) return update(id, { batchId: "" });
    const latest = b.og ? latestReading(b) : null;
    const curSg = latest && latest.gravity != null ? latest.gravity : null;
    const abv = b.labelAbv || (b.og && curSg ? calcABV(b.og, curSg) : null);
    const j = juiceSummary(b.juiceIntake);
    update(id, {
      batchId,
      name: b.name,
      litres: String(remainingVolume(b) || b.volume || ""),
      abv: abv != null ? String(r1(abv)) : "",
      sg: curSg != null ? String(curSg) : "",
      ph: j.ph != null ? j.ph.toFixed(2) : "",
      ta: j.ta != null ? String(r1(j.ta)) : "",
    });
  };
  const parts = rows.map((r) => ({ litres: cnum(r.litres) || 0, abv: cnum(r.abv), sg: cnum(r.sg), ph: cnum(r.ph), ta: cnum(r.ta) })).filter((p) => p.litres > 0);
  const total = parts.reduce((s, p) => s + p.litres, 0);
  const res = { litres: total, abv: weighted(parts, "abv"), sg: weighted(parts, "sg"), ph: parts.some((p) => p.ph != null) ? blendPh(parts.filter((p) => p.ph != null)) : null, ta: weighted(parts, "ta") };
  // Two-part solver: how much of each to hit the target ABV.
  const two = rows.filter((r) => cnum(r.abv) != null).slice(0, 2);
  let solve = null;
  if (two.length === 2 && cnum(targetAbv) != null) {
    const a = Number(two[0].abv), b = Number(two[1].abv), t = Number(targetAbv);
    if (a !== b && t >= Math.min(a, b) && t <= Math.max(a, b)) {
      const fa = (t - b) / (a - b);
      const vol = cnum(targetLitres) || (cnum(two[0].litres) || 0) + (cnum(two[1].litres) || 0);
      solve = { fa, a: two[0], b: two[1], la: fa * vol, lb: (1 - fa) * vol, vol };
    } else if (a !== b) solve = { outOfRange: true, a, b };
  }
  const save = async () => {
    const dest = ciderBatches.find((b) => b.id === destId);
    if (!dest || !total) return;
    const entry = {
      id: uid(),
      date: today(),
      components: rows.filter((r) => cnum(r.litres) > 0).map((r) => ({ batchId: r.batchId || null, name: r.name || "Unnamed", litres: cnum(r.litres), abv: cnum(r.abv), sg: cnum(r.sg), ph: cnum(r.ph), ta: cnum(r.ta) })),
      result: { litres: r1(res.litres), abv: res.abv != null ? r1(res.abv) : null, sg: res.sg != null ? r3c(res.sg) : null, ph: res.ph != null ? Math.round(res.ph * 100) / 100 : null, ta: res.ta != null ? r1(res.ta) : null },
      note: note.trim(),
    };
    await onSaveCider(dest.id, { blendLog: [...(dest.blendLog || []), entry] });
    setSaved(true);
  };
  return (
    <>
      <div style={ciderCard}>
        <div style={ciderHead}>What goes in</div>
        {rows.map((r, i) => (
          <div key={r.id} style={{ borderTop: i ? "1px solid #EEF0E2" : "none", paddingTop: i ? 12 : 0, marginTop: i ? 12 : 0, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <select value={r.batchId} onChange={(e) => fromBatch(r.id, e.target.value)} style={{ flex: 1, minWidth: 0, background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 4, padding: "8px 9px", fontSize: 13, color: "#2A3324" }}>
                <option value="">{r.name && !r.batchId ? r.name : "Pick a cider batch, or type figures in"}</option>
                {ciderBatches.map((b) => <option key={b.id} value={b.id}>{b.name} (#{b.number})</option>)}
              </select>
              {rows.length > 2 && <button type="button" onClick={() => setRows((p) => p.filter((x) => x.id !== r.id))} aria-label="Remove" style={{ background: "none", border: "none", color: "#9BA88A", cursor: "pointer" }}><Trash2 size={15} /></button>}
            </div>
            {!r.batchId && <TextField label="Name" value={r.name} onChange={(v) => update(r.id, { name: v })} />}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
              <NumberField label="Litres" value={r.litres} onChange={(v) => update(r.id, { litres: v })} />
              <NumberField label="ABV %" value={r.abv} onChange={(v) => update(r.id, { abv: v })} step="0.1" />
              <NumberField label="SG" value={r.sg} onChange={(v) => update(r.id, { sg: v })} step="0.001" />
              <NumberField label="pH" value={r.ph} onChange={(v) => update(r.id, { ph: v })} step="0.01" />
              <NumberField label="TA g/L" value={r.ta} onChange={(v) => update(r.id, { ta: v })} step="0.1" />
            </div>
          </div>
        ))}
        <button type="button" onClick={() => setRows((p) => [...p, blankRow()])} style={{ ...ciderBtn2, marginTop: 12 }}>+ Add another</button>
      </div>

      <div style={ciderCard}>
        <div style={ciderHead}>Blend result</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
          <CiderStat label="Litres" value={r1(res.litres)} />
          <CiderStat label="ABV" value={res.abv != null ? `${r1(res.abv)}%` : "—"} />
          <CiderStat label="SG" value={fmtSg(res.sg)} />
          <CiderStat label="pH" value={res.ph != null ? res.ph.toFixed(2) : "—"} />
          <CiderStat label="TA g/L" value={res.ta != null ? r1(res.ta) : "—"} />
        </div>
        <div style={{ ...ciderNote, marginTop: 8 }}>pH is blended by acidity, not a straight average, but is still an estimate — measure the blend before you rely on it.</div>
      </div>

      <div style={ciderCard}>
        <div style={ciderHead}>Hit a target ABV (first two with an ABV)</div>
        <div style={grid2}>
          <NumberField label="Target ABV" value={targetAbv} onChange={setTargetAbv} step="0.1" suffix="%" />
          <NumberField label="Total litres wanted" value={targetLitres} onChange={setTargetLitres} suffix="L" />
        </div>
        {solve && !solve.outOfRange && (
          <div style={{ fontSize: 13, color: "#2A3324", marginTop: 10, lineHeight: 1.6 }}>
            {r1(solve.la)}L of {solve.a.name || "the first"} ({Math.round(solve.fa * 100)}%) + {r1(solve.lb)}L of {solve.b.name || "the second"} ({Math.round((1 - solve.fa) * 100)}%) = {r1(solve.vol)}L at {targetAbv}%.
            {(solve.la > (cnum(solve.a.litres) || Infinity) || solve.lb > (cnum(solve.b.litres) || Infinity)) && <div style={{ ...ciderWarn, marginTop: 8 }}>That's more than you've entered for one of them — lower the total litres.</div>}
          </div>
        )}
        {solve && solve.outOfRange && <div style={{ ...ciderWarn, marginTop: 10 }}>The target has to sit between {solve.a}% and {solve.b}%.</div>}
      </div>

      <div style={ciderCard}>
        <div style={ciderHead}>Record this blend</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <select value={destId} onChange={(e) => { setDestId(e.target.value); setSaved(false); }} style={{ background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 4, padding: "9px 10px", fontSize: 13.5, color: "#2A3324" }}>
            <option value="">Batch the blend ends up in…</option>
            {ciderBatches.map((b) => <option key={b.id} value={b.id}>{b.name} (#{b.number})</option>)}
          </select>
          <TextField label="Note (optional)" value={note} onChange={(v) => { setNote(v); setSaved(false); }} />
          <button type="button" onClick={save} disabled={!destId || !total || saved} style={{ ...ciderBtn, opacity: !destId || !total || saved ? 0.5 : 1 }}>{saved ? "Blend recorded ✓" : "Record blend"}</button>
          <div style={ciderNote}>This keeps a dated record of what went in and the result. It doesn't move litres between batches — update volumes on the batches themselves.</div>
        </div>
      </div>
    </>
  );
}

// Plan a cider from the finish: how many litres you want, the ABV and the
// sweetness. Ferments juice dry, then back-sweetens with juice — works out
// the juice to ferment, the juice to keep back, and any sugar or water.
export const SWEETNESS_PRESETS = [
  ["Dry", 1.0],
  ["Off-dry", 1.005],
  ["Medium", 1.012],
  ["Sweet", 1.02],
];

export function planCider({ finalL, abv, targetSg, dryFg, lossPct, fermSg, sweetSg, allowWater }) {
  if (!(finalL > 0) || !(abv > 0) || fermSg == null) return null;
  const fd = dryFg ?? 1.0;
  const sweetNeeded = targetSg > fd + 0.0005;
  if (sweetNeeded && (sweetSg == null || sweetSg <= targetSg)) return { error: "The sweetening juice has to be sweeter than the target SG." };
  const x = sweetNeeded ? (targetSg - fd) / (sweetSg - fd) : 0; // share of the finished cider that's sweetening juice
  const sweetL = x * finalL;
  const fermentedL = finalL - sweetL; // dry cider needed after losses
  const intoTankL = fermentedL / (1 - Math.min(0.5, Math.max(0, lossPct / 100)));
  const fermAbv = abv / (1 - x);
  const og = fd + fermAbv / 131.25;
  const out = { x, sweetL, fermentedL, intoTankL, fermAbv, og, sugarG: 0, waterL: 0, juiceL: intoTankL, finalAbv: abv, fd };
  if (fermSg < og - 0.0015) {
    out.sugarG = ((og - fermSg) * 1000 / SUGAR_POINTS_PER_G_L) * intoTankL;
  } else if (fermSg > og + 0.0015) {
    if (allowWater) {
      const w = (fermSg - og) / (fermSg - 1.0);
      out.waterL = w * intoTankL;
      out.juiceL = intoTankL - out.waterL;
    } else {
      out.tooStrong = true;
      out.og = fermSg;
      out.fermAbv = (fermSg - fd) * 131.25;
      out.finalAbv = out.fermAbv * (1 - x);
    }
  }
  return out;
}

export function CiderPlanTab({ inventory, onStartFromPlan }) {
  const juiceItems = inventory.filter((it) => it.category === "Juice" || /juice/i.test(it.name));
  const [finalL, setFinalL] = useState("240");
  const [abv, setAbv] = useState("4.5");
  const [targetSg, setTargetSg] = useState("1.012");
  const [dryFg, setDryFg] = useState("1.000");
  const [lossPct, setLossPct] = useState("8");
  const [fermId, setFermId] = useState("");
  const [sweetId, setSweetId] = useState("");
  const [fermSgIn, setFermSgIn] = useState("");
  const [sweetSgIn, setSweetSgIn] = useState("");
  const [allowWater, setAllowWater] = useState(false);
  const ferm = inventory.find((x) => x.id === fermId) || null;
  const sweet = inventory.find((x) => x.id === (sweetId || fermId)) || null;
  useEffect(() => { if (ferm?.juiceSg) setFermSgIn(String(ferm.juiceSg)); }, [fermId]);
  useEffect(() => { if (sweet?.juiceSg) setSweetSgIn(String(sweet.juiceSg)); }, [sweetId, fermId]);
  const fermSg = cnum(fermSgIn);
  const sweetSg = cnum(sweetSgIn) ?? fermSg;
  const plan = planCider({ finalL: cnum(finalL), abv: cnum(abv), targetSg: cnum(targetSg) ?? 1.0, dryFg: cnum(dryFg), lossPct: cnum(lossPct) ?? 0, fermSg, sweetSg, allowWater });
  const sameItem = sweet && ferm && sweet.id === ferm.id;
  const needFerm = plan && !plan.error ? plan.juiceL + (sameItem ? plan.sweetL : 0) : 0;
  const litresIn = (it) => (it ? (unitFactor(it.unit, "L") != null ? it.qty * unitFactor(it.unit, "L") : null) : null);
  const short = (it, need) => it && litresIn(it) != null && need > litresIn(it) + 0.01;
  const fmtL = (l) => `${r1(l)}L`;
  const line = { fontSize: 13.5, color: "#2A3324", lineHeight: 1.7 };

  return (
    <>
      <div style={ciderCard}>
        <div style={ciderHead}>What you want at the end</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <NumberField label="Finished litres" value={finalL} onChange={setFinalL} suffix="L" />
          <NumberField label="ABV" value={abv} onChange={setAbv} step="0.1" suffix="%" />
        </div>
        <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B54", margin: "12px 0 6px" }}>Sweetness</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
          {SWEETNESS_PRESETS.map(([label, sg]) => {
            const on = Math.abs((cnum(targetSg) ?? 0) - sg) < 0.0005;
            return <button key={label} type="button" onClick={() => setTargetSg(sg.toFixed(3))} style={{ ...ciderBtn2, background: on ? "#5C9A3C" : "#FFFFFF", borderColor: on ? "#5C9A3C" : "#C9D1AC", color: on ? "#16191A" : "#2A3324" }}>{label} {sg.toFixed(3)}</button>;
          })}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          <NumberField label="Target SG" value={targetSg} onChange={setTargetSg} step="0.001" />
          <NumberField label="Ferments dry to" value={dryFg} onChange={setDryFg} step="0.001" />
          <NumberField label="Losses" value={lossPct} onChange={setLossPct} step="1" suffix="%" />
        </div>
        <div style={{ ...ciderNote, marginTop: 6 }}>Losses are lees and packaging — the plan puts that much extra juice in the tank.</div>
      </div>

      <div style={ciderCard}>
        <div style={ciderHead}>Juice from stock</div>
        <div style={{ fontSize: 12.5, color: "#5C6B54", marginBottom: 4 }}>To ferment</div>
        <StockSearchPick inventory={juiceItems.length ? juiceItems : inventory} value={fermId} onChange={setFermId} placeholder="Search juice…" preferCategory="Juice" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, margin: "8px 0 12px" }}>
          <NumberField label="Its SG" value={fermSgIn} onChange={setFermSgIn} step="0.001" />
        </div>
        <div style={{ fontSize: 12.5, color: "#5C6B54", marginBottom: 4 }}>To sweeten with (blank = same juice)</div>
        <StockSearchPick inventory={juiceItems.length ? juiceItems : inventory} value={sweetId} onChange={setSweetId} placeholder="Same as above, or search…" preferCategory="Juice" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 8 }}>
          <NumberField label="Its SG" value={sweetSgIn} onChange={setSweetSgIn} step="0.001" />
        </div>
        {(ferm && !ferm.juiceSg) && <div style={{ ...ciderNote, marginTop: 8 }}>Tip: add the gravity to {ferm.name} in Inventory (pencil → Juice gravity) and it fills in here next time.</div>}
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#2A3324", marginTop: 10 }}>
          <input type="checkbox" checked={allowWater} onChange={(e) => setAllowWater(e.target.checked)} style={{ width: 18, height: 18, accentColor: "#5C9A3C" }} />
          Allow water to bring a strong juice down
        </label>
      </div>

      <div style={ciderCard}>
        <div style={ciderHead}>The plan</div>
        {!plan && <div style={ciderNote}>Enter the finished litres, ABV and the juice's SG.</div>}
        {plan?.error && <div style={ciderWarn}>{plan.error}</div>}
        {plan && !plan.error && (
          <>
            <div style={line}>
              <div>1. Ferment <strong>{fmtL(plan.juiceL)}</strong> of {ferm ? ferm.name : "juice"}{plan.waterL > 0 ? <> + <strong>{fmtL(plan.waterL)}</strong> water</> : null}{plan.sugarG > 0 ? <> + <strong>{plan.sugarG >= 1000 ? `${r3c(plan.sugarG / 1000)} kg` : `${r1(plan.sugarG)} g`}</strong> sugar</> : null} — OG {fmtSg(plan.og)}, about {r1(plan.fermAbv)}% when dry.</div>
              {plan.sweetL > 0.05 && <div>2. Keep back <strong>{fmtL(plan.sweetL)}</strong> of {sweet ? sweet.name : "juice"} (chilled) to sweeten with.</div>}
              <div>{plan.sweetL > 0.05 ? "3" : "2"}. {plan.sweetL > 0.05 ? `Blend ${fmtL(plan.fermentedL)} of the dry cider with the kept-back juice` : `Package ${fmtL(plan.fermentedL)}`} → <strong>{fmtL(cnum(finalL))}</strong> at SG {cnum(targetSg).toFixed(3)} and <strong>{r1(plan.finalAbv)}%</strong>.</div>
            </div>
            {plan.tooStrong && (
              <div style={{ ...ciderWarn, marginTop: 10 }}>
                This juice is too strong for {abv}% — with juice only it comes out about {r1(plan.finalAbv)}%. Tick "Allow water", use a lower-gravity juice to ferment, or aim sweeter.
              </div>
            )}
            {short(ferm, needFerm) && <div style={{ ...ciderWarn, marginTop: 10 }}>Needs {fmtL(needFerm)} of {ferm.name}, but only {fmtL(litresIn(ferm))} is in stock.</div>}
            {!sameItem && short(sweet, plan.sweetL) && <div style={{ ...ciderWarn, marginTop: 10 }}>Needs {fmtL(plan.sweetL)} of {sweet.name}, but only {fmtL(litresIn(sweet))} is in stock.</div>}
            {plan.sweetL > 0.05 && <div style={{ ...ciderNote, marginTop: 8 }}>Sweetened cider must be stabilised (sorbate + sulphite), pasteurised, or kept cold in keg — the Back-sweeten tab works out the doses.</div>}
            <button
              type="button"
              onClick={() =>
                onStartFromPlan({
                  fermItemId: ferm ? ferm.id : "",
                  fermLitres: r1(plan.juiceL),
                  fermSg,
                  waterL: r1(plan.waterL),
                  targetAbvFerm: plan.sugarG > 0 ? r1(plan.fermAbv) : null,
                  fg: plan.fd,
                  plan: {
                    finalL: cnum(finalL), abv: cnum(abv), targetSg: cnum(targetSg), dryFg: plan.fd, lossPct: cnum(lossPct),
                    fermItemId: ferm?.id || null, fermItemName: ferm?.name || null, fermSg, juiceL: r1(plan.juiceL), waterL: r1(plan.waterL), sugarG: r1(plan.sugarG),
                    sweetItemId: sweet?.id || null, sweetItemName: sweet?.name || null, sweetSg, sweetL: r1(plan.sweetL), fermentedL: r1(plan.fermentedL), og: r3c(plan.og), finalAbv: r1(plan.finalAbv),
                  },
                })
              }
              style={{ ...ciderBtn, width: "100%", marginTop: 12 }}
            >
              Start this cider
            </button>
          </>
        )}
      </div>
    </>
  );
}

export function CiderSweetenTab({ batch, inventory, onSaveCider, onRecordSweeten, onLogAddition }) {
  const latest = batch && batch.og ? latestReading(batch) : null;
  const curSg = latest && latest.gravity != null ? latest.gravity : null;
  const j = juiceSummary(batch?.juiceIntake);
  const [litres, setLitres] = useState(batch ? String(remainingVolume(batch) || batch.volume || "") : "");
  const [sg, setSg] = useState(curSg != null ? String(curSg) : "");
  const [abv, setAbv] = useState(batch && batch.og && curSg ? String(r1(calcABV(batch.og, curSg))) : "");
  const knownPh = latestBatchPh(batch);
  const [ph, setPh] = useState(knownPh != null ? knownPh.toFixed(2) : "");
  const planned = batch?.dayRecipe?.plan || null;
  const [targetSg, setTargetSg] = useState(planned?.targetSg != null ? Number(planned.targetSg).toFixed(3) : "1.010");
  const [targetAbv, setTargetAbv] = useState(planned?.abv != null ? String(planned.abv) : "");
  const [method, setMethod] = useState(planned ? "juice" : "sugar");
  // Sweetening juices: any number, each with its own SG. Leave litres blank
  // and the app works them out (shared in proportion to what's in stock);
  // type litres on a juice to fix that one.
  const newJuice = (over = {}) => ({ id: uid(), itemId: "", sg: "", litres: "", ...over });
  const [juices, setJuices] = useState(() => [
    newJuice({ itemId: planned?.sweetItemId || "", sg: planned?.sweetSg != null ? String(planned.sweetSg) : j.sg != null ? j.sg.toFixed(3) : "1.050" }),
  ]);
  const setJuice = (id, patch) => setJuices((p) => p.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const pickJuiceItem = (id, itemId) => {
    const it = inventory.find((x) => x.id === itemId);
    setJuice(id, { itemId, ...(it?.juiceSg ? { sg: String(it.juiceSg) } : {}) });
  };
  const stockL = (it) => (it && unitFactor(it.unit, "L") != null ? it.qty * unitFactor(it.unit, "L") : null);
  const [sorbateRate, setSorbateRate] = useState("200");
  const [molecular, setMolecular] = useState("0.8");
  const [existingFree, setExistingFree] = useState("");
  const [saved, setSaved] = useState(false);
  const L = cnum(litres) || 0;
  const sgN = cnum(sg), tgt = cnum(targetSg), abvN = cnum(abv);
  const phAssumed = cnum(ph) == null;
  const phN = phAssumed ? ASSUMED_PH : cnum(ph);
  const jRows = juices.map((x) => ({ ...x, item: inventory.find((i) => i.id === x.itemId) || null, sgV: cnum(x.sg), fixedL: cnum(x.litres) })).filter((x) => x.sgV != null && x.sgV > 1);
  const fixedRows = jRows.filter((x) => x.fixedL != null && x.fixedL > 0);
  const autoRows = jRows.filter((x) => !(x.fixedL != null && x.fixedL > 0));
  const fixedLsum = fixedRows.reduce((t, x) => t + x.fixedL, 0);
  const fixedPts = fixedRows.reduce((t, x) => t + x.fixedL * (x.sgV - 1), 0);
  const weightOf = (x) => { const st = stockL(x.item); return st != null && st > 0 ? st : 1; };
  const wSum = autoRows.reduce((t, x) => t + weightOf(x), 0);
  const autoSg = autoRows.length ? autoRows.reduce((t, x) => t + weightOf(x) * x.sgV, 0) / wSum : null; // blended SG of the auto juices
  const jsg = jRows.length ? (autoSg ?? fixedRows[0].sgV) : null;
  const pts = sgN != null && tgt != null ? (tgt - sgN) * 1000 : null;
  // With a target ABV too: the finished volume is set by the ABV
  // (V = litres × ABV now ÷ target), then juice or sugar sets the sweetness
  // and water makes up the rest of the volume.
  const tAbv = cnum(targetAbv);
  const byAbv = tAbv != null && abvN != null && tAbv > 0 && tAbv < abvN && L && sgN != null && tgt != null;
  const V = byAbv ? (L * abvN) / tAbv : null;
  let sugarG = null, juiceL = null, waterL = 0, abvNote = null, autoTotal = 0;
  if (byAbv) {
    if (method === "juice" && jRows.length) {
      const need = V * (tgt - 1) - L * (sgN - 1) - fixedPts; // sugar points still to come from the auto juices
      const J = autoRows.length ? need / (autoSg - 1) : 0;
      if (J < -0.05) abvNote = "It's already sweeter than the target once diluted to that ABV" + (fixedRows.length ? " with the litres you've set." : ".");
      else if (L + fixedLsum + Math.max(0, J) > V + 0.05) abvNote = `To reach SG ${tgt.toFixed(3)} with these juices it would end up below ${tAbv}% — about ${r1((L * abvN) / (L + fixedLsum + Math.max(0, J)))}%.`;
      else { juiceL = fixedLsum + Math.max(0, J); waterL = V - L - juiceL; }
      autoTotal = Math.max(0, J);
    } else if (method === "sugar") {
      waterL = V - L;
      const mix = (L * sgN + waterL * 1.0) / V;
      sugarG = tgt > mix ? (((tgt - mix) * 1000) / SUGAR_POINTS_PER_G_L) * V : 0;
    }
  } else {
    sugarG = method === "sugar" && pts > 0 && L ? (pts / SUGAR_POINTS_PER_G_L) * L : null;
    if (method === "juice" && jRows.length && pts > 0 && L) {
      // Solve the auto juices' litres so the mix lands on the target SG.
      const J = autoRows.length ? ((tgt - 1) * (L + fixedLsum) - L * (sgN - 1) - fixedPts) / (autoSg - tgt) : 0;
      if (autoRows.length && autoSg <= tgt) abvNote = "The juice has to be sweeter than the target SG.";
      else if (J < -0.05) abvNote = "The litres you've set already go past the target SG.";
      else { juiceL = fixedLsum + Math.max(0, J); autoTotal = Math.max(0, J); }
    }
  }
  // Share the worked-out litres between the auto juices by stock.
  const juiceLitres = Object.fromEntries(
    jRows.map((x) => [x.id, x.fixedL != null && x.fixedL > 0 ? x.fixedL : autoRows.length && wSum ? (autoTotal * weightOf(x)) / wSum : 0])
  );
  const finalSg = juiceL != null && L ? (L * sgN + jRows.reduce((t, x) => t + (juiceLitres[x.id] || 0) * x.sgV, 0) + (waterL || 0)) / (L + juiceL + (waterL || 0)) : null;
  const finalL = L + (juiceL || 0) + (waterL || 0);
  const finalAbv = abvN != null && finalL ? (abvN * L) / finalL : null;
  const sorbateG = cnum(sorbateRate) && finalL ? (Number(sorbateRate) * finalL) / 1000 : null;
  const freeNeeded = phN != null && cnum(molecular) != null ? freeSo2For(phN, Number(molecular)) : null;
  const freeToAdd = freeNeeded != null ? Math.max(0, freeNeeded - (cnum(existingFree) || 0)) : null;
  const kmeta = freeToAdd != null && finalL ? kmetaGrams(freeToAdd, finalL) : null;
  const record = async () => {
    if (!batch) return;
    const entry = {
      id: uid(),
      date: today(),
      method,
      litresBefore: L,
      sgBefore: sgN,
      targetSg: tgt,
      sugarG: sugarG != null ? r1(sugarG) : null,
      juiceL: juiceL != null ? r1(juiceL) : null,
      juiceSg: method === "juice" && juiceL ? r3c((jRows.reduce((t, x) => t + (juiceLitres[x.id] || 0) * x.sgV, 0)) / juiceL) : null,
      juices: method === "juice" ? jRows.filter((x) => juiceLitres[x.id] > 0).map((x) => ({ itemId: x.item?.id || null, name: x.item?.name || "Juice", sg: x.sgV, litres: r1(juiceLitres[x.id]) })) : null,
      juiceItemName: method === "juice" ? jRows.filter((x) => juiceLitres[x.id] > 0).map((x) => x.item?.name || "juice").join(" + ") || null : null,
      waterL: waterL > 0.05 ? r1(waterL) : null,
      targetAbv: tAbv,
      litresAfter: r1(finalL),
      abvAfter: finalAbv != null ? r1(finalAbv) : null,
      sorbateG: sorbateG != null ? r1(sorbateG) : null,
      kmetaG: kmeta != null ? r1(kmeta) : null,
    };
    const ok = onRecordSweeten ? await onRecordSweeten(batch.id, entry) : await onSaveCider(batch.id, { backSweetenings: [...(batch.backSweetenings || []), entry] });
    if (ok !== false) setSaved(true);
  };
  const history = batch?.backSweetenings || [];
  return (
    <>
      <div style={ciderCard}>
        <div style={ciderHead}>Cider now</div>
        <div style={grid2}>
          <NumberField label="Litres" value={litres} onChange={setLitres} suffix="L" />
          <NumberField label="SG now" value={sg} onChange={setSg} step="0.001" />
          <NumberField label="ABV now" value={abv} onChange={setAbv} step="0.1" suffix="%" />
          <NumberField label="pH" value={ph} onChange={setPh} step="0.01" />
        </div>
      </div>
      <div style={ciderCard}>
        <div style={ciderHead}>Back-sweeten</div>
        {planned && <div style={{ ...ciderNote, marginBottom: 8 }}>Planned when started: {planned.finalL}L at {planned.abv}% and SG {Number(planned.targetSg).toFixed(3)}{planned.sweetL ? `, sweetened with ${planned.sweetL}L of ${planned.sweetItemName || "juice"}` : ""}.</div>}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
          {SWEETNESS_PRESETS.map(([label, v]) => {
            const on = Math.abs((cnum(targetSg) ?? 0) - v) < 0.0005;
            return <button key={label} type="button" onClick={() => setTargetSg(v.toFixed(3))} style={{ ...ciderBtn2, padding: "6px 10px", background: on ? "#5C9A3C" : "#FFFFFF", borderColor: on ? "#5C9A3C" : "#C9D1AC", color: on ? "#16191A" : "#2A3324" }}>{label}</button>;
          })}
        </div>
        <div style={grid2}>
          <NumberField label="Target SG" value={targetSg} onChange={setTargetSg} step="0.001" />
          <NumberField label="Target ABV (optional)" value={targetAbv} onChange={setTargetAbv} step="0.1" suffix="%" />
        </div>
        <div style={{ ...ciderNote, margin: "6px 0 10px" }}>Roughly: 1.000–1.005 dry, 1.005–1.012 medium, 1.012+ sweet. Add a target ABV to bring a strong cider down at the same time.</div>
        <div style={{ display: "flex", border: "1px solid #DDE0C8", borderRadius: 4, overflow: "hidden", marginBottom: 10 }}>
          {[["sugar", "With sugar"], ["juice", "With juice"]].map(([m, label]) => (
            <button key={m} type="button" onClick={() => setMethod(m)} style={{ flex: 1, background: method === m ? "#5C9A3C" : "#F5F1E4", border: "none", padding: 8, fontSize: 12.5, color: method === m ? "#16191A" : "#5C6B54", cursor: "pointer" }}>{label}</button>
          ))}
        </div>
        {method === "juice" && (
          <>
            {juices.map((x, i) => {
              const it = inventory.find((z) => z.id === x.itemId);
              const st = stockL(it);
              const use = juiceLitres[x.id];
              return (
                <div key={x.id} style={{ border: "1px solid #EBE8D6", borderRadius: 5, padding: 9, marginBottom: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <StockSearchPick inventory={inventory.filter((z) => z.category === "Juice" || /juice/i.test(z.name))} value={x.itemId} onChange={(v) => pickJuiceItem(x.id, v)} placeholder={`Juice ${i + 1} from stock (optional)`} preferCategory="Juice" />
                    </div>
                    {juices.length > 1 && <button type="button" onClick={() => setJuices((p) => p.filter((z) => z.id !== x.id))} aria-label="Remove" style={{ background: "none", border: "none", color: "#9BA88A", cursor: "pointer" }}><Trash2 size={15} /></button>}
                  </div>
                  <div style={grid2}>
                    <NumberField label="SG" value={x.sg} onChange={(v) => setJuice(x.id, { sg: v })} step="0.001" />
                    <NumberField label="Litres (blank = work out)" value={x.litres} onChange={(v) => setJuice(x.id, { litres: v })} step="0.5" suffix="L" />
                  </div>
                  {use > 0 && (
                    <div style={{ fontSize: 12.5, color: st != null && use > st + 0.01 ? "#B5502F" : "#3F7A28" }}>
                      Use {r1(use)}L{st != null ? ` · ${r1(st)}L in stock${use > st + 0.01 ? " — not enough" : ""}` : ""}
                    </div>
                  )}
                </div>
              );
            })}
            <button type="button" onClick={() => setJuices((p) => [...p, newJuice()])} style={{ ...ciderBtn2, marginBottom: 6 }}>+ Another juice</button>
            {autoRows.length > 1 && <div style={ciderNote}>Juices without litres are shared in proportion to what's in stock.</div>}
          </>
        )}
        {abvNote && <div style={{ ...ciderWarn, marginTop: 8 }}>{abvNote}</div>}
        {byAbv && method === "sugar" && waterL > 0.05 && (
          <div style={{ fontSize: 13.5, color: "#2A3324", marginTop: 10, lineHeight: 1.6 }}>
            Add <strong>{r1(waterL)}L</strong> water to bring it to {tAbv}% ({r1(finalL)}L), plus the sugar below.
          </div>
        )}
        {pts != null && pts <= 0 && <div style={{ ...ciderNote, marginTop: 8 }}>It's already at or above the target.</div>}
        {method === "sugar" && <DoseRow label="Sugar to add" grams={sugarG} detail={sugarG ? `${r1(sugarG / L)} g/L` : null} batch={batch} inventory={inventory} onLogAddition={onLogAddition} guess={/^sugar|sucrose/i} />}
        {method === "juice" && juiceL != null && (
          <div style={{ fontSize: 13.5, color: "#2A3324", marginTop: 10, lineHeight: 1.6 }}>
            Add <strong>{r1(juiceL)}L</strong> of juice{waterL > 0.05 ? <> and <strong>{r1(waterL)}L</strong> water</> : null} → {r1(finalL)}L{finalAbv != null ? ` at about ${r1(finalAbv)}% ABV` : ""}{finalSg != null ? `, SG ${finalSg.toFixed(3)}` : ""}.
          </div>
        )}

      </div>
      <div style={ciderCard}>
        <div style={ciderHead}>Stabilise</div>
        <div style={ciderWarn}>Sweetened cider will start fermenting again in the bottle or can unless it's stabilised, pasteurised, or kept cold and kegged. Sorbate only works alongside sulphite, and shouldn't be used if the cider has gone through malolactic fermentation (geranium off-flavour).</div>
        <div style={{ ...grid2, marginTop: 10 }}>
          <NumberField label="Sorbate rate" value={sorbateRate} onChange={setSorbateRate} step="10" suffix="mg/L" />
          <NumberField label="Molecular SO₂" value={molecular} onChange={setMolecular} step="0.1" suffix="mg/L" />
          <NumberField label="Free SO₂ already in" value={existingFree} onChange={setExistingFree} step="1" suffix="mg/L" />
        </div>
        <div style={{ ...ciderNote, marginTop: 6 }}>150–250 mg/L sorbate is the usual range; use more at lower ABV.</div>
        <DoseRow label="Potassium sorbate" grams={sorbateG} batch={batch} inventory={inventory} onLogAddition={onLogAddition} guess={/sorbate/i} />
        <DoseRow label="Potassium metabisulfite" grams={kmeta} detail={freeNeeded != null ? `For ${Math.round(freeNeeded)} mg/L free SO₂ at pH ${phN.toFixed(2)}` : null} batch={batch} inventory={inventory} onLogAddition={onLogAddition} guess={/metabisul|k-?meta|campden/i} />
        {kmeta != null && finalL > 0 && <div style={ciderNote}>That's {r1((kmeta / finalL) * 100)} g per 100L ({Math.round((kmeta * 0.576 * 1000) / finalL)} mg/L SO₂). Dissolve it in a little cooled boiled water and stir it through — add it with the sorbate, after the sweetening.</div>}
        {phAssumed && <div style={ciderWarn}>No pH on this batch yet, so this uses pH {ASSUMED_PH}. Measure it and type it in above — the dose changes a lot with pH.</div>}
        {freeNeeded != null && freeNeeded > 120 && <div style={ciderWarn}>That's a lot of sulphite (cider is limited to 200 mg/kg total SO₂). Lowering the pH first means far less is needed.</div>}
      </div>
      {batch && (
        <div style={ciderCard}>
          <button type="button" onClick={record} disabled={saved || (sugarG == null && juiceL == null && sorbateG == null)} style={{ ...ciderBtn, width: "100%", opacity: saved ? 0.5 : 1 }}>{saved ? "Recorded ✓" : `Record on ${batch.name}`}</button>
          <div style={{ ...ciderNote, marginTop: 6 }}>Adds the juice/water to the batch volume and takes the juice out of stock. Use "Log on batch" above for the sorbate and sulphite.</div>
          {history.length > 0 && (
            <div style={{ marginTop: 12 }}>
              {history.slice().reverse().map((h) => (
                <div key={h.id} style={{ borderTop: "1px solid #EEF0E2", padding: "8px 0", fontSize: 12.5, color: "#2A3324" }}>
                  {h.date} · {h.method === "juice" ? `${h.juiceL}L juice` : `${h.sugarG}g sugar`} to SG {h.targetSg}
                  <span style={{ display: "block", color: "#9BA88A", fontSize: 11.5 }}>
                    {h.litresAfter}L{h.abvAfter != null ? ` · ${h.abvAfter}%` : ""}{h.sorbateG ? ` · sorbate ${h.sorbateG}g` : ""}{h.kmetaG ? ` · K-meta ${h.kmetaG}g` : ""}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}

// "Start today's cider": the recipe is built on the day from the juice that
// actually came in, rather than kept as a fixed recipe — apples change with
// the season. Saves a normal batch, with the day's juice, additions and
// settings recorded on it (dayRecipe), so the next one can start from it.
// Type-to-search stock picker: shows matching items as you type.
export function StockSearchPick({ inventory, value, onChange, placeholder = "Search stock…", preferCategory }) {
  const picked = inventory.find((x) => x.id === value) || null;
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const q = normItemName(query);
  const matches = inventory
    .filter((it) => !q || normItemName(it.name).includes(q) || normItemName(it.category).includes(q))
    .sort((a, b) => (preferCategory ? (b.category === preferCategory) - (a.category === preferCategory) : 0) || a.name.localeCompare(b.name))
    .slice(0, 30);
  const box = { width: "100%", boxSizing: "border-box", background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 4, padding: "9px 10px", color: "#2A3324", fontSize: 13.5, fontFamily: "'Inter', sans-serif" };
  if (picked && !open) {
    return (
      <div style={{ ...box, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{picked.name} <span style={{ color: "#9BA88A", fontSize: 12 }}>({picked.qty}{picked.unit})</span></span>
        <button type="button" onClick={() => { onChange(""); setQuery(""); setOpen(true); }} aria-label="Clear" style={{ background: "none", border: "none", color: "#9BA88A", cursor: "pointer", padding: 0 }}><X size={15} /></button>
      </div>
    );
  }
  return (
    <div style={{ position: "relative" }}>
      <input
        type="text"
        value={query}
        placeholder={placeholder}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={(e) => { setOpen(true); scrollFieldIntoView(e); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        style={box}
      />
      {open && (
        <div style={{ position: "absolute", left: 0, right: 0, top: "100%", zIndex: 5, background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 4, marginTop: 2, maxHeight: 220, overflowY: "auto", boxShadow: "0 4px 12px rgba(0,0,0,0.08)" }}>
          {matches.length === 0 && <div style={{ padding: "8px 10px", fontSize: 12.5, color: "#9BA88A" }}>Nothing in stock matches "{query}".</div>}
          {matches.map((it) => (
            <button
              key={it.id}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); onChange(it.id); setQuery(""); setOpen(false); }}
              style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", borderBottom: "1px solid #EBE8D6", padding: "8px 10px", color: "#2A3324", fontSize: 13, cursor: "pointer" }}
            >
              {it.name} <span style={{ color: "#9BA88A", fontSize: 11 }}>· {it.category} · {it.qty}{it.unit}{it.juiceSg ? ` · SG ${Number(it.juiceSg).toFixed(3)}` : ""}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function CiderDaySheet({ batches, inventory, tanks, nextNumber, onCreate, onClose, prefill = null }) {
  const pastCiders = batches
    .filter((b) => b.productType === CIDER_TYPE && !b.mergedIntoBatchId && (b.dayRecipe || (b.juiceIntake || []).length))
    .sort((a, b) => String(b.startDate).localeCompare(String(a.startDate)));
  const fermenters = tanks.filter((t) => t.type !== "Mash Tun" && t.type !== "Kettle");
  const blankLot = () => ({ id: uid(), variety: "", orchard: "", litres: "", mode: "brix", value: "", ph: "", ta: "", itemId: "", lotId: "" });
  const juiceItems = [...inventory].sort((a, b) => (b.category === "Juice") - (a.category === "Juice") || a.name.localeCompare(b.name));
  const [name, setName] = useState(`Cider ${today()}`);
  const [batchNumber, setBatchNumber] = useState(nextNumber);
  const [startDate, setStartDate] = useState(today());
  const [tankId, setTankId] = useState("");
  const [lots, setLots] = useState(() =>
    prefill
      ? [
          { ...blankLot(), itemId: prefill.fermItemId || "", litres: prefill.fermLitres != null ? String(prefill.fermLitres) : "", mode: "sg", value: prefill.fermSg != null ? String(prefill.fermSg) : "" },
          ...(prefill.waterL > 0 ? [{ ...blankLot(), variety: "Water", litres: String(prefill.waterL), mode: "sg", value: "1.000" }] : []),
        ]
      : [blankLot()]
  );
  const [fg, setFg] = useState(prefill?.fg != null ? Number(prefill.fg).toFixed(3) : "1.000");
  const [targetAbv, setTargetAbv] = useState(prefill?.targetAbvFerm != null ? String(prefill.targetAbvFerm) : "");
  const [molecular, setMolecular] = useState("0.8");
  const [enzymeRate, setEnzymeRateRaw] = useState(savedEnzymeRate);
  const setEnzymeRate = (v) => { setEnzymeRateRaw(v); rememberEnzymeRate(v); };
  const [nutrientRate, setNutrientRate] = useState("");
  const [adds, setAdds] = useState([]); // { id, role, itemId, qty }
  const [notes, setNotes] = useState(() =>
    prefill?.plan
      ? `Plan: ${prefill.plan.finalL}L at ${prefill.plan.abv}%, SG ${Number(prefill.plan.targetSg).toFixed(3)}${prefill.plan.sweetL ? ` — keep ${prefill.plan.sweetL}L ${prefill.plan.sweetItemName || "juice"} back to sweeten` : ""}${prefill.waterL ? ` — ${prefill.waterL}L water in the ferment` : ""}`
      : ""
  );
  const [saving, setSaving] = useState(false);

  const setLot = (id, patch) => setLots((p) => p.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const lotRecords = lots
    .filter((l) => Number(l.litres) > 0)
    .map((l) => {
      const it = inventory.find((x) => x.id === l.itemId);
      const lot = it && (it.lots || []).find((x) => x.id === l.lotId);
      return { id: l.id, date: startDate, variety: l.variety.trim(), orchard: l.orchard.trim(), litres: Number(l.litres), brix: l.mode === "brix" ? cnum(l.value) : null, sg: l.mode === "sg" ? cnum(l.value) : null, ph: cnum(l.ph), ta: cnum(l.ta), itemId: it ? it.id : null, itemName: it ? it.name : null, lotId: lot ? lot.id : null, lotNumber: lot ? lot.lotNumber : null };
    });
  const sum = juiceSummary(lotRecords);
  const L = sum.litres;
  const freeSo2 = sum.ph != null && cnum(molecular) != null ? freeSo2For(sum.ph, Number(molecular)) : null;
  const kmetaG = freeSo2 != null && L ? kmetaGrams(freeSo2, L) : null;
  const targetOg = cnum(targetAbv) != null && cnum(fg) != null ? Number(fg) + Number(targetAbv) / 131.25 : null;
  const sugarG = targetOg != null && sum.sg != null && L && targetOg > sum.sg ? ((targetOg - sum.sg) * 1000 / SUGAR_POINTS_PER_G_L) * L : null;
  const og = sum.sg != null ? (sugarG ? targetOg : sum.sg) : null;
  const enzymeG = cnum(enzymeRate) && L ? (Number(enzymeRate) * L) / 100 : null;
  const nutrientG = cnum(nutrientRate) && L ? (Number(nutrientRate) * L) / 100 : null;
  const calc = { kmeta: kmetaG, sugar: sugarG, enzyme: enzymeG, nutrient: nutrientG };

  // Calculated doses become addition rows once you pick the stock item.
  const ROLES = [
    { role: "kmeta", label: "Potassium metabisulfite", guess: /metabisul|k-?meta|campden/i },
    { role: "sugar", label: "Sugar", guess: /^sugar|sucrose|dextrose/i },
    { role: "enzyme", label: "Pectic enzyme", guess: /pectic|pectin|enzyme|lallzyme/i },
    { role: "nutrient", label: "Yeast nutrient", guess: /nutrient|fermaid|yeast vit|dap/i },
  ];
  const [roleItems, setRoleItems] = useState(() => Object.fromEntries(ROLES.map((r) => [r.role, inventory.find((it) => r.guess.test(it.name))?.id || ""])));
  const [yeastId, setYeastId] = useState("");
  const [yeastQty, setYeastQty] = useState("");

  const loadPast = (id) => {
    const b = pastCiders.find((x) => x.id === id);
    if (!b) return;
    const r = b.dayRecipe || {};
    setLots(((r.lots || b.juiceIntake || []).length ? (r.lots || b.juiceIntake) : [{}]).map((l) => ({ ...blankLot(), variety: l.variety || "", orchard: l.orchard || "", itemId: l.itemId && inventory.some((x) => x.id === l.itemId) ? l.itemId : "", mode: l.sg != null && l.brix == null ? "sg" : "brix" })));
    if (r.fg != null) setFg(String(r.fg));
    setTargetAbv(r.targetAbv != null ? String(r.targetAbv) : "");
    if (r.molecularSo2 != null) setMolecular(String(r.molecularSo2));
    setEnzymeRate(r.enzymeRate != null ? String(r.enzymeRate) : "");
    setNutrientRate(r.nutrientRate != null ? String(r.nutrientRate) : "");
    if (r.roleItems) setRoleItems((p) => ({ ...p, ...r.roleItems }));
    if (r.yeast) { setYeastId(r.yeast.itemId || ""); setYeastQty(r.yeast.qty != null ? String(r.yeast.qty) : ""); }
    setAdds((r.extras || []).map((x) => ({ ...x, id: uid(), qty: "" })));
    setNotes("");
  };

  const itemQtyFromGrams = (itemId, grams) => {
    const it = inventory.find((x) => x.id === itemId);
    const f = it ? unitFactor("g", it.unit) : null;
    return it && f != null && grams ? r3c(grams * f) : null;
  };
  // Juice taken from stock: litres converted into the item's unit, from the chosen lot first.
  const juiceRows = lotRecords
    .filter((l) => l.itemId)
    .map((l) => {
      const it = inventory.find((x) => x.id === l.itemId);
      const f = it ? unitFactor("L", it.unit) : null;
      return it && f != null ? { id: uid(), name: it.name, category: it.category || "Juice", qty: r3c(l.litres * f), unit: it.unit, preferredLotId: l.lotId || undefined, note: `Juice${l.lotNumber ? ` lot ${l.lotNumber}` : ""}` } : null;
    })
    .filter(Boolean);
  const ingredientRows = [
    ...juiceRows,
    ...ROLES.filter((r) => calc[r.role] > 0 && roleItems[r.role]).map((r) => {
      const it = inventory.find((x) => x.id === roleItems[r.role]);
      const qty = itemQtyFromGrams(roleItems[r.role], calc[r.role]);
      return it && qty ? { id: uid(), name: it.name, category: it.category || "Other", qty, unit: it.unit, note: r.label } : null;
    }),
    (() => {
      const it = inventory.find((x) => x.id === yeastId);
      return it && Number(yeastQty) > 0 ? { id: uid(), name: it.name, category: it.category || "Yeast", qty: Number(yeastQty), unit: it.unit } : null;
    })(),
    ...adds.map((a) => {
      const it = inventory.find((x) => x.id === a.itemId);
      return it && Number(a.qty) > 0 ? { id: uid(), name: it.name, category: it.category || "Other", qty: Number(a.qty), unit: it.unit } : null;
    }),
  ].filter(Boolean);

  const tank = tanks.find((t) => t.id === tankId) || null;
  const tooBig = tank && L > Number(tank.capacity || 0);
  const occupied = tank && startDate <= today() && tankIsOccupied(batches, tank.id);
  const numberTaken = batches.some((b) => String(b.number).trim().toLowerCase() === batchNumber.trim().toLowerCase());
  const canSave = name.trim() && batchNumber.trim() && !numberTaken && L > 0 && og != null && !saving && !occupied;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    const dayRecipe = {
      builtOn: startDate,
      lots: lotRecords.map(({ id, ...l }) => l),
      fg: cnum(fg),
      targetAbv: cnum(targetAbv),
      molecularSo2: cnum(molecular),
      enzymeRate: cnum(enzymeRate),
      nutrientRate: cnum(nutrientRate),
      roleItems,
      yeast: yeastId ? { itemId: yeastId, qty: cnum(yeastQty) } : null,
      extras: adds.filter((a) => a.itemId).map((a) => ({ itemId: a.itemId, qty: cnum(a.qty) })),
      plan: prefill?.plan || null,
      calculated: { litres: r1(L), juiceSg: sum.sg != null ? r3c(sum.sg) : null, og: r3c(og), ph: sum.ph != null ? Math.round(sum.ph * 100) / 100 : null, ta: sum.ta != null ? r1(sum.ta) : null, kmetaG: kmetaG ? r1(kmetaG) : null, sugarG: sugarG ? r1(sugarG) : null, abvIfDry: r1(abvFrom(og, Number(fg) || 1)) },
      notes: notes.trim(),
    };
    await onCreate({
      id: uid(),
      number: batchNumber.trim(),
      name: name.trim(),
      style: "Cider",
      productType: CIDER_TYPE,
      volume: r1(L),
      og: r3c(og),
      fg: cnum(fg),
      mashPh: null, mashTemp: null, preBoilGravity: null, topUpWater: null, phIntoTank: sum.ph != null ? Math.round(sum.ph * 100) / 100 : null, sgIntoTank: r3c(og),
      stage: startDate > today() ? "Brewing" : "Primary",
      startDate,
      recipeId: null,
      recipeName: "Built on the day",
      tankId: tank ? tank.id : null,
      tankName: tank ? tank.name : null,
      brewStage: null,
      splitTanks: [],
      ingredients: ingredientRows,
      schedule: [],
      readings: [{ id: uid(), date: startDate, gravity: r3c(og), temp: null, note: "Juice in — built on the day" }],
      juiceIntake: lotRecords,
      dayRecipe,
    });
    setSaving(false);
    onClose();
  };

  const selStyle = { width: "100%", boxSizing: "border-box", background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 4, padding: "9px 10px", color: "#2A3324", fontSize: 13.5 };
  const itemSelect = (value, onChange, placeholder) => <StockSearchPick inventory={inventory} value={value} onChange={onChange} placeholder={placeholder.replace("…", "") + " — type to search"} />;
  const sub = { fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", margin: "6px 0 2px" };
  const dose = (g) => (g == null ? "—" : g >= 1000 ? `${r3c(g / 1000)} kg` : `${r1(g)} g`);

  return (
    <Modal title="Start today's cider" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={ciderNote}>Build this cider from the juice that came in today. Juice bought in can be taken from stock by lot (add it to Inventory as a Juice item, in litres). Everything below is saved on the batch, and the next cider can start from it.</div>
        {pastCiders.length > 0 && (
          <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B54" }}>Start from a past cider (optional)</span>
            <select defaultValue="" onChange={(e) => loadPast(e.target.value)} style={selStyle}>
              <option value="">— start blank —</option>
              {pastCiders.map((b) => <option key={b.id} value={b.id}>{b.name} (#{b.number}) · {b.startDate}</option>)}
            </select>
            <span style={ciderNote}>Copies the varieties, orchards, rates and stock items — not the litres or readings, since this year's fruit will differ.</span>
          </label>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10 }}>
          <TextField label="Batch #" value={batchNumber} onChange={setBatchNumber} />
          <TextField label="Name" value={name} onChange={setName} />
        </div>
        {numberTaken && <div style={ciderWarn}>Batch #{batchNumber.trim()} already exists — the next cider number is {nextNumber}.</div>}
        <TextField label="Date" type="date" value={startDate} onChange={setStartDate} />
        <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B54" }}>Tank</span>
          <select value={tankId} onChange={(e) => setTankId(e.target.value)} style={selStyle}>
            <option value="">— choose later —</option>
            {fermenters.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.capacity}L){tankIsOccupied(batches, t.id) ? " — in use" : ""}</option>)}
          </select>
        </label>
        {occupied && <div style={ciderWarn}>{tank.name} is in use today — pick another tank or a later date.</div>}

        <div style={sub}>Juice in</div>
        {lots.map((l, i) => (
          <div key={l.id} style={{ border: "1px solid #EBE8D6", borderRadius: 5, padding: "10px", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={grid2}>
              <TextField label="Variety" value={l.variety} onChange={(v) => setLot(l.id, { variety: v })} />
              <TextField label="Orchard" value={l.orchard} onChange={(v) => setLot(l.id, { orchard: v })} />
            </div>
            {(() => {
              const it = inventory.find((x) => x.id === l.itemId);
              const lotsLeft = it ? (it.lots || []).filter((x) => (x.remainingQty ?? x.qty) > 0) : [];
              const f = it ? unitFactor("L", it.unit) : null;
              const need = it && f != null ? Number(l.litres || 0) * f : 0;
              return (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: it ? "1fr 1fr" : "1fr", gap: 8 }}>
                    <StockSearchPick inventory={juiceItems} value={l.itemId} onChange={(v) => setLot(l.id, { itemId: v, lotId: "" })} placeholder="Search juice in stock… (blank = pressed here)" preferCategory="Juice" />
                    {it && (
                      <select value={l.lotId} onChange={(e) => setLot(l.id, { lotId: e.target.value })} style={{ width: "100%", boxSizing: "border-box", background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 4, padding: "8px 9px", fontSize: 13, color: "#2A3324" }}>
                        <option value="">Oldest lot first</option>
                        {lotsLeft.map((x) => <option key={x.id} value={x.id}>Lot {x.lotNumber || "—"} · {x.remainingQty ?? x.qty}{it.unit} left</option>)}
                      </select>
                    )}
                  </div>
                  {it && f == null && <div style={{ fontSize: 11.5, color: "#B5502F" }}>{it.name} isn't counted in litres, so it can't be taken out of stock.</div>}
                  {it && f != null && need > it.qty && <div style={{ fontSize: 11.5, color: "#B5502F" }}>Only {it.qty}{it.unit} of {it.name} in stock.</div>}
                </>
              );
            })()}
            <div style={{ display: "flex", border: "1px solid #DDE0C8", borderRadius: 4, overflow: "hidden" }}>
              {[["brix", "Brix"], ["sg", "SG"]].map(([m, label]) => (
                <button key={m} type="button" onClick={() => setLot(l.id, { mode: m })} style={{ flex: 1, background: l.mode === m ? "#5C9A3C" : "#F5F1E4", border: "none", padding: 6, fontSize: 12, color: l.mode === m ? "#16191A" : "#5C6B54", cursor: "pointer" }}>{label}</button>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
              <NumberField label="Litres" value={l.litres} onChange={(v) => setLot(l.id, { litres: v })} />
              <NumberField label={l.mode === "brix" ? "Brix" : "SG"} value={l.value} onChange={(v) => setLot(l.id, { value: v })} step={l.mode === "brix" ? "0.1" : "0.001"} />
              <NumberField label="pH" value={l.ph} onChange={(v) => setLot(l.id, { ph: v })} step="0.01" />
              <NumberField label="TA g/L" value={l.ta} onChange={(v) => setLot(l.id, { ta: v })} step="0.1" />
            </div>
            {lots.length > 1 && <button type="button" onClick={() => setLots((p) => p.filter((x) => x.id !== l.id))} style={{ ...ciderBtn2, alignSelf: "flex-start", padding: "5px 10px" }}>Remove</button>}
          </div>
        ))}
        <button type="button" onClick={() => setLots((p) => [...p, blankLot()])} style={{ ...ciderBtn2, alignSelf: "flex-start" }}>+ Another juice</button>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
          <CiderStat label="Litres" value={r1(L)} />
          <CiderStat label="Juice SG" value={fmtSg(sum.sg)} />
          <CiderStat label="pH" value={sum.ph != null ? sum.ph.toFixed(2) : "—"} />
        </div>
        {tooBig && <div style={ciderWarn}>{r1(L)}L is more than {tank.name} holds ({tank.capacity}L).</div>}
        {sum.ph != null && sum.ph > 3.8 && <div style={ciderWarn}>pH {sum.ph.toFixed(2)} is high for cider — consider malic acid or a sharper juice.</div>}

        <div style={sub}>Targets</div>
        <div style={grid2}>
          <NumberField label="Target ABV (optional)" value={targetAbv} onChange={setTargetAbv} step="0.1" suffix="%" />
          <NumberField label="Expected final SG" value={fg} onChange={setFg} step="0.001" />
        </div>
        <div style={ciderNote}>
          {og != null ? `OG ${fmtSg(og)} → about ${r1(abvFrom(og, Number(fg) || 1))}% if it ferments to ${fg}.` : "Enter juice litres and Brix or SG."}
          {sugarG ? ` Includes ${dose(sugarG)} sugar to reach ${targetAbv}%.` : ""}
        </div>

        <div style={sub}>Additions</div>
        <div style={grid2}>
          <NumberField label="Molecular SO₂" value={molecular} onChange={setMolecular} step="0.1" suffix="mg/L" />
          <NumberField label="Enzyme g/hL" value={enzymeRate} onChange={setEnzymeRate} step="0.1" />
          <NumberField label="Nutrient g/hL" value={nutrientRate} onChange={setNutrientRate} step="1" />
        </div>
        {ROLES.map((r) => (calc[r.role] > 0 ? (
          <div key={r.role} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#2A3324" }}>
              <span>{r.label}</span>
              <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{dose(calc[r.role])}</span>
            </div>
            {itemSelect(roleItems[r.role], (v) => setRoleItems((p) => ({ ...p, [r.role]: v })), "Take from stock item… (optional)")}
            {roleItems[r.role] && itemQtyFromGrams(roleItems[r.role], calc[r.role]) == null && <div style={{ fontSize: 11.5, color: "#B5502F" }}>That item isn't counted by weight, so it can't be taken out automatically.</div>}
          </div>
        ) : null))}
        {freeSo2 != null && <div style={ciderNote}>Sulphite for {Math.round(freeSo2)} mg/L free SO₂ at pH {sum.ph.toFixed(2)}.</div>}
        {calc.enzyme > 0 && L > 0 && <div style={ciderNote}>Pectic enzyme: {dose(calc.enzyme)} for {r1(L)}L at {enzymeRate} g/100L. Stir it into the juice at the start (fine alongside the sulphite) and give it a few hours, ideally overnight, before pitching. Set the rate to your product's label once and it's remembered.</div>}
        {!(calc.enzyme > 0) && L > 0 && <div style={ciderNote}>Put your pectic enzyme's rate (g per 100L, from the label) in "Enzyme g/hL" to get the dose.</div>}
        {sum.ph == null && L > 0 && <div style={ciderNote}>Add the juice pH above to work out the sulphite.</div>}

        <div style={sub}>Yeast</div>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 8, alignItems: "end" }}>
          {itemSelect(yeastId, setYeastId, "Yeast from stock…")}
          <NumberField label={`Qty${inventory.find((x) => x.id === yeastId) ? ` (${inventory.find((x) => x.id === yeastId).unit})` : ""}`} value={yeastQty} onChange={setYeastQty} />
        </div>

        <div style={sub}>Anything else (acid, tannin, fruit…)</div>
        {adds.map((a) => (
          <div key={a.id} style={{ display: "grid", gridTemplateColumns: "2fr 1fr auto", gap: 8, alignItems: "end" }}>
            {itemSelect(a.itemId, (v) => setAdds((p) => p.map((x) => (x.id === a.id ? { ...x, itemId: v } : x))), "Stock item…")}
            <NumberField label={`Qty${inventory.find((x) => x.id === a.itemId) ? ` (${inventory.find((x) => x.id === a.itemId).unit})` : ""}`} value={a.qty} onChange={(v) => setAdds((p) => p.map((x) => (x.id === a.id ? { ...x, qty: v } : x)))} />
            <button type="button" onClick={() => setAdds((p) => p.filter((x) => x.id !== a.id))} aria-label="Remove" style={{ background: "none", border: "none", color: "#9BA88A", cursor: "pointer", paddingBottom: 10 }}><Trash2 size={15} /></button>
          </div>
        ))}
        <button type="button" onClick={() => setAdds((p) => [...p, { id: uid(), itemId: "", qty: "" }])} style={{ ...ciderBtn2, alignSelf: "flex-start" }}>+ Add an ingredient</button>

        <TextField label="Notes for this year's fruit (optional)" value={notes} onChange={setNotes} />
        {ingredientRows.length > 0 && <div style={ciderNote}>Taken out of stock when you save: {ingredientRows.map((x) => `${x.qty}${x.unit} ${x.name}`).join(", ")}.</div>}
        <button type="button" onClick={save} disabled={!canSave} style={{ ...ciderBtn, opacity: canSave ? 1 : 0.5, padding: "12px" }}>
          {saving ? "Saving…" : `Start #${batchNumber.trim() || nextNumber} ${name.trim() || "cider"}`}
        </button>
      </div>
    </Modal>
  );
}

export function CiderDayRecipeCard({ batch }) {
  const r = batch?.dayRecipe;
  if (!r) return null;
  const c = r.calculated || {};
  return (
    <div style={ciderCard}>
      <div style={ciderHead}>Built on the day · {r.builtOn}</div>
      <div style={{ fontSize: 12.5, color: "#2A3324", lineHeight: 1.6 }}>
        {(r.lots || []).map((l, i) => (
          <div key={i}>{l.litres}L {l.variety || l.itemName || "juice"}{l.orchard ? ` (${l.orchard})` : ""}{l.lotNumber ? ` · lot ${l.lotNumber}` : ""}{l.brix != null ? ` · ${l.brix}°Bx` : l.sg != null ? ` · SG ${l.sg}` : ""}{l.ph != null ? ` · pH ${l.ph}` : ""}{l.ta != null ? ` · TA ${l.ta}` : ""}</div>
        ))}
        <div style={{ color: "#5C6B54", marginTop: 4 }}>
          {c.litres}L · OG {c.og}{c.ph != null ? ` · pH ${c.ph}` : ""}{c.abvIfDry != null ? ` · ~${c.abvIfDry}% dry` : ""}{c.kmetaG ? ` · K-meta ${c.kmetaG}g` : ""}{c.sugarG ? ` · sugar ${c.sugarG}g` : ""}
        </div>
        {(batch.ingredients || []).length > 0 && <div style={{ color: "#5C6B54" }}>Additions: {batch.ingredients.map((x) => `${x.qty}${x.unit} ${x.name}`).join(", ")}</div>}
        {r.notes && <div style={{ color: "#5C6B54" }}>Notes: {r.notes}</div>}
      </div>
    </div>
  );
}

export function CiderView({ batches, inventory, tanks = [], nextNumber, onCreateBatch, onSaveCider, onRecordSweeten, onSetBatchFigures, onLogAddition, onStartBatch, onOpenBatch, focus }) {
  const [showDaySheet, setShowDaySheet] = useState(false);
  const ciderBatches = useMemo(
    () => batches.filter((b) => b.productType === CIDER_TYPE && !b.mergedIntoBatchId).sort((a, b) => String(b.startDate).localeCompare(String(a.startDate))),
    [batches]
  );
  const active = ciderBatches.filter((b) => !(b.stage === "Packaged" && remainingVolume(b) === 0));
  const [batchId, setBatchId] = useState(() => focus?.batchId || active[0]?.id || "");
  const [tab, setTab] = useState(focus?.tab || "juice");
  useEffect(() => {
    if (focus?.batchId) setBatchId(focus.batchId);
    if (focus?.tab) setTab(focus.tab);
  }, [focus?.key]);
  const batch = ciderBatches.find((b) => b.id === batchId) || null;
  const tabs = [["plan", "Plan"], ["juice", "Juice"], ["additions", "Additions"], ["blend", "Blend"], ["sweeten", "Sweeten"]];
  const [prefill, setPrefill] = useState(null);
  return (
    <div>
      <h1 style={{ fontFamily: "'Oswald', sans-serif", fontSize: 26, color: "#2A3324", margin: "0 0 4px", fontWeight: 500 }}>Cider</h1>
      <div style={{ ...ciderNote, marginBottom: 16 }}>Juice, additions, blending and back-sweetening for Cider/Perry batches.</div>
      <div style={{ ...ciderCard, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select value={batchId} onChange={(e) => setBatchId(e.target.value)} style={{ flex: 1, minWidth: 0, background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 4, padding: "10px", fontSize: 14, color: "#2A3324" }}>
            <option value="">{ciderBatches.length ? "No batch — just calculate" : "No cider batches yet"}</option>
            {active.length > 0 && <optgroup label="In progress">{active.map((b) => <option key={b.id} value={b.id}>{b.name} (#{b.number}) · {b.stage}</option>)}</optgroup>}
            {ciderBatches.length > active.length && <optgroup label="Finished">{ciderBatches.filter((b) => !active.includes(b)).map((b) => <option key={b.id} value={b.id}>{b.name} (#{b.number})</option>)}</optgroup>}
          </select>
          {batch && <button type="button" onClick={() => onOpenBatch(batch.id)} style={ciderBtn2}>Open</button>}
        </div>
        {onCreateBatch && <button type="button" onClick={() => { setPrefill(null); setShowDaySheet(true); }} style={ciderBtn}>+ Start today's cider</button>}
        <button type="button" onClick={onStartBatch} style={ciderBtn2}>Use the normal batch form instead</button>
      </div>
      <div style={{ display: "flex", border: "1px solid #DDE0C8", borderRadius: 5, overflow: "hidden", marginBottom: 14 }}>
        {tabs.map(([k, label]) => (
          <button key={k} type="button" onClick={() => setTab(k)} style={{ flex: 1, background: tab === k ? "#5C9A3C" : "#F5F1E4", border: "none", padding: "10px 4px", fontSize: 12.5, color: tab === k ? "#16191A" : "#5C6B54", cursor: "pointer", fontFamily: "'Inter', sans-serif" }}>{label}</button>
        ))}
      </div>
      {tab === "plan" && <CiderPlanTab inventory={inventory} onStartFromPlan={(p) => { setPrefill(p); setShowDaySheet(true); }} />}
      {tab === "juice" && <CiderDayRecipeCard batch={batch} />}
      {tab === "juice" && <CiderJuiceTab key={batchId} batch={batch} onSaveCider={onSaveCider} onSetBatchFigures={onSetBatchFigures} />}
      {showDaySheet && (
        <CiderDaySheet
          batches={batches}
          inventory={inventory}
          tanks={tanks}
          nextNumber={nextNumber}
          prefill={prefill}
          onClose={() => { setShowDaySheet(false); setPrefill(null); }}
          onCreate={async (b) => {
            await onCreateBatch(b);
            setBatchId(b.id);
            setTab("juice");
          }}
        />
      )}
      {tab === "additions" && <CiderAdditionsTab key={batchId} batch={batch} inventory={inventory} onLogAddition={onLogAddition} />}
      {tab === "blend" && <CiderBlendTab ciderBatches={ciderBatches} onSaveCider={onSaveCider} />}
      {tab === "sweeten" && <CiderSweetenTab key={batchId} batch={batch} inventory={inventory} onSaveCider={onSaveCider} onRecordSweeten={onRecordSweeten} onLogAddition={onLogAddition} />}
    </div>
  );
}

// Cider part of the batch page: the day's recipe, what's been added, back-
// sweetening and blends, with shortcuts into the Cider page's calculators.
export function CiderBatchPanel({ batch, onOpenCiderTools }) {
  const j = juiceSummary(batch.juiceIntake);
  const adds = batch.batchAdditions || [];
  const sweet = batch.backSweetenings || [];
  const blends = batch.blendLog || [];
  const head = { fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 8 };
  const row = { borderTop: "1px solid #EEF0E2", padding: "7px 0", fontSize: 12.5, color: "#2A3324" };
  const tool = (tab, label) => (
    <button type="button" onClick={() => onOpenCiderTools && onOpenCiderTools(batch.id, tab)} style={{ background: "#FFFFFF", border: "1px solid #C9D1AC", borderRadius: 5, padding: "8px 11px", color: "#2A3324", fontSize: 12.5, cursor: "pointer", fontFamily: "'Inter', sans-serif" }}>
      {label}
    </button>
  );
  return (
    <div style={{ marginBottom: 22 }}>
      {onOpenCiderTools && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
          {tool("juice", "Juice")}
          {tool("additions", "Additions calculator")}
          {tool("sweeten", "Back-sweeten & stabilise")}
          {tool("blend", "Blend")}
        </div>
      )}
      {batch.dayRecipe ? (
        <CiderDayRecipeCard batch={batch} />
      ) : (batch.juiceIntake || []).length > 0 ? (
        <div style={{ ...ciderCard }}>
          <div style={head}>Juice</div>
          <div style={{ fontSize: 12.5, color: "#2A3324" }}>
            {r1(j.litres)}L · SG {fmtSg(j.sg)}{j.ph != null ? ` · pH ${j.ph.toFixed(2)}` : ""}{j.ta != null ? ` · TA ${r1(j.ta)}` : ""}
          </div>
        </div>
      ) : null}
      {adds.length > 0 && (
        <div style={ciderCard}>
          <div style={head}>Added since</div>
          {adds.map((a) => (
            <div key={a.id} style={row}>{a.date} · {a.qty}{a.unit} {a.name}{a.note ? <span style={{ color: "#9BA88A" }}> · {a.note}</span> : null}</div>
          ))}
        </div>
      )}
      {sweet.length > 0 && (
        <div style={ciderCard}>
          <div style={head}>Back-sweetening &amp; stabilising</div>
          {sweet.map((h) => (
            <div key={h.id} style={row}>
              {h.date} · {h.method === "juice" ? `${h.juiceL}L juice` : `${h.sugarG}g sugar`} to SG {h.targetSg}
              <span style={{ color: "#9BA88A" }}> · {h.litresAfter}L{h.abvAfter != null ? ` at ${h.abvAfter}%` : ""}{h.sorbateG ? ` · sorbate ${h.sorbateG}g` : ""}{h.kmetaG ? ` · K-meta ${h.kmetaG}g` : ""}</span>
            </div>
          ))}
        </div>
      )}
      {blends.length > 0 && (
        <div style={ciderCard}>
          <div style={head}>Blends</div>
          {blends.map((bl) => (
            <div key={bl.id} style={row}>
              {bl.date} · {(bl.components || []).map((c) => `${c.litres}L ${c.name}`).join(" + ")}
              <span style={{ color: "#9BA88A" }}> → {bl.result?.litres}L{bl.result?.abv != null ? ` at ${bl.result.abv}%` : ""}{bl.note ? ` · ${bl.note}` : ""}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
