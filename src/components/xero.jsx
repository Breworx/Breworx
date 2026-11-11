import { useState, useMemo, useEffect } from "react";
import { createPortal } from "react-dom";
import { Plus, X } from "lucide-react";
import { supabase } from "../supabaseClient";
import { auditPrimaryBtn, auditSecondaryBtn } from "./excise";
import { lastPackagedDate } from "./finishedStock";
import { BreworxMark, Modal, NumberField, SHEET_BACKDROP_STYLE, SHEET_PANEL_STYLE } from "./ui";
import { CONTAINERS, guessXeroItemMatch, productKeyFor, splitFreeName } from "../lib/production";

// Matches every Xero item to the Brewpoint beer and container it is, so a
// sale invoiced in Xero takes the right stock off. Several Xero items can
// be the same beer (Craftys / Gents / Moon Juice labels), and "units"
// handles cases: a case-of-24 item takes 24 cans off per case sold.
export function SameBeerModal({ batches, aliases, onClose, onSave }) {
  // Every batch name (split letters taken off), with how often it's used.
  const names = useMemo(() => {
    const by = {};
    batches.filter((b) => !b.mergedIntoBatchId).forEach((b) => {
      const n = splitFreeName(b.name);
      const k = n.toLowerCase();
      if (!by[k]) by[k] = { name: n, count: 0, last: "" };
      by[k].count += 1;
      if (String(b.startDate) > by[k].last) by[k].last = String(b.startDate);
    });
    return Object.values(by).sort((a, b) => a.name.localeCompare(b.name));
  }, [batches]);
  const [draft, setDraft] = useState(() => ({ ...aliases }));
  const [saving, setSaving] = useState(false);
  const roots = names.filter((n) => !draft[n.name.toLowerCase()]);
  const sel = { background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 4, padding: "7px 8px", fontSize: 13, color: "#2A3324", minWidth: 0, width: "100%" };
  return (
    <Modal title="Same beer, different names" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontSize: 12.5, color: "#5C6B54", lineHeight: 1.5 }}>
          If one beer has been brewed under different batch names (e.g. "Basecamp 240L" and "Base Camp Hazy"), set the extra names to <strong>Same beer as</strong> the main one. Xero matching, stock and tracing then treat them as one beer. For other labels sold in Xero (Craftys, Gents), you don't need this — just match their Xero codes to the house beer.
        </div>
        {names.map((n) => {
          const k = n.name.toLowerCase();
          return (
            <div key={k} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, alignItems: "center", borderTop: "1px solid #EEF0E2", paddingTop: 8 }}>
              <div style={{ fontSize: 13, color: "#2A3324", minWidth: 0 }}>
                {n.name}
                <div style={{ fontSize: 11, color: "#9BA88A" }}>{n.count} batch{n.count === 1 ? "" : "es"} · last {n.last}</div>
              </div>
              <select value={draft[k] || ""} onChange={(e) => setDraft((p) => { const x = { ...p }; if (e.target.value) x[k] = e.target.value; else delete x[k]; return x; })} style={sel}>
                <option value="">Its own beer</option>
                {roots.filter((r) => r.name.toLowerCase() !== k).map((r) => <option key={r.name} value={r.name}>Same beer as {r.name}</option>)}
              </select>
            </div>
          );
        })}
        <button disabled={saving} onClick={async () => { setSaving(true); const ok = await onSave(draft); setSaving(false); if (ok) onClose(); }} style={{ background: "#5C9A3C", border: "none", borderRadius: 5, padding: "12px", color: "#16191A", fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 14, cursor: "pointer", opacity: saving ? 0.6 : 1 }}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </Modal>
  );
}

export function XeroHistoryImport({ before, onImport }) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(() => { const d = new Date(`${before}T00:00:00`); d.setFullYear(d.getFullYear() - 1); return d.toISOString().slice(0, 10); });
  const [busy, setBusy] = useState(false);
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} style={{ width: "100%", background: "none", border: "1px dashed #C9D1AC", borderRadius: 5, padding: "8px", color: "#5C6B54", fontSize: 12.5, cursor: "pointer", marginBottom: 10 }}>
        Add past sales for tracing…
      </button>
    );
  }
  return (
    <div style={{ background: "#F8F5EA", border: "1px solid #DDE0C8", borderRadius: 5, padding: "10px 12px", marginBottom: 10 }}>
      <div style={{ fontSize: 12.5, color: "#2A3324", lineHeight: 1.5, marginBottom: 8 }}>
        Reads Xero invoices from this date up to {before} and records which customer got which batch, for Traceability. <strong>Stock isn't changed</strong> — that stock was already cleared. Match your Xero items first. Safe to run again.
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input type="date" value={from} max={before} onChange={(e) => setFrom(e.target.value)} style={{ flex: 1, minWidth: 0, background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 4, padding: "8px", fontSize: 13, color: "#2A3324" }} />
        <button disabled={busy} onClick={async () => { setBusy(true); const ok = await onImport(from); setBusy(false); if (ok) setOpen(false); }} style={{ background: "#5C9A3C", border: "none", borderRadius: 5, padding: "9px 12px", color: "#16191A", fontSize: 12.5, cursor: "pointer", opacity: busy ? 0.6 : 1, whiteSpace: "nowrap" }}>
          {busy ? "Reading Xero…" : "Add past sales"}
        </button>
        <button onClick={() => setOpen(false)} style={{ background: "none", border: "none", color: "#9BA88A", fontSize: 12.5, cursor: "pointer" }}>Cancel</button>
      </div>
    </div>
  );
}

export function XeroItemMatchModal({ xeroItems, beerNames, existing, highlightCodes, onClose, onSave, onOpenSameBeer }) {
  const byCode = useMemo(() => Object.fromEntries((existing || []).map((m) => [String(m.xero_item_code).toLowerCase(), m])), [existing]);
  const [rows, setRows] = useState(() =>
    (xeroItems || []).map((it) => {
      const m = byCode[String(it.code).toLowerCase()];
      if (m) {
        return { code: it.code, name: it.name, beerName: m.ignore ? "__ignore" : m.beer_name || "", containerKey: m.container_key || "", units: String(m.units_per_xero_unit ?? 1), saved: true };
      }
      const g = guessXeroItemMatch(it, beerNames);
      return { code: it.code, name: it.name, beerName: g.beerName, containerKey: g.containerKey, units: String(g.units), saved: false };
    })
  );
  const [filter, setFilter] = useState("todo");
  const [saving, setSaving] = useState(false);
  const highlight = new Set((highlightCodes || []).map((c) => String(c).toLowerCase()));
  const update = (code, patch) => setRows((prev) => prev.map((r) => (r.code === code ? { ...r, ...patch } : r)));
  const complete = (r) => r.beerName === "__ignore" || (r.beerName && r.containerKey && Number(r.units) > 0);
  const shown = rows
    .filter((r) => (filter === "todo" ? !r.saved || highlight.has(String(r.code).toLowerCase()) : true))
    .sort((a, b) => (highlight.has(String(b.code).toLowerCase()) - highlight.has(String(a.code).toLowerCase())) || a.code.localeCompare(b.code));
  const toSave = rows.filter((r) => complete(r));
  const selectStyle = { background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 4, padding: "7px 8px", fontSize: 13, color: "#2A3324", minWidth: 0 };

  const save = async () => {
    setSaving(true);
    const ok = await onSave(
      toSave.map((r) => ({
        xero_item_code: r.code,
        xero_item_name: r.name,
        ignore: r.beerName === "__ignore",
        beer_name: r.beerName === "__ignore" ? null : r.beerName,
        container_key: r.beerName === "__ignore" ? null : r.containerKey,
        product_key: r.beerName === "__ignore" ? null : productKeyFor(r.beerName, r.containerKey),
        units_per_xero_unit: r.beerName === "__ignore" ? 1 : Number(r.units) || 1,
      }))
    );
    setSaving(false);
    if (ok) onClose();
  };

  return createPortal(
    <>
      <div style={SHEET_BACKDROP_STYLE} />
      <div style={SHEET_PANEL_STYLE}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 18px", borderBottom: "1px solid #DDE0C8", flexShrink: 0 }}>
          <h2 style={{ fontFamily: "'Oswald', sans-serif", fontSize: 20, color: "#2A3324", margin: 0, fontWeight: 500 }}>Match Xero items to beers</h2>
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", color: "#5C6B54", cursor: "pointer", padding: 10 }}>
            <X size={20} />
          </button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
          <div style={{ padding: "14px 18px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 12.5, color: "#5C6B54", lineHeight: 1.5 }}>
              Pick the beer and container each Xero item is. <strong>Units</strong> is how many Brewpoint units one Xero unit holds — 24 for a case of 24 cans, 1 for a keg. Items that aren't beer (hops, consulting, equipment) can be set to "Not stock". Best guesses are filled in — check them.
            </div>
            {onOpenSameBeer && (
              <button onClick={onOpenSameBeer} style={{ background: "#EBE8D6", border: "1px solid #C9D1AC", borderRadius: 5, padding: "9px", color: "#2A3324", fontSize: 12.5, cursor: "pointer" }}>
                Same beer, different batch names? Group them first…
              </button>
            )}
            <div style={{ display: "flex", border: "1px solid #DDE0C8", borderRadius: 4, overflow: "hidden" }}>
              {[["todo", `To check (${rows.filter((r) => !r.saved || highlight.has(String(r.code).toLowerCase())).length})`], ["all", `All items (${rows.length})`]].map(([k, l]) => (
                <button key={k} onClick={() => setFilter(k)} style={{ flex: 1, background: filter === k ? "#5C9A3C" : "#F5F1E4", border: "none", padding: 9, color: filter === k ? "#16191A" : "#5C6B54", fontSize: 12.5, cursor: "pointer" }}>{l}</button>
              ))}
            </div>
            {shown.length === 0 && <div style={{ color: "#9BA88A", fontSize: 13, padding: "8px 0" }}>Everything's matched.</div>}
            {shown.map((r) => (
              <div key={r.code} style={{ background: "#FFFFFF", border: `1px solid ${highlight.has(String(r.code).toLowerCase()) ? "#D9A441" : "#DDE0C8"}`, borderRadius: 6, padding: "9px 12px", display: "flex", flexDirection: "column", gap: 7 }}>
                <div style={{ fontSize: 13, color: "#2A3324" }}>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: "#5C6B54" }}>{r.code}</span> · {r.name}
                  {highlight.has(String(r.code).toLowerCase()) && <span style={{ color: "#8A6D0B", fontSize: 11.5 }}> — sold recently, not matched yet</span>}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "2fr 1.3fr 0.7fr", gap: 6 }}>
                  <select value={r.beerName} onChange={(e) => update(r.code, { beerName: e.target.value })} style={selectStyle}>
                    <option value="">Choose beer…</option>
                    <option value="__ignore">Not stock — ignore</option>
                    {beerNames.map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                  <select value={r.containerKey} disabled={r.beerName === "__ignore"} onChange={(e) => update(r.code, { containerKey: e.target.value, units: e.target.value === "cans330" ? (r.units === "1" ? "24" : r.units) : "1" })} style={selectStyle}>
                    <option value="">Container…</option>
                    {CONTAINERS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                  <input type="number" inputMode="numeric" min="1" disabled={r.beerName === "__ignore"} value={r.units} onChange={(e) => update(r.code, { units: e.target.value })} aria-label="Units per Xero unit" style={{ ...selectStyle, width: "100%", boxSizing: "border-box", fontFamily: "'JetBrains Mono', monospace" }} />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div style={{ flexShrink: 0, borderTop: "1px solid #DDE0C8", padding: "12px 18px", display: "flex", gap: 10 }}>
          <button onClick={save} disabled={saving || toSave.length === 0} style={{ ...auditPrimaryBtn(!saving && toSave.length > 0), flex: 2 }}>
            {saving ? "Saving…" : `Save ${toSave.length} match${toSave.length === 1 ? "" : "es"}`}
          </button>
          <button onClick={onClose} style={{ ...auditSecondaryBtn, flex: 1 }}>Cancel</button>
        </div>
      </div>
    </>,
    document.body
  );
}

// ─── Compare Brewpoint's stock with Xero's, and line Brewpoint up ───────────
// Xero items are turned into Brewpoint products through the same matches
// the sales sync uses (several Xero items can be one beer; a case of 24 is
// 24 cans). Brewpoint's side is what's on hand per beer + container.
export function compareXeroStock({ xeroItems, salesMap, itemMappings, availableStock }) {
  const mapByCode = {};
  (salesMap || []).forEach((m) => (mapByCode[String(m.xero_item_code).toLowerCase()] = m));
  const resolve = (code) => {
    const m = mapByCode[String(code).toLowerCase()];
    if (m) return m.ignore ? { ignore: true } : m.product_key ? { productKey: m.product_key, beerName: m.beer_name, containerKey: m.container_key || m.product_key.split("::")[1], units: Number(m.units_per_xero_unit) || 1 } : null;
    const fm = (itemMappings || []).find((x) => String(x.xero_item_code).toLowerCase() === String(code).toLowerCase());
    if (fm) return { productKey: fm.product_key, beerName: (fm.product_label || "").split(" — ")[0] || fm.product_key.split("::")[0], containerKey: fm.product_key.split("::")[1], units: 1 };
    return null;
  };

  const products = {};
  const productFor = (key, name, containerKey) =>
    products[key] || (products[key] = { key, name, containerKey, xero: 0, xeroItems: [], brewpoint: 0, inXero: false, inBrewpoint: false });
  (availableStock || []).forEach((s) => {
    const p = productFor(productKeyFor(s.batchName, s.containerKey), s.batchName.trim(), s.containerKey);
    p.brewpoint += s.available;
    p.inBrewpoint = true;
  });
  const unmatched = [];
  (xeroItems || []).forEach((it) => {
    if (!it.tracked) return;
    const r = resolve(it.code);
    if (r && r.ignore) return;
    if (!r) {
      if (Number(it.qtyOnHand) !== 0) unmatched.push(it);
      return;
    }
    const p = productFor(r.productKey, products[r.productKey]?.name || r.beerName || r.productKey.split("::")[0], r.containerKey);
    p.xero += Math.round((Number(it.qtyOnHand) || 0) * r.units * 1000) / 1000;
    p.xeroItems.push(`${it.code} × ${Number(it.qtyOnHand) || 0}${r.units !== 1 ? ` (${r.units} each)` : ""}`);
    p.inXero = true;
  });
  const rows = Object.values(products)
    .filter((p) => p.inXero || p.brewpoint !== 0)
    .map((p) => ({ ...p, brewpoint: Math.round(p.brewpoint * 1000) / 1000, diff: Math.round((p.xero - p.brewpoint) * 1000) / 1000 }))
    .sort((a, b) => (b.diff !== 0) - (a.diff !== 0) || a.name.localeCompare(b.name) || a.containerKey.localeCompare(b.containerKey));
  return { rows, unmatched };
}

// Turns the chosen differences into per-batch stock entries. Too much in
// Brewpoint → written off from the oldest batches first (the freshest beer
// stays). Too little → put back on the newest batches first, undoing
// earlier clear-outs/write-offs before anything else; anything beyond that
// goes on the newest batch.
export function planXeroStockMatch({ rows, availableStock, batches }) {
  const batchById = Object.fromEntries((batches || []).map((b) => [b.id, b]));
  const offPerBatch = {};
  const backPerBatch = {};
  const add = (target, batchId, containerKey, qty) => {
    if (!target[batchId]) target[batchId] = {};
    target[batchId][containerKey] = Math.round(((target[batchId][containerKey] || 0) + qty) * 1000) / 1000;
  };
  rows.forEach((row) => {
    const lines = (availableStock || [])
      .filter((s) => productKeyFor(s.batchName, s.containerKey) === row.key)
      .map((s) => ({ ...s, packedOn: lastPackagedDate(batchById[s.batchId] || {}) }));
    if (row.diff < 0) {
      let need = -row.diff;
      [...lines].sort((a, b) => a.packedOn.localeCompare(b.packedOn)).forEach((s) => {
        const take = Math.min(need, Math.max(0, s.available));
        if (take <= 0) return;
        add(offPerBatch, s.batchId, s.containerKey, take);
        need -= take;
      });
    } else if (row.diff > 0) {
      let need = row.diff;
      const newest = [...lines].sort((a, b) => b.packedOn.localeCompare(a.packedOn));
      newest.forEach((s) => {
        if (need <= 0) return;
        const b = batchById[s.batchId];
        const writtenOff =
          (b?.stockCleared || []).reduce((t, e) => t + (Number(e.counts?.[s.containerKey]) || 0), 0) +
          (b?.xeroSold || []).filter((e) => e.containerKey === s.containerKey).reduce((t, e) => t + (Number(e.qty) || 0), 0);
        const give = Math.min(need, Math.max(0, writtenOff));
        if (give <= 0) return;
        add(backPerBatch, s.batchId, s.containerKey, give);
        need -= give;
      });
      if (need > 0 && newest[0]) add(backPerBatch, newest[0].batchId, newest[0].containerKey, need);
    }
  });
  return { offPerBatch, backPerBatch };
}

export function XeroStockCompareModal({ xeroItems, salesMap, itemMappings, availableStock, onClose, onMatch, onMatchItems }) {
  const { rows, unmatched } = useMemo(() => compareXeroStock({ xeroItems, salesMap, itemMappings, availableStock }), [xeroItems, salesMap, itemMappings, availableStock]);
  const [picked, setPicked] = useState(() => Object.fromEntries(rows.filter((r) => r.diff !== 0 && r.inXero && r.inBrewpoint).map((r) => [r.key, true])));
  const [saving, setSaving] = useState(false);
  const chosen = rows.filter((r) => picked[r.key] && r.diff !== 0 && r.inXero && r.inBrewpoint);
  const containerShort = (k) => CONTAINERS.find((c) => c.key === k)?.label || k;
  const num = (n) => (Math.round(n * 1000) / 1000).toLocaleString("en-NZ");
  const cell = { fontFamily: "'JetBrains Mono', monospace", fontSize: 13, textAlign: "right", whiteSpace: "nowrap" };

  const confirm = async () => {
    setSaving(true);
    const ok = await onMatch(chosen);
    setSaving(false);
    if (ok) onClose();
  };

  return createPortal(
    <>
      <div style={SHEET_BACKDROP_STYLE} />
      <div style={SHEET_PANEL_STYLE}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 18px", borderBottom: "1px solid #DDE0C8", flexShrink: 0 }}>
          <h2 style={{ fontFamily: "'Oswald', sans-serif", fontSize: 20, color: "#2A3324", margin: 0, fontWeight: 500 }}>Compare with Xero</h2>
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", color: "#5C6B54", cursor: "pointer", padding: 10 }}>
            <X size={20} />
          </button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
          <div style={{ padding: "14px 18px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 12.5, color: "#5C6B54", lineHeight: 1.5 }}>
              Xero's stock on hand next to Brewpoint's, in Brewpoint units (cans and kegs). Tick the lines to bring Brewpoint into line with Xero.
              Extra stock is written off from the oldest batch; missing stock goes back on the newest. Your packaging and excise records don't change, and you can undo it from Finished stock.
            </div>
            {unmatched.length > 0 && (
              <div style={{ background: "#FBF3DC", border: "1px solid #E3D3A0", borderRadius: 5, padding: "8px 10px", color: "#8A6D0B", fontSize: 12, lineHeight: 1.45 }}>
                Xero has stock of {unmatched.length} item{unmatched.length === 1 ? "" : "s"} not matched to a beer yet: {unmatched.map((i) => `${i.code} (${i.qtyOnHand})`).join(", ")}.{" "}
                <button onClick={onMatchItems} style={{ background: "none", border: "none", padding: 0, color: "#5C9A3C", textDecoration: "underline", fontSize: 12, cursor: "pointer" }}>Match Xero items</button>
              </div>
            )}
            {rows.length === 0 && <div style={{ color: "#9BA88A", fontSize: 13 }}>No stock in either Xero or Brewpoint to compare.</div>}
            {rows.length > 0 && (
              <div style={{ background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, overflow: "hidden" }}>
                <div style={{ display: "grid", gridTemplateColumns: "28px 1fr 64px 76px 64px", gap: 6, padding: "8px 10px", background: "#F5F1E4", fontSize: 10.5, letterSpacing: "0.05em", textTransform: "uppercase", color: "#5C6B54" }}>
                  <span />
                  <span>Product</span>
                  <span style={{ textAlign: "right" }}>Xero</span>
                  <span style={{ textAlign: "right" }}>Brewpoint</span>
                  <span style={{ textAlign: "right" }}>Change</span>
                </div>
                {rows.map((r) => {
                  const canPick = r.diff !== 0 && r.inXero && r.inBrewpoint;
                  return (
                    <label key={r.key} style={{ display: "grid", gridTemplateColumns: "28px 1fr 64px 76px 64px", gap: 6, alignItems: "center", padding: "9px 10px", borderTop: "1px solid #EEF0E2", cursor: canPick ? "pointer" : "default" }}>
                      <input type="checkbox" disabled={!canPick} checked={!!picked[r.key] && canPick} onChange={(e) => setPicked((prev) => ({ ...prev, [r.key]: e.target.checked }))} />
                      <span style={{ minWidth: 0 }}>
                        <span style={{ fontSize: 13, color: "#2A3324" }}>{r.name}</span>
                        <span style={{ display: "block", fontSize: 11, color: "#9BA88A" }}>
                          {containerShort(r.containerKey)}
                          {r.inXero ? ` · ${r.xeroItems.join(", ")}` : " · not matched to a Xero item"}
                          {r.inXero && !r.inBrewpoint ? " · never packaged in Brewpoint" : ""}
                        </span>
                      </span>
                      <span style={{ ...cell, color: r.inXero ? "#2A3324" : "#C3C9B0" }}>{r.inXero ? num(r.xero) : "—"}</span>
                      <span style={{ ...cell, color: "#2A3324" }}>{num(r.brewpoint)}</span>
                      <span style={{ ...cell, color: r.diff === 0 ? "#9BA88A" : r.diff > 0 ? "#5C9A3C" : "#B5502F" }}>{r.diff === 0 || !r.inXero ? "✓" : `${r.diff > 0 ? "+" : "−"}${num(Math.abs(r.diff))}`}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        <div style={{ flexShrink: 0, borderTop: "1px solid #DDE0C8", padding: "12px 18px", display: "flex", gap: 10 }}>
          <button onClick={confirm} disabled={saving || chosen.length === 0} style={{ ...auditPrimaryBtn(!saving && chosen.length > 0), flex: 2 }}>
            {saving ? "Updating…" : chosen.length === 0 ? "Everything matches" : `Match Brewpoint to Xero (${chosen.length})`}
          </button>
          <button onClick={onClose} style={{ ...auditSecondaryBtn, flex: 1 }}>Close</button>
        </div>
      </div>
    </>,
    document.body
  );
}

// Picks (or creates) the Xero contact this customer maps to. Kept
// deliberately simple — search the list Xero already has, or push this
// customer's details into Xero as a brand-new contact.
// Bulk-imports selected Xero contacts as new customers, already linked —
// for a brewery switching from Xero-only bookkeeping, so their existing
// customer list doesn't need retyping from scratch.
// Proactively maps recipes (by name, per container type) to Xero items —
// pre-fills the same xero_item_mappings table the app already checks the
// moment a batch is packaged, so a brewery bringing an existing product
// list from Xero doesn't have to wait for the first real batch of each
// beer to be prompted individually. Only carries through automatically
// to a future batch whose name matches the recipe's exactly — a batch
// named with a size or brew-day suffix still gets prompted as normal.
export function XeroProductMappingModal({ recipes, xeroItems, existingMappings, onClose, onSave }) {
  const [selections, setSelections] = useState(() => {
    const init = {};
    recipes.forEach((r) => {
      CONTAINERS.forEach((c) => {
        const key = productKeyFor(r.name, c.key);
        const existing = existingMappings.find((m) => m.product_key === key);
        init[`${r.id}:${c.key}`] = { itemCode: existing ? existing.xero_item_code : "", unitCost: existing ? String(existing.unit_cost) : "" };
      });
    });
    return init;
  });
  const [saving, setSaving] = useState(false);

  const setSelection = (recipeId, containerKey, patch) =>
    setSelections((prev) => ({ ...prev, [`${recipeId}:${containerKey}`]: { ...prev[`${recipeId}:${containerKey}`], ...patch } }));

  const submit = async () => {
    setSaving(true);
    const lines = [];
    recipes.forEach((r) => {
      CONTAINERS.forEach((c) => {
        const sel = selections[`${r.id}:${c.key}`];
        if (!sel.itemCode) return;
        const item = xeroItems.find((i) => i.itemCode === sel.itemCode);
        if (!item) return;
        lines.push({
          productKey: productKeyFor(r.name, c.key),
          productLabel: `${r.name} — ${c.label}`,
          itemCode: item.itemCode,
          itemName: item.name,
          unitCost: sel.unitCost === "" ? 0 : Number(sel.unitCost),
        });
      });
    });
    await onSave(lines);
    setSaving(false);
    onClose();
  };

  const mappedCount = Object.values(selections).filter((s) => s.itemCode).length;

  return (
    <Modal title="Map recipes to Xero items" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ color: "#5C6B54", fontSize: 13 }}>
          For each recipe, match its packaged sizes to the matching item already set up in Xero, and give it a unit cost — this is what gets recorded as the stock value in Xero each time it's packaged. Only applies automatically to a future batch whose name matches the recipe exactly; a differently-named batch still gets asked at packaging time, same as always.
        </div>
        {xeroItems.length === 0 ? (
          <div style={{ color: "#9BA88A", fontSize: 13 }}>Loading Xero items…</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16, maxHeight: 420, overflowY: "auto" }}>
            {recipes.map((r) => (
              <div key={r.id} style={{ background: "#F8F5EA", border: "1px solid #EBE8D6", borderRadius: 6, padding: "12px 14px" }}>
                <div style={{ fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 14, color: "#2A3324", marginBottom: 10 }}>{r.name}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {CONTAINERS.map((c) => {
                    const sel = selections[`${r.id}:${c.key}`];
                    return (
                      <div key={c.key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ width: 68, flexShrink: 0, color: "#5C6B54", fontSize: 12.5 }}>{c.shortLabel}</span>
                        <select
                          value={sel.itemCode}
                          onChange={(e) => setSelection(r.id, c.key, { itemCode: e.target.value })}
                          style={{ flex: 1, boxSizing: "border-box", background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 4, padding: "7px 8px", color: "#2A3324", fontFamily: "'Inter', sans-serif", fontSize: 13 }}
                        >
                          <option value="">Not mapped</option>
                          {xeroItems.map((item) => (
                            <option key={item.itemCode} value={item.itemCode}>
                              {item.name}
                            </option>
                          ))}
                        </select>
                        {sel.itemCode && (
                          <input
                            type="number"
                            step="0.01"
                            value={sel.unitCost}
                            onChange={(e) => setSelection(r.id, c.key, { unitCost: e.target.value })}
                            placeholder="Unit cost"
                            style={{ width: 84, flexShrink: 0, boxSizing: "border-box", background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 4, padding: "7px 8px", color: "#2A3324", fontFamily: "'Inter', sans-serif", fontSize: 13 }}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
        <button
          onClick={submit}
          disabled={saving || xeroItems.length === 0}
          style={{
            background: saving || xeroItems.length === 0 ? "#E8E4D4" : "#5C9A3C",
            border: "none",
            borderRadius: 5,
            padding: "12px",
            color: saving || xeroItems.length === 0 ? "#A3AC94" : "#16191A",
            fontFamily: "'Oswald', sans-serif",
            fontWeight: 500,
            fontSize: 15,
            cursor: saving || xeroItems.length === 0 ? "default" : "pointer",
          }}
        >
          {saving ? "Saving…" : `Save ${mappedCount} mapping${mappedCount !== 1 ? "s" : ""}`}
        </button>
      </div>
    </Modal>
  );
}

export function ImportXeroContactsModal({ contacts, existingCustomers, onClose, onImport }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(() => new Set());
  const [importing, setImporting] = useState(false);
  const q = query.trim().toLowerCase();

  const alreadyLinkedIds = new Set(existingCustomers.map((c) => c.xeroContactId).filter(Boolean));
  const importable = contacts.filter((c) => !alreadyLinkedIds.has(c.contactId));
  const filtered = q ? importable.filter((c) => c.name.toLowerCase().includes(q)) : importable;

  const toggle = (id) => setSelected((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const toggleAll = () => setSelected(selected.size === filtered.length ? new Set() : new Set(filtered.map((c) => c.contactId)));

  const submit = async () => {
    setImporting(true);
    await onImport(contacts.filter((c) => selected.has(c.contactId)));
    setImporting(false);
    onClose();
  };

  return (
    <Modal title="Import customers from Xero" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ color: "#5C6B54", fontSize: 13 }}>
          Tick the Xero contacts to bring in as customers — each one's created already linked to Xero, ready for invoicing.
          {existingCustomers.length > 0 && alreadyLinkedIds.size > 0 && ` ${alreadyLinkedIds.size} already linked contact${alreadyLinkedIds.size !== 1 ? "s" : ""} hidden below.`}
        </div>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search Xero contacts…"
          style={{ width: "100%", boxSizing: "border-box", background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 5, padding: "9px 10px", color: "#2A3324", fontFamily: "'Inter', sans-serif", fontSize: 14 }}
        />
        {filtered.length > 0 && (
          <button onClick={toggleAll} style={{ alignSelf: "flex-start", background: "none", border: "none", color: "#5C9A3C", fontSize: 12.5, cursor: "pointer", padding: 0 }}>
            {selected.size === filtered.length ? "Deselect all" : `Select all (${filtered.length})`}
          </button>
        )}
        {contacts.length === 0 ? (
          <div style={{ color: "#9BA88A", fontSize: 13 }}>Loading Xero contacts…</div>
        ) : filtered.length === 0 ? (
          <div style={{ color: "#9BA88A", fontSize: 13 }}>{q ? `No contacts match "${query}".` : "Every Xero contact is already linked."}</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 320, overflowY: "auto" }}>
            {filtered.map((c) => (
              <label
                key={c.contactId}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "#F8F5EA", border: "1px solid #EBE8D6", borderRadius: 5, fontSize: 13.5, color: "#2A3324", cursor: "pointer" }}
              >
                <input type="checkbox" checked={selected.has(c.contactId)} onChange={() => toggle(c.contactId)} style={{ flexShrink: 0, width: 17, height: 17 }} />
                {c.name}
              </label>
            ))}
          </div>
        )}
        <button
          onClick={submit}
          disabled={selected.size === 0 || importing}
          style={{
            background: selected.size === 0 || importing ? "#E8E4D4" : "#5C9A3C",
            border: "none",
            borderRadius: 5,
            padding: "12px",
            color: selected.size === 0 || importing ? "#A3AC94" : "#16191A",
            fontFamily: "'Oswald', sans-serif",
            fontWeight: 500,
            fontSize: 15,
            cursor: selected.size === 0 || importing ? "default" : "pointer",
          }}
        >
          {importing ? "Importing…" : `Import ${selected.size} customer${selected.size !== 1 ? "s" : ""}`}
        </button>
      </div>
    </Modal>
  );
}

export function XeroContactLinkModal({ customer, contacts, onClose, onLink, onCreate }) {
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const q = query.trim().toLowerCase();
  const filtered = q ? contacts.filter((c) => c.name.toLowerCase().includes(q)) : contacts;

  return (
    <Modal title={`Link ${customer.name} to Xero`} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <button
          onClick={async () => {
            setCreating(true);
            await onCreate(customer);
            setCreating(false);
          }}
          disabled={creating}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 7,
            background: "#5C9A3C",
            border: "none",
            borderRadius: 5,
            padding: "11px",
            color: "#16191A",
            fontFamily: "'Oswald', sans-serif",
            fontWeight: 500,
            fontSize: 13.5,
            cursor: creating ? "default" : "pointer",
          }}
        >
          <Plus size={15} /> {creating ? "Creating…" : `Create "${customer.name}" as a new Xero contact`}
        </button>

        <div style={{ color: "#9BA88A", fontSize: 12, textAlign: "center" }}>— or link to an existing one —</div>

        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search Xero contacts…"
          style={{
            width: "100%",
            boxSizing: "border-box",
            background: "#F5F1E4",
            border: "1px solid #DDE0C8",
            borderRadius: 5,
            padding: "9px 10px",
            color: "#2A3324",
            fontFamily: "'Inter', sans-serif",
            fontSize: 14,
          }}
        />

        {contacts.length === 0 ? (
          <div style={{ color: "#9BA88A", fontSize: 13 }}>Loading Xero contacts…</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 280, overflowY: "auto" }}>
            {filtered.map((c) => (
              <button
                key={c.contactId}
                onClick={() => onLink(customer.id, c.contactId, c.name)}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "10px 12px",
                  background: "#F8F5EA",
                  border: "1px solid #EBE8D6",
                  borderRadius: 5,
                  fontSize: 13.5,
                  color: "#2A3324",
                  textAlign: "left",
                  cursor: "pointer",
                  width: "100%",
                  boxSizing: "border-box",
                }}
              >
                {c.name}
              </button>
            ))}
            {filtered.length === 0 && <div style={{ color: "#9BA88A", fontSize: 13 }}>No contacts match "{query}".</div>}
          </div>
        )}
      </div>
    </Modal>
  );
}

export function XeroMappingModal({ queue, xeroItems, onConfirm, onClose }) {
  const [lineData, setLineData] = useState(() => {
    const init = {};
    queue.lines.forEach((l) => {
      init[l.productKey] = { itemCode: "", itemName: "", unitCost: "0", query: "" };
    });
    return init;
  });
  const [focusedLine, setFocusedLine] = useState(null);

  const updateLine = (productKey, patch) =>
    setLineData((prev) => ({ ...prev, [productKey]: { ...prev[productKey], ...patch } }));

  const matches = (query) =>
    query.trim().length === 0 ? xeroItems : xeroItems.filter((it) => it.name.toLowerCase().includes(query.trim().toLowerCase()));

  const submit = () => {
    const resolvedLines = queue.lines.map((l) => ({
      productKey: l.productKey,
      productLabel: l.productLabel,
      qty: l.qty,
      itemCode: lineData[l.productKey].itemCode,
      itemName: lineData[l.productKey].itemName,
      unitCost: lineData[l.productKey].unitCost,
    }));
    onConfirm(resolvedLines);
  };

  return (
    <Modal title="Match to Xero items" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ color: "#5C6B54", fontSize: 13, lineHeight: 1.5 }}>
          These products haven't been linked to a Xero item yet. Match them below — this only needs doing once per
          product, future packaging runs will sync automatically. Leave any blank to skip syncing that one.
        </div>
        {queue.lines.map((l) => {
          const line = lineData[l.productKey];
          return (
            <div key={l.productKey} style={{ background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 6, padding: "10px 12px" }}>
              <div style={{ color: "#2A3324", fontSize: 13.5, marginBottom: 8 }}>
                {l.productLabel} <span style={{ color: "#9BA88A", fontFamily: "'JetBrains Mono', monospace", fontSize: 11.5 }}>× {l.qty}</span>
              </div>
              <div style={{ position: "relative", marginBottom: 8 }}>
                <input
                  type="text"
                  value={line.itemCode ? line.itemName : line.query}
                  onChange={(e) => updateLine(l.productKey, { query: e.target.value, itemCode: "", itemName: "" })}
                  onFocus={() => setFocusedLine(l.productKey)}
                  onBlur={() => setTimeout(() => setFocusedLine((cur) => (cur === l.productKey ? null : cur)), 150)}
                  placeholder="Search Xero items…"
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    background: "#FFFFFF",
                    border: "1px solid #DDE0C8",
                    borderRadius: 4,
                    padding: "8px 9px",
                    color: "#2A3324",
                    fontFamily: "'Inter', sans-serif",
                    fontSize: 13,
                  }}
                />
                {focusedLine === l.productKey && (
                  <div
                    style={{
                      position: "absolute",
                      top: "100%",
                      left: 0,
                      right: 0,
                      marginTop: 4,
                      maxHeight: 160,
                      overflowY: "auto",
                      background: "#F8F5EA",
                      border: "1px solid #DDE0C8",
                      borderRadius: 6,
                      zIndex: 20,
                    }}
                  >
                    {matches(line.query).map((it) => (
                      <button
                        key={it.code}
                        onMouseDown={() => {
                          updateLine(l.productKey, { itemCode: it.code, itemName: it.name, query: "" });
                          setFocusedLine(null);
                        }}
                        style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", padding: "8px 9px", color: "#2A3324", fontSize: 13, cursor: "pointer" }}
                      >
                        {it.name}
                      </button>
                    ))}
                    {matches(line.query).length === 0 && (
                      <div style={{ padding: "8px 9px", color: "#9BA88A", fontSize: 12.5 }}>No matching items in Xero.</div>
                    )}
                  </div>
                )}
              </div>
              <NumberField label="Unit cost (for the Xero entry)" value={line.unitCost} onChange={(v) => updateLine(l.productKey, { unitCost: v })} step="0.01" />
            </div>
          );
        })}
        <button
          onClick={submit}
          style={{
            background: "#5C9A3C",
            border: "none",
            borderRadius: 5,
            padding: "12px",
            color: "#16191A",
            fontFamily: "'Oswald', sans-serif",
            fontWeight: 500,
            fontSize: 15,
            letterSpacing: "0.03em",
            cursor: "pointer",
          }}
        >
          Save & sync to Xero
        </button>
      </div>
    </Modal>
  );
}

export function XeroCallback() {
  const [status, setStatus] = useState("connecting");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const companyId = params.get("state");
    const errorParam = params.get("error");

    if (errorParam) {
      setStatus("error");
      setMessage(`Xero said: ${errorParam}`);
      return;
    }
    if (!code || !companyId) {
      setStatus("error");
      setMessage("Missing information from Xero's redirect — try connecting again.");
      return;
    }

    (async () => {
      let userName = null;
      let token = null;
      try {
        const { data } = await supabase.auth.getSession();
        userName = data.session?.user?.user_metadata?.name || null;
        token = data.session?.access_token || null;
      } catch {
        // ignore — connected_by is just informational
      }
      if (!token) {
        setStatus("error");
        setMessage("You need to be signed in to finish connecting Xero — try connecting again.");
        return;
      }

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      const functionUrl = `${supabaseUrl}/functions/v1/xero-callback`;
      try {
        const res = await fetch(functionUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            apikey: anonKey,
          },
          body: JSON.stringify({ code, companyId, userName }),
        });
        const data = await res.json();
        if (!res.ok || data.error) {
          setStatus("error");
          const baseMsg = typeof data.error === "string" ? data.error : "Something went wrong connecting to Xero.";
          const detailStr = data.detail ? (typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail)) : "";
          const debugStr = data.debug ? JSON.stringify(data.debug) : "";
          setMessage([baseMsg, detailStr, debugStr].filter(Boolean).join(" — "));
        } else {
          setStatus("success");
          setMessage(`Connected to ${data.tenantName}.`);
          setTimeout(() => {
            window.location.href = "/?view=settings";
          }, 2000);
        }
      } catch {
        setStatus("error");
        setMessage("Couldn't reach the connection service — check your internet and try again.");
      }
    })();
  }, []);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#F5F1E4",
        fontFamily: "'Inter', sans-serif",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px 18px",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600&family=Inter:wght@400;500;600&display=swap');
      `}</style>
      <div style={{ textAlign: "center", maxWidth: 340 }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
          <BreworxMark size={44} />
        </div>
        <h1 style={{ fontFamily: "'Oswald', sans-serif", color: "#2A3324", fontSize: 20, fontWeight: 500, margin: "0 0 8px" }}>
          {status === "connecting" && "Connecting to Xero…"}
          {status === "success" && "Connected"}
          {status === "error" && "Couldn't connect"}
        </h1>
        <p style={{ color: "#5C6B54", fontSize: 14, lineHeight: 1.5 }}>{message}</p>
        {status === "error" && (
          <button
            onClick={() => (window.location.href = "/")}
            style={{
              marginTop: 16,
              background: "#5C9A3C",
              border: "none",
              borderRadius: 5,
              padding: "10px 18px",
              color: "#16191A",
              fontFamily: "'Oswald', sans-serif",
              fontWeight: 500,
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            Back to Brewpoint
          </button>
        )}
      </div>
    </div>
  );
}
