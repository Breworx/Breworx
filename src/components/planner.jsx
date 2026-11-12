import { useState, useMemo, useEffect } from "react";
import { addDaysISO, nzPublicHolidays, planBrews, productKeyForBatch } from "../lib/brewPlanner";
import { monthLabelFromKey } from "../lib/excise";
import { CONTAINERS, availableStockList, batchTankIds, packagedVolume, packagingEvents, remainingVolume, uid } from "../lib/production";
import { today } from "../lib/utils";

// ─── Brew planner ───────────────────────────────────────────────────────────
// Turns the app's batches into the plain shape lib/brewPlanner.js works on.
export function brewPlannerInputs(batches, recipes, salesOrders, mixedPackAssemblies) {
  const famById = Object.fromEntries(recipes.map((r) => [r.id, r.familyId || r.id]));
  const keyById = {};
  const litresOf = (containerKey, qty) => (CONTAINERS.find((c) => c.key === containerKey)?.volumeL || 0) * (Number(qty) || 0);
  const list = batches
    .filter((b) => !b.mergedIntoBatchId)
    .map((b) => {
      const key = productKeyForBatch(b, famById);
      keyById[b.id] = key;
      return {
        id: b.id,
        key,
        name: b.name,
        productType: b.productType || "Beer",
        startDate: b.startDate,
        volume: Number(b.volume) || 0,
        stage: b.stage,
        remainingL: remainingVolume(b),
        packagedEvents: packagingEvents(b).map((e) => ({
          date: e.date || b.startDate,
          litres: packagedVolume(e),
          byContainer: Object.fromEntries(CONTAINERS.filter((c) => e[c.key] > 0).map((c) => [c.key, e[c.key] * c.volumeL])),
        })),
        xeroSold: (b.xeroSold || []).map((e) => ({ date: e.date, litres: litresOf(e.containerKey, e.qty), containerKey: e.containerKey })),
        plannedDays: b.plannedDays || null,
        tankIds: batchTankIds(b),
        recipeId: b.recipeId || null,
        brewDaysPlanned: b.brewDaysPlanned || 1,
      };
    });
  const stockByKey = {};
  const stockByKeyContainer = {};
  availableStockList(batches, salesOrders, mixedPackAssemblies).forEach((s) => {
    const key = keyById[s.batchId];
    if (!key || !(s.available > 0)) return;
    const l = litresOf(s.containerKey, s.available);
    stockByKey[key] = (stockByKey[key] || 0) + l;
    const by = stockByKeyContainer[key] || (stockByKeyContainer[key] = {});
    by[s.containerKey] = (by[s.containerKey] || 0) + l;
  });
  return { list, stockByKey, stockByKeyContainer };
}

export const fmtWeeks = (w) => (w == null ? "—" : w >= 52 ? "52+ wk" : `${Math.round(w * 10) / 10} wk`);
export const fmtDay = (iso) => (iso ? new Date(iso + "T00:00:00").toLocaleDateString("en-NZ", { weekday: "short", day: "numeric", month: "short" }) : "—");
export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Number box that saves when you leave it (not on every keystroke); empty = use history.
export function PlannerNumber({ label, value, onCommit, step }) {
  const [draft, setDraft] = useState(value == null ? "" : String(value));
  useEffect(() => setDraft(value == null ? "" : String(value)), [value]);
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B54" }}>{label}</span>
      <input
        type="number"
        inputMode="decimal"
        step={step}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { if (draft !== (value == null ? "" : String(value))) onCommit(draft === "" ? null : Number(draft)); }}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        style={{ width: "100%", boxSizing: "border-box", background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 4, padding: "9px 10px", color: "#2A3324", fontFamily: "'JetBrains Mono', monospace", fontSize: 14 }}
      />
    </label>
  );
}

// Public holidays and the brewery's own days off, which the planner never
// picks as a brew day.
function DaysOffEditor({ s, save, horizonWeeks, sel, btn2, note }) {
  const [date, setDate] = useState("");
  const [label, setLabel] = useState("");
  const start = today();
  const end = addDaysISO(start, horizonWeeks * 7);
  const years = [...new Set([start.slice(0, 4), end.slice(0, 4)])].map(Number);
  const upcoming = years
    .flatMap((y) => Object.entries(nzPublicHolidays(y)))
    .filter(([d]) => d >= start && d <= end)
    .sort((a, b) => a[0].localeCompare(b[0]));
  const own = [...(s.daysOff || [])].sort((a, b) => a.date.localeCompare(b.date));
  const fmt = (iso) => new Date(iso + "T00:00:00").toLocaleDateString("en-NZ", { weekday: "short", day: "numeric", month: "short" });
  const skip = s.skipHolidays !== false;
  const chip = { display: "inline-flex", alignItems: "center", gap: 6, background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 12, padding: "3px 9px", fontSize: 12, color: "#2A3324" };
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B54", marginBottom: 6 }}>Days off</div>
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#2A3324", cursor: "pointer" }}>
        <input type="checkbox" checked={skip} onChange={(e) => save({ skipHolidays: e.target.checked })} style={{ accentColor: "#5C9A3C" }} />
        Don't brew on NZ public holidays
      </label>
      {skip && upcoming.length > 0 && (
        <div style={{ ...note, marginTop: 4 }}>Coming up: {upcoming.map(([d, n]) => `${n} ${fmt(d)}`).join(" · ")}</div>
      )}
      {own.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
          {own.map((d) => (
            <span key={d.date} style={chip}>
              {d.label ? `${d.label} · ` : ""}{fmt(d.date)}
              <button type="button" aria-label="Remove" onClick={() => save({ daysOff: own.filter((x) => x.date !== d.date) })} style={{ background: "none", border: "none", padding: 0, color: "#9BA88A", cursor: "pointer", fontSize: 14, lineHeight: 1 }}>×</button>
            </span>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8, alignItems: "center" }}>
        <input type="date" value={date} min={start} onChange={(e) => setDate(e.target.value)} style={sel} />
        <input type="text" value={label} placeholder="e.g. Otago Anniversary" onChange={(e) => setLabel(e.target.value)} style={{ ...sel, flex: "1 1 140px", minWidth: 0 }} />
        <button
          type="button"
          disabled={!date}
          onClick={() => { save({ daysOff: [...own.filter((x) => x.date !== date), { date, label: label.trim() }] }); setDate(""); setLabel(""); }}
          style={{ ...btn2, opacity: date ? 1 : 0.5 }}
        >
          Add day off
        </button>
      </div>
      <div style={{ ...note, marginTop: 4 }}>For anniversary days, shutdowns or leave. National holidays are already covered.</div>
    </div>
  );
}

export function BrewPlannerView({ batches, recipes, tanks, salesOrders, mixedPackAssemblies, settings, onSaveSettings, onSchedule, nextNumber, nextCiderNumber }) {
  const s = { periodMonths: 3, horizonWeeks: 12, baseCoverWeeks: 4, brewWeekdays: [1, 2, 3, 4, 5], brewsPerDay: 2, kitLitres: 240, products: {}, ...(settings || {}) };
  const [editing, setEditing] = useState(null); // product key being edited
  const [added, setAdded] = useState({}); // suggestion id -> true
  const [busy, setBusy] = useState(false);
  const plan = useMemo(() => {
    const { list, stockByKey, stockByKeyContainer } = brewPlannerInputs(batches, recipes, salesOrders, mixedPackAssemblies);
    return planBrews({ batches: list, stockByKey, stockByKeyContainer, containers: CONTAINERS, tanks: tanks.map((t) => ({ ...t, capacity: Number(t.capacity) || 0 })), settings: s, todayStr: today() });
  }, [batches, recipes, tanks, salesOrders, mixedPackAssemblies, JSON.stringify(settings || {})]);
  const save = (patch) => onSaveSettings({ ...s, ...patch });
  const saveProduct = (key, patch) => save({ products: { ...s.products, [key]: { ...(s.products[key] || {}), ...patch } } });
  const clearProduct = (key, field) => {
    const p = { ...(s.products[key] || {}) };
    delete p[field];
    save({ products: { ...s.products, [key]: p } });
  };

  const recipeFor = (sug) => {
    const r = recipes.find((x) => x.id === sug.recipeId);
    if (!r) return null;
    const fam = recipes.filter((x) => (x.familyId || x.id) === (r.familyId || r.id));
    return fam.find((x) => x.isActive) || fam.sort((a, b) => (b.version || 1) - (a.version || 1))[0] || r;
  };
  const toBatch = (sug, number) => {
    const r = recipeFor(sug);
    const split = sug.tanks.length > 1;
    return {
      id: uid(),
      number,
      name: sug.name,
      style: r?.style || "Unspecified",
      productType: r?.productType || sug.productType || "Beer",
      volume: sug.volume,
      og: null, fg: null, mashPh: null, mashTemp: null, preBoilGravity: null, topUpWater: null, phIntoTank: null, sgIntoTank: null,
      stage: "Brewing",
      startDate: sug.startDate,
      recipeId: r?.id || null,
      recipeName: r?.name || null,
      tankId: split ? null : sug.tanks[0]?.tankId || null,
      tankName: split ? null : sug.tanks[0]?.tankName || null,
      brewStage: null,
      splitTanks: split ? sug.tanks.map((t) => ({ tankId: t.tankId, tankName: t.tankName, volume: t.volume, additions: [] })) : [],
      ingredients: [],
      schedule: [],
      readings: [],
      plannedDays: sug.leadDays,
      brewDaysPlanned: sug.brewDays,
    };
  };
  const addOne = async (sug, number) => {
    await onSchedule(toBatch(sug, number));
    setAdded((p) => ({ ...p, [sug.id]: true }));
  };
  const schedulable = plan.suggestions.filter((x) => x.startDate && !added[x.id]);
  const isCider = (sug) => (recipeFor(sug)?.productType || sug.productType) === "Cider/Perry";
  const numberFor = (sug) => (isCider(sug) && nextCiderNumber ? nextCiderNumber : nextNumber);
  const addAll = async () => {
    setBusy(true);
    let n = parseInt(nextNumber, 10) || 1;
    let f = parseInt(String(nextCiderNumber || "F0001").slice(1), 10) || 1;
    for (const sug of schedulable) {
      if (isCider(sug)) { await addOne(sug, `F${String(f).padStart(4, "0")}`); f += 1; }
      else { await addOne(sug, String(n)); n += 1; }
    }
    setBusy(false);
  };

  const card = { background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "14px", marginBottom: 14 };
  const head = { fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 };
  const note = { fontSize: 12, color: "#5C6B54", lineHeight: 1.5 };
  const sel = { background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 4, padding: "8px 9px", fontSize: 13.5, color: "#2A3324" };
  const btn2 = { background: "#FFFFFF", border: "1px solid #C9D1AC", borderRadius: 5, padding: "8px 12px", color: "#2A3324", fontSize: 12.5, cursor: "pointer", fontFamily: "'Inter', sans-serif" };
  const planned = plan.products.filter((p) => p.include);
  const others = plan.products.filter((p) => !p.include && (p.ratePerDay > 0 || p.stockL > 0));

  return (
    <div>
      <h1 style={{ fontFamily: "'Oswald', sans-serif", fontSize: 26, color: "#2A3324", margin: "0 0 4px", fontWeight: 500 }}>Brew planner</h1>
      <div style={{ ...note, marginBottom: 16 }}>
        Suggests what to brew and when, from how fast each beer sells, what's packaged, what's in tank and what's already scheduled. Nothing goes in the calendar until you add it.
      </div>

      <div style={card}>
        <div style={head}>Settings</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B54" }}>Sales from the last</span>
            <select value={s.periodMonths} onChange={(e) => save({ periodMonths: Number(e.target.value) })} style={sel}>
              {[1, 2, 3, 6, 12].map((m) => <option key={m} value={m}>{m} month{m > 1 ? "s" : ""}</option>)}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B54" }}>Plan ahead</span>
            <select value={s.horizonWeeks} onChange={(e) => save({ horizonWeeks: Number(e.target.value) })} style={sel}>
              {[4, 8, 12, 16, 26, 39, 52].map((w) => <option key={w} value={w}>{w === 52 ? "A year (52 weeks)" : `${w} weeks`}</option>)}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B54" }}>Base stock cover</span>
            <select value={s.baseCoverWeeks} onChange={(e) => save({ baseCoverWeeks: Number(e.target.value) })} style={sel}>
              {[2, 3, 4, 5, 6, 8].map((w) => <option key={w} value={w}>{w} weeks</option>)}
            </select>
          </label>
          <PlannerNumber label="Brew size, every beer (L)" value={s.defaultBatchL ?? null} onCommit={(v) => save({ defaultBatchL: v })} step="10" />
          <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B54" }}>Brews per day</span>
            <select value={s.brewsPerDay} onChange={(e) => save({ brewsPerDay: Number(e.target.value) })} style={sel}>
              {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        </div>
        <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B54", margin: "12px 0 6px" }}>Brew days</div>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {[1, 2, 3, 4, 5, 6, 0].map((d) => {
            const on = s.brewWeekdays.includes(d);
            return (
              <button key={d} type="button" onClick={() => save({ brewWeekdays: on ? s.brewWeekdays.filter((x) => x !== d) : [...s.brewWeekdays, d] })} style={{ ...btn2, padding: "6px 10px", background: on ? "#5C9A3C" : "#FFFFFF", borderColor: on ? "#5C9A3C" : "#C9D1AC", color: on ? "#16191A" : "#5C6B54" }}>
                {WEEKDAY_LABELS[d]}
              </button>
            );
          })}
        </div>
        <DaysOffEditor s={s} save={save} horizonWeeks={s.horizonWeeks} sel={sel} btn2={btn2} note={note} />
        <div style={{ ...note, marginTop: 10 }}>
          Sales are the litres packaged in that period{plan.xeroMonths.length ? `, except ${plan.xeroMonths.map((m) => monthLabelFromKey(m)).join(", ")}, which use your Xero sales` : ""}. Each beer's cover starts at the base and goes up (to at most double) for beers whose monthly sales swing a lot. It updates on its own as more months come in.
        </div>
      </div>

      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, gap: 8 }}>
          <div style={{ ...head, marginBottom: 0 }}>Suggested brews ({plan.suggestions.length})</div>
          {schedulable.length > 1 && (
            <button type="button" disabled={busy} onClick={addAll} style={{ background: "#5C9A3C", border: "none", borderRadius: 5, padding: "8px 12px", color: "#16191A", fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 13, cursor: "pointer", opacity: busy ? 0.6 : 1 }}>
              {busy ? "Adding…" : `Add all ${schedulable.length}`}
            </button>
          )}
        </div>
        {plan.suggestions.length === 0 && <div style={note}>Nothing needs brewing in the next {s.horizonWeeks} weeks at current sales.</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {plan.suggestions.map((sug) => (
            <div key={sug.id} style={{ border: `1px solid ${sug.runOut || sug.noTank ? "#E3B37A" : "#EBE8D6"}`, background: added[sug.id] ? "#EBF3E4" : "#FFFDF6", borderRadius: 5, padding: "10px 11px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, color: "#2A3324", fontWeight: 500 }}>{fmtDay(sug.startDate)} · {sug.name}</div>
                  <div style={{ fontSize: 12, color: "#5C6B54", marginTop: 2, lineHeight: 1.45 }}>
                    {sug.volume}L{sug.brewDays > 1 ? ` (${sug.brewDays} brew days)` : ""} → {sug.tanks.length ? sug.tanks.map((t) => (sug.tanks.length > 1 ? `${t.tankName} ${t.volume}L` : t.tankName)).join(" + ") : "no free tank"} · ready {fmtDay(sug.readyDate)}
                  </div>
                  {sug.split && sug.split.length > 0 && (
                    <div style={{ fontSize: 12, color: "#2A3324", marginTop: 3 }}>
                      Pack: {sug.split.map((x) => (x.containerKey === "cans330" ? `${x.units} cans (${x.units / 24} cases)` : `${x.units} × ${x.label}`)).join(" · ")}
                    </div>
                  )}
                  {sug.delayDays > 0 && <div style={{ fontSize: 11.5, color: "#8A6D0B", marginTop: 2 }}>Wanted {fmtDay(sug.needDate)} — {sug.delayDays} day{sug.delayDays > 1 ? "s" : ""} later for a free tank or brew day.</div>}
                  {sug.runOut && <div style={{ fontSize: 11.5, color: "#B5502F", marginTop: 2 }}>Packaged stock runs out around {fmtDay(sug.runOut)}, before this is ready.</div>}
                  {sug.noTank && <div style={{ fontSize: 11.5, color: "#B5502F", marginTop: 2 }}>No fermenter is free for {sug.leadDays} days within 2 months of {fmtDay(sug.needDate)}.</div>}
                </div>
                {sug.startDate && (
                  <button type="button" disabled={added[sug.id] || busy} onClick={() => addOne(sug, numberFor(sug))} style={{ ...btn2, whiteSpace: "nowrap", opacity: added[sug.id] ? 0.6 : 1 }}>
                    {added[sug.id] ? "Added ✓" : "Add"}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        {plan.suggestions.length > 0 && <div style={{ ...note, marginTop: 10 }}>Added brews go in the calendar as scheduled batches, so you can move, resize or delete them there like any other.</div>}
      </div>

      <div style={card}>
        <div style={head}>Beers being planned ({planned.length})</div>
        {[...planned, ...others].map((p, i) => {
          const ps = s.products[p.key] || {};
          const isOpen = editing === p.key;
          const low = p.coverNowWeeks != null && p.coverNowWeeks < p.coverWeeks;
          return (
            <div key={p.key}>
              {i === planned.length && others.length > 0 && <div style={{ ...head, marginTop: 14 }}>Not planned ({others.length})</div>}
              <div style={{ borderTop: "1px solid #EEF0E2", padding: "10px 0", opacity: p.include ? 1 : 0.7 }}>
                <button type="button" onClick={() => setEditing(isOpen ? null : p.key)} style={{ display: "flex", justifyContent: "space-between", width: "100%", background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left", gap: 8 }}>
                  <span style={{ fontSize: 13.5, color: "#2A3324" }}>
                    {p.name}
                    <span style={{ display: "block", fontSize: 11.5, color: "#9BA88A", fontFamily: "'JetBrains Mono', monospace" }}>
                      {Math.round(p.ratePerWeek)} L/wk · {Math.round(p.stockL)}L packaged · {Math.round(p.inTankL + p.scheduledL)}L in tank/scheduled
                      {(() => {
                        const sold = p.soldByContainer || {};
                        const t = Object.values(sold).reduce((a, b) => a + b, 0);
                        if (!t) return null;
                        const cans = Math.round(((sold.cans330 || 0) / t) * 100);
                        return <span style={{ display: "block" }}>Sold {cans}% cans · {100 - cans}% kegs</span>;
                      })()}
                    </span>
                  </span>
                  <span style={{ fontSize: 12.5, color: low ? "#B5502F" : "#3F7A28", whiteSpace: "nowrap", textAlign: "right" }}>
                    {fmtWeeks(p.coverNowWeeks)}
                    <span style={{ display: "block", fontSize: 11, color: "#9BA88A" }}>aim {p.coverWeeks} wk</span>
                  </span>
                </button>
                {isOpen && (
                  <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#2A3324" }}>
                      <input type="checkbox" checked={p.include} onChange={(e) => saveProduct(p.key, { include: e.target.checked })} style={{ width: 18, height: 18, accentColor: "#5C9A3C" }} />
                      Plan brews for this
                    </label>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                      <PlannerNumber label="Cover wk" value={ps.coverWeeks ?? p.learnedCover} onCommit={(v) => (v == null ? clearProduct(p.key, "coverWeeks") : saveProduct(p.key, { coverWeeks: v }))} step="0.5" />
                      <PlannerNumber label="Lead days" value={ps.leadDays ?? p.leadDays} onCommit={(v) => (v == null ? clearProduct(p.key, "leadDays") : saveProduct(p.key, { leadDays: v }))} step="1" />
                      <PlannerNumber label="Brew L" value={ps.batchL ?? p.batchL} onCommit={(v) => (v == null ? clearProduct(p.key, "batchL") : saveProduct(p.key, { batchL: v }))} step="10" />
                    </div>
                    <div style={note}>
                      {s.defaultBatchL ? `Brew size follows the ${s.defaultBatchL}L setting unless you change it here. ` : ""}From history: cover {p.learnedCover} wk{p.cv ? ` (sales vary ${Math.round(p.cv * 100)}% month to month)` : ""}, lead {p.learnedLead != null ? `${Math.round(p.learnedLead)} days brew to packaged` : "not enough history (using 14)"}, brew {p.learnedBatch != null ? `${p.learnedBatch}L` : "—"}, {Math.round(p.yieldF * 100)}% of tank volume ends up packaged.
                      {(ps.coverWeeks != null || ps.leadDays != null || ps.batchL != null) && (
                        <button type="button" onClick={() => save({ products: { ...s.products, [p.key]: { include: ps.include, combineInto: ps.combineInto } } })} style={{ background: "none", border: "none", color: "#5C9A3C", textDecoration: "underline", cursor: "pointer", fontSize: 12, padding: 0, marginLeft: 6 }}>
                          Use history again
                        </button>
                      )}
                    </div>
                    <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                      <span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B54" }}>Same beer as</span>
                      <select value={ps.combineInto || ""} onChange={(e) => saveProduct(p.key, { combineInto: e.target.value || null })} style={sel}>
                        <option value="">— its own beer —</option>
                        {plan.products.filter((o) => o.key !== p.key).map((o) => <option key={o.key} value={o.key}>{o.name}</option>)}
                      </select>
                    </label>
                    <div style={note}>Use "Same beer as" when one beer shows up twice under different recipes or names, so its sales and stock count together.</div>
                    {Object.entries(p.mergedFrom || {}).length > 0 && (
                      <div style={{ fontSize: 12.5, color: "#2A3324" }}>
                        Also counting:{" "}
                        {Object.entries(p.mergedFrom).map(([k, nm]) => (
                          <span key={k} style={{ marginRight: 8 }}>
                            {nm}{" "}
                            <button type="button" onClick={() => saveProduct(k, { combineInto: null })} style={{ background: "none", border: "none", color: "#5C9A3C", textDecoration: "underline", cursor: "pointer", fontSize: 12, padding: 0 }}>separate</button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
