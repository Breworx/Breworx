import { useState, useMemo } from "react";
import { createPortal } from "react-dom";
import { X, Package, Trash2 } from "lucide-react";
import { auditPrimaryBtn, auditSecondaryBtn } from "./excise";
import { EmptyState, Modal, NumberField, SHEET_BACKDROP_STYLE, SHEET_PANEL_STYLE, TextField } from "./ui";
import { CANS_PER_CASE, CONTAINERS, packagingEvents, uid } from "../lib/production";

// Live available-to-sell stock, per beer and container — the same numbers
// the order picker already uses, just surfaced as its own page. Stays in
// sync automatically: packaging a batch adds to it, confirming/fulfilling
// an order subtracts, cancelling an order gives it straight back.
export function MixedPackTypeModal({ products, editingType, onClose, onSave }) {
  const [name, setName] = useState(editingType?.name || "");
  const [totalUnits, setTotalUnits] = useState(editingType ? String(editingType.totalUnits) : "6");
  const [mode, setMode] = useState(editingType?.mode || "flexible");
  const [price, setPrice] = useState(editingType?.price != null ? String(editingType.price) : "");
  const [lines, setLines] = useState(
    editingType?.fixedComposition?.length
      ? editingType.fixedComposition.map((l) => ({ id: uid(), ...l }))
      : []
  );

  const lineTotal = lines.reduce((sum, l) => sum + (Number(l.qty) || 0), 0);

  const addLine = () => setLines((prev) => [...prev, { id: uid(), productKey: "", qty: 1 }]);
  const updateLine = (id, patch) => setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const removeLine = (id) => setLines((prev) => prev.filter((l) => l.id !== id));

  const submit = () => {
    if (!name.trim() || !totalUnits || Number(totalUnits) <= 0) return;
    if (mode === "fixed" && lines.length === 0) return;
    const fixedComposition =
      mode === "fixed"
        ? lines
            .filter((l) => l.productKey)
            .map((l) => {
              const p = products.find((pr) => pr.key === l.productKey);
              return { batchName: p?.batchName, containerKey: p?.containerKey, containerLabel: p?.containerLabel, qty: Number(l.qty) || 0 };
            })
        : [];
    onSave({
      id: editingType?.id || uid(),
      name: name.trim(),
      totalUnits: Number(totalUnits),
      mode,
      fixedComposition,
      price: price === "" ? null : Number(price),
    });
    onClose();
  };

  return (
    <Modal title={editingType ? "Edit mixed pack" : "New mixed pack type"} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <TextField label="Name" value={name} onChange={setName} placeholder="e.g. Variety 6-pack" />
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <NumberField label="Total units" value={totalUnits} onChange={setTotalUnits} step="1" />
          </div>
          <div style={{ flex: 1 }}>
            <NumberField label="Price (optional)" value={price} onChange={setPrice} step="0.01" />
          </div>
        </div>

        <div>
          <div style={{ color: "#9BA88A", fontSize: 11, marginBottom: 6 }}>Composition</div>
          <div style={{ display: "flex", border: "1px solid #DDE0C8", borderRadius: 4, overflow: "hidden" }}>
            {[
              ["fixed", "Fixed — always the same"],
              ["flexible", "Flexible — pick each time"],
            ].map(([m, label]) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                style={{
                  flex: 1,
                  background: mode === m ? "#5C9A3C" : "#F5F1E4",
                  border: "none",
                  padding: "9px",
                  color: mode === m ? "#16191A" : "#5C6B54",
                  fontFamily: "'Inter', sans-serif",
                  fontSize: 12.5,
                  cursor: "pointer",
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {mode === "fixed" && (
          <div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {lines.map((l) => (
                <div key={l.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <select
                    value={l.productKey}
                    onChange={(e) => updateLine(l.id, { productKey: e.target.value })}
                    style={{ flex: 1, boxSizing: "border-box", background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 4, padding: "8px 10px", color: "#2A3324", fontFamily: "'Inter', sans-serif", fontSize: 13 }}
                  >
                    <option value="">Pick a beer…</option>
                    {products.map((p) => (
                      <option key={p.key} value={p.key}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min="1"
                    value={l.qty}
                    onChange={(e) => updateLine(l.id, { qty: e.target.value })}
                    style={{ width: 60, boxSizing: "border-box", background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 4, padding: "8px", color: "#2A3324", fontFamily: "'JetBrains Mono', monospace", fontSize: 13, textAlign: "center" }}
                  />
                  <button onClick={() => removeLine(l.id)} aria-label="Remove" style={{ background: "none", border: "none", color: "#9BA88A", cursor: "pointer", padding: 4 }}>
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
            <button
              onClick={addLine}
              style={{ marginTop: 8, background: "none", border: "1px dashed #C9D1AC", borderRadius: 5, padding: "8px", width: "100%", color: "#5C6B54", fontFamily: "'Inter', sans-serif", fontSize: 12.5, cursor: "pointer" }}
            >
              + Add beer
            </button>
            <div style={{ color: lineTotal === Number(totalUnits) ? "#5C9A3C" : "#B5502F", fontSize: 12, marginTop: 8 }}>
              {lineTotal} of {totalUnits || 0} units set
            </div>
          </div>
        )}

        <button
          onClick={submit}
          style={{ background: "#5C9A3C", border: "none", borderRadius: 5, padding: "12px", color: "#16191A", fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 15, letterSpacing: "0.03em", cursor: "pointer" }}
        >
          Save
        </button>
      </div>
    </Modal>
  );
}

export function AssembleMixedPackModal({ mixedPackType, availableStock, onClose, onSave }) {
  const [quantity, setQuantity] = useState("1");
  const [flexLines, setFlexLines] = useState([{ id: uid(), productKey: "", qtyPerPack: 1 }]);

  const products = availableStock
    .filter((s) => s.available > 0)
    .map((s) => ({ key: `${s.batchId}::${s.containerKey}`, label: `${s.batchName} — ${s.containerLabel}`, available: s.available, ...s }));

  const isFixed = mixedPackType.mode === "fixed";

  // Fixed mode: automatically find a real, currently-in-stock batch that
  // matches each line in the recipe — the recipe says "an IPA can", not
  // "batch #47's IPA can", since which specific batch is available
  // changes over time.
  const resolvedFixed = isFixed
    ? mixedPackType.fixedComposition.map((line) => {
        const match = availableStock.find((s) => s.batchName === line.batchName && s.containerKey === line.containerKey && s.available > 0);
        return match ? { ...line, batchId: match.batchId, available: match.available } : { ...line, batchId: null, available: 0 };
      })
    : [];
  const fixedShortfall = resolvedFixed.filter((l) => !l.batchId || l.available < l.qty * Number(quantity || 1));

  const flexTotal = flexLines.reduce((sum, l) => sum + (Number(l.qtyPerPack) || 0), 0);
  const addFlexLine = () => setFlexLines((prev) => [...prev, { id: uid(), productKey: "", qtyPerPack: 1 }]);
  const updateFlexLine = (id, patch) => setFlexLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const removeFlexLine = (id) => setFlexLines((prev) => prev.filter((l) => l.id !== id));

  const canSubmit = isFixed
    ? fixedShortfall.length === 0 && Number(quantity) > 0
    : flexTotal === mixedPackType.totalUnits && flexLines.every((l) => l.productKey) && Number(quantity) > 0;

  const submit = () => {
    if (!canSubmit) return;
    const composition = isFixed
      ? resolvedFixed.map((l) => ({ batchId: l.batchId, batchName: l.batchName, containerKey: l.containerKey, containerLabel: l.containerLabel, qtyPerPack: l.qty }))
      : flexLines.map((l) => {
          const p = products.find((pr) => pr.key === l.productKey);
          return { batchId: p.batchId, batchName: p.batchName, containerKey: p.containerKey, containerLabel: p.containerLabel, qtyPerPack: Number(l.qtyPerPack) };
        });
    onSave({ quantity: Number(quantity), composition });
    onClose();
  };

  return (
    <Modal title={`Assemble ${mixedPackType.name}`} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <NumberField label="How many packs to assemble" value={quantity} onChange={setQuantity} step="1" />

        {isFixed ? (
          <div>
            <div style={{ color: "#9BA88A", fontSize: 11, marginBottom: 6 }}>This pack's recipe</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {resolvedFixed.map((l, i) => {
                const short = !l.batchId || l.available < l.qty * Number(quantity || 1);
                return (
                  <div
                    key={i}
                    style={{ display: "flex", justifyContent: "space-between", padding: "8px 10px", background: short ? "#FBE5D2" : "#F8F5EA", border: `1px solid ${short ? "#E3B37A" : "#EBE8D6"}`, borderRadius: 5, fontSize: 13 }}
                  >
                    <span style={{ color: "#2A3324" }}>
                      {l.qty} × {l.batchName || "—"} ({l.containerLabel})
                    </span>
                    <span style={{ color: short ? "#B5502F" : "#9BA88A", fontSize: 11.5 }}>
                      {l.batchId ? `${l.available} available` : "not currently in stock"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div>
            <div style={{ color: "#9BA88A", fontSize: 11, marginBottom: 6 }}>
              Build this pack — {flexTotal} of {mixedPackType.totalUnits} units picked
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {flexLines.map((l) => (
                <div key={l.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <select
                    value={l.productKey}
                    onChange={(e) => updateFlexLine(l.id, { productKey: e.target.value })}
                    style={{ flex: 1, boxSizing: "border-box", background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 4, padding: "8px 10px", color: "#2A3324", fontFamily: "'Inter', sans-serif", fontSize: 13 }}
                  >
                    <option value="">Pick a beer…</option>
                    {products.map((p) => (
                      <option key={p.key} value={p.key}>
                        {p.label} ({p.available} available)
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min="1"
                    value={l.qtyPerPack}
                    onChange={(e) => updateFlexLine(l.id, { qtyPerPack: e.target.value })}
                    style={{ width: 60, boxSizing: "border-box", background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 4, padding: "8px", color: "#2A3324", fontFamily: "'JetBrains Mono', monospace", fontSize: 13, textAlign: "center" }}
                  />
                  <button onClick={() => removeFlexLine(l.id)} aria-label="Remove" style={{ background: "none", border: "none", color: "#9BA88A", cursor: "pointer", padding: 4 }}>
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
            <button
              onClick={addFlexLine}
              style={{ marginTop: 8, background: "none", border: "1px dashed #C9D1AC", borderRadius: 5, padding: "8px", width: "100%", color: "#5C6B54", fontFamily: "'Inter', sans-serif", fontSize: 12.5, cursor: "pointer" }}
            >
              + Add beer
            </button>
          </div>
        )}

        <button
          onClick={submit}
          disabled={!canSubmit}
          style={{ background: canSubmit ? "#5C9A3C" : "#E8E4D4", border: "none", borderRadius: 5, padding: "12px", color: canSubmit ? "#16191A" : "#A3AC94", fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 15, letterSpacing: "0.03em", cursor: canSubmit ? "pointer" : "default" }}
        >
          Assemble {quantity || 0} pack{Number(quantity) !== 1 ? "s" : ""}
        </button>
      </div>
    </Modal>
  );
}

// Every clear-out ever made, newest first — rebuilt from the entries on each
// batch so one clear-out spread over many batches shows (and undoes) as one.
export function stockClearHistory(batches) {
  const byId = {};
  batches.forEach((b) => {
    (b.stockCleared || []).forEach((e) => {
      if (!byId[e.id]) byId[e.id] = { id: e.id, date: e.date, user: e.user, reason: e.reason, kind: e.kind, counts: {}, batches: 0 };
      const h = byId[e.id];
      h.batches += 1;
      Object.entries(e.counts || {}).forEach(([k, v]) => (h.counts[k] = (h.counts[k] || 0) + v));
    });
  });
  return Object.values(byId).sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

// Cans are counted in cases of 24: "12 cases", or "12 cases + 6 cans".
export const canCasesText = (n) => {
  const cans = Math.round(Number(n) || 0);
  const sign = cans < 0 ? "-" : "";
  const abs = Math.abs(cans);
  const cases = Math.floor(abs / CANS_PER_CASE);
  const loose = abs % CANS_PER_CASE;
  const parts = [];
  if (cases || !loose) parts.push(`${cases} case${cases === 1 ? "" : "s"}`);
  if (loose) parts.push(`${loose} can${loose === 1 ? "" : "s"}`);
  return sign + parts.join(" + ");
};
export const containerCountsLabel = (counts) =>
  CONTAINERS.filter((c) => counts[c.key])
    .map((c) => {
      const n = counts[c.key];
      const qty = c.key === "cans330" ? canCasesText(Math.abs(n)) : `${Math.abs(n)} × ${c.shortLabel}`;
      return n < 0 ? `${qty} put back` : qty;
    })
    .join(", ");

export const lastPackagedDate = (b) => packagingEvents(b).reduce((m, e) => (e.date && e.date > m ? e.date : m), "");

// Clears packaged stock in bulk — for starting stock control fresh (say in
// Xero) without deleting or changing the packaging behind it, which the
// excise records depend on. Pick what to keep: everything packaged from a
// date, and/or a number of units per product. Kept units come from the
// newest batches, so what's left is the freshest beer.
export function ClearStockModal({ availableStock, batches, onClose, onConfirm }) {
  const [keepFrom, setKeepFrom] = useState("");
  const [keep, setKeep] = useState({});
  const [reason, setReason] = useState("Cleared before connecting Xero stock — already sold or accounted for");
  const [saving, setSaving] = useState(false);
  const batchById = useMemo(() => Object.fromEntries(batches.map((b) => [b.id, b])), [batches]);

  const products = useMemo(() => {
    const map = {};
    availableStock
      .filter((s) => s.available > 0)
      .forEach((s) => {
        const key = `${s.batchName}::${s.containerKey}`;
        if (!map[key]) map[key] = { key, name: s.batchName, containerKey: s.containerKey, containerLabel: s.containerLabel, rows: [], available: 0 };
        map[key].rows.push({ ...s, packedOn: lastPackagedDate(batchById[s.batchId] || {}) });
        map[key].available += s.available;
      });
    return Object.values(map).sort((a, b) => a.name.localeCompare(b.name) || a.containerKey.localeCompare(b.containerKey));
  }, [availableStock, batchById]);

  const plan = useMemo(() => {
    const perBatch = {};
    let cleared = 0;
    let kept = 0;
    let clearedL = 0;
    products.forEach((p) => {
      const newestFirst = [...p.rows].sort((a, b) => b.packedOn.localeCompare(a.packedOn));
      const byDate = keepFrom ? newestFirst.filter((r) => r.packedOn >= keepFrom).reduce((s2, r) => s2 + r.available, 0) : 0;
      const typed = Math.max(0, Math.floor(Number(keep[p.key]) || 0));
      let toKeep = Math.min(p.available, Math.max(typed, byDate));
      kept += toKeep;
      newestFirst.forEach((r) => {
        const k = Math.min(r.available, toKeep);
        toKeep -= k;
        const clear = r.available - k;
        if (clear > 0) {
          if (!perBatch[r.batchId]) perBatch[r.batchId] = {};
          perBatch[r.batchId][p.containerKey] = (perBatch[r.batchId][p.containerKey] || 0) + clear;
          cleared += clear;
          clearedL += clear * (CONTAINERS.find((c) => c.key === p.containerKey)?.volumeL || 0);
        }
      });
    });
    return { perBatch, cleared, kept, clearedL: Math.round(clearedL) };
  }, [products, keep, keepFrom]);

  const keptFor = (p) => {
    const byDate = keepFrom ? p.rows.filter((r) => r.packedOn >= keepFrom).reduce((s2, r) => s2 + r.available, 0) : 0;
    return Math.min(p.available, Math.max(Math.floor(Number(keep[p.key]) || 0), byDate));
  };

  const confirm = async () => {
    setSaving(true);
    const ok = await onConfirm(plan.perBatch, reason.trim());
    setSaving(false);
    if (ok) onClose();
  };

  return createPortal(
    <>
    <div style={SHEET_BACKDROP_STYLE} />
    <div style={SHEET_PANEL_STYLE}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 18px", borderBottom: "1px solid #DDE0C8", flexShrink: 0 }}>
        <h2 style={{ fontFamily: "'Oswald', sans-serif", fontSize: 20, color: "#2A3324", margin: 0, fontWeight: 500 }}>Clear packaged stock</h2>
        <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", color: "#5C6B54", cursor: "pointer", padding: 10 }}>
          <X size={20} />
        </button>
      </div>
      <div style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
        <div style={{ maxWidth: 640, margin: "0 auto", padding: "16px 18px 24px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ fontSize: 12.5, color: "#5C6B54", lineHeight: 1.55 }}>
            Writes stock off so what's on hand starts fresh. Your batches and packaging records — and so your excise figures — don't change, and you can undo a clear-out afterwards. Anything you keep comes from the newest batches.
          </div>
          <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B54" }}>Keep everything packaged on or after (optional)</span>
            <input type="date" value={keepFrom} onChange={(e) => setKeepFrom(e.target.value)} style={{ background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 4, padding: "9px 10px", fontSize: 14, color: "#2A3324" }} />
          </label>
          <div style={{ fontSize: 12, color: "#9BA88A" }}>Or type how many to keep for each product below. Leave at 0 to clear it all.</div>
          {products.length === 0 && <div style={{ color: "#9BA88A", fontSize: 13 }}>There's no packaged stock to clear.</div>}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {products.map((p) => (
              <div key={p.key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, color: "#2A3324" }}>{p.name}</div>
                  <div style={{ fontSize: 11.5, color: "#9BA88A" }}>
                    {p.containerLabel} · {p.available} on hand · clears {p.available - keptFor(p)}
                  </div>
                </div>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#5C6B54" }}>
                  Keep
                  <input
                    type="number"
                    inputMode="numeric"
                    min="0"
                    max={p.available}
                    value={keep[p.key] ?? ""}
                    placeholder={String(keptFor(p))}
                    onChange={(e) => setKeep((prev) => ({ ...prev, [p.key]: e.target.value }))}
                    style={{ width: 70, background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 4, padding: "7px 8px", fontSize: 14, color: "#2A3324", fontFamily: "'JetBrains Mono', monospace" }}
                  />
                </label>
              </div>
            ))}
          </div>
          <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B54" }}>Reason (kept on record)</span>
            <input value={reason} onChange={(e) => setReason(e.target.value)} style={{ background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 4, padding: "9px 10px", fontSize: 14, color: "#2A3324" }} />
          </label>
        </div>
      </div>
      <div style={{ flexShrink: 0, borderTop: "1px solid #DDE0C8", background: "#F8F5EA", padding: "12px 18px", display: "flex", justifyContent: "center" }}>
        <div style={{ width: "100%", maxWidth: 640, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 12.5, color: "#5C6B54", textAlign: "center" }}>
            Clearing {plan.cleared.toLocaleString("en-NZ")} units (about {plan.clearedL.toLocaleString("en-NZ")} L) · keeping {plan.kept.toLocaleString("en-NZ")}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={confirm} disabled={saving || plan.cleared === 0 || !reason.trim()} style={{ ...auditPrimaryBtn(!saving && plan.cleared > 0 && !!reason.trim()), flex: 2 }}>
              {saving ? "Clearing…" : "Clear stock"}
            </button>
            <button onClick={onClose} style={{ ...auditSecondaryBtn, flex: 1 }}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
    </>,
    document.body
  );
}

export function FinishedGoodsStockView({
  availableStock,
  onStartStockTake,
  onOpenHistory,
  stockTakeCount,
  mixedPackTypes,
  mixedPackStock,
  onNewMixedPackType,
  onEditMixedPackType,
  onAssembleMixedPack,
  batches = [],
  onClearStock,
  onUndoClear,
  onCompareXero,
  readOnly,
  xeroNeedsReconnect,
}) {
  const [showSoldOut, setShowSoldOut] = useState(false);
  // On hand means available right now — sold-out and cleared lines stay
  // hidden unless asked for.
  const everPackaged = availableStock.filter((s) => s.packaged > 0);
  const relevant = showSoldOut ? everPackaged : everPackaged.filter((s) => s.available > 0);
  const soldOutCount = everPackaged.filter((s) => s.available <= 0).length;
  const clearHistory = stockClearHistory(batches);
  const grouped = {};
  relevant.forEach((s) => {
    if (!grouped[s.batchName]) grouped[s.batchName] = [];
    grouped[s.batchName].push(s);
  });
  const beerNames = Object.keys(grouped).sort();

  return (
    <div>
      {xeroNeedsReconnect && (
        <div style={{ background: "#FBE5D2", border: "1px solid #E3B37A", borderRadius: 6, padding: "10px 12px", color: "#7A3E1D", fontSize: 13, marginBottom: 14, lineHeight: 1.5 }}>
          Xero has disconnected, so sales from Xero (and Upstock) aren't coming off stock. Go to Settings → Xero and connect it again.
        </div>
      )}
      {!readOnly && <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
        <button
          data-tour="page-finishedGoodsStock-stocktake"
          onClick={onStartStockTake}
          style={{ flex: 1, background: "#EBE8D6", border: "1px solid #C9D1AC", borderRadius: 5, padding: "9px", color: "#2A3324", fontFamily: "'Inter', sans-serif", fontSize: 12.5, cursor: "pointer" }}
        >
          Start stock take
        </button>
        <button
          onClick={onOpenHistory}
          style={{ flex: 1, background: "none", border: "1px solid #DDE0C8", borderRadius: 5, padding: "9px", color: "#5C6B54", fontFamily: "'Inter', sans-serif", fontSize: 12.5, cursor: "pointer" }}
        >
          Past reports ({stockTakeCount})
        </button>
        {onClearStock && (
          <button
            onClick={onClearStock}
            style={{ flex: 1, background: "none", border: "1px solid #DDE0C8", borderRadius: 5, padding: "9px", color: "#B5502F", fontFamily: "'Inter', sans-serif", fontSize: 12.5, cursor: "pointer" }}
          >
            Clear stock…
          </button>
        )}
      </div>}
      {!readOnly && onCompareXero && (
        <button
          onClick={onCompareXero}
          style={{ width: "100%", marginTop: -8, marginBottom: 18, background: "#EBE8D6", border: "1px solid #C9D1AC", borderRadius: 5, padding: "9px", color: "#2A3324", fontFamily: "'Inter', sans-serif", fontSize: 12.5, cursor: "pointer" }}
        >
          Compare with Xero
        </button>
      )}

      {!readOnly && clearHistory.length > 0 && (
        <div style={{ marginBottom: 20, display: "flex", flexDirection: "column", gap: 6 }}>
          {clearHistory.map((h) => (
            <div key={h.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "9px 12px", background: "#FBF7EA", border: "1px solid #E8DFC0", borderRadius: 6 }}>
              <div style={{ fontSize: 12, color: "#5C6B54", lineHeight: 1.45 }}>
                <strong style={{ color: "#2A3324" }}>{h.kind === "xero-match" ? "Matched to Xero" : "Cleared"} {String(h.date).slice(0, 10)}</strong> by {h.user || "someone"} — {containerCountsLabel(h.counts)}
                {h.reason ? <div style={{ color: "#9BA88A" }}>{h.reason}</div> : null}
              </div>
              {onUndoClear && (
                <button
                  onClick={() => {
                    if (window.confirm(h.kind === "xero-match" ? "Undo this Xero match? Stock goes back to what it was before." : "Undo this clear-out? That stock will show as on hand again.")) onUndoClear(h.id);
                  }}
                  style={{ background: "none", border: "1px solid #DDE0C8", borderRadius: 5, padding: "6px 10px", color: "#5C6B54", fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}
                >
                  Undo
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 14.5, color: "#2A3324" }}>Mixed packs</div>
          {!readOnly && <button
            onClick={onNewMixedPackType}
            style={{ background: "none", border: "none", color: "#5C9A3C", cursor: "pointer", fontSize: 12, fontFamily: "'Inter', sans-serif", padding: 0 }}
          >
            + New mixed pack
          </button>}
        </div>
        {mixedPackTypes.length === 0 ? (
          <div style={{ color: "#9BA88A", fontSize: 13 }}>
            Combine beers already in stock into a variety pack — fixed recipe or built fresh each time.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {mixedPackStock.map((t) => (
              <div key={t.id} style={{ padding: "10px 14px", background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <button onClick={() => !readOnly && onEditMixedPackType(t)} style={{ background: "none", border: "none", padding: 0, textAlign: "left", cursor: readOnly ? "default" : "pointer" }}>
                    <div style={{ color: "#2A3324", fontSize: 13.5, fontFamily: "'Inter', sans-serif" }}>{t.name}</div>
                    <div style={{ color: "#9BA88A", fontSize: 11 }}>
                      {t.mode === "fixed" ? "Fixed recipe" : "Built fresh each time"} · {t.totalUnits} units
                      {t.price != null ? ` · $${t.price.toFixed(2)}` : ""}
                    </div>
                  </button>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: t.available <= 0 ? "#B5502F" : "#5C9A3C" }}>
                      {t.available} available
                    </span>
                    {!readOnly && <button
                      onClick={() => onAssembleMixedPack(t)}
                      style={{ background: "#EBE8D6", border: "1px solid #C9D1AC", borderRadius: 5, padding: "7px 12px", color: "#2A3324", fontFamily: "'Inter', sans-serif", fontSize: 12, cursor: "pointer" }}
                    >
                      Assemble
                    </button>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 14.5, color: "#2A3324" }}>{showSoldOut ? "All packaged stock" : "In stock now"}</div>
        {soldOutCount > 0 && (
          <button onClick={() => setShowSoldOut((v) => !v)} style={{ background: "none", border: "none", color: "#5C9A3C", cursor: "pointer", fontSize: 12, fontFamily: "'Inter', sans-serif", padding: 0 }}>
            {showSoldOut ? "Hide sold out" : `Show sold out (${soldOutCount})`}
          </button>
        )}
      </div>
      {beerNames.length === 0 ? (
        everPackaged.length > 0 ? (
          <EmptyState icon={Package} title="Nothing in stock" subtitle="Everything packaged has been sold or cleared. New packaging runs show up here automatically." />
        ) : (
          <EmptyState icon={Package} title="Nothing packaged yet" subtitle="Once a batch is packaged, what's available to sell will show up here automatically." />
        )
      ) : (
        beerNames.map((name) => (
          <div key={name} style={{ marginBottom: 20 }}>
            <div style={{ fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 14.5, color: "#2A3324", marginBottom: 8 }}>{name}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {grouped[name].map((s) => (
                <div
                  key={s.containerKey}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "10px 14px",
                    background: "#FFFFFF",
                    border: `1px solid ${s.available <= 0 ? "#E3D3A0" : "#DDE0C8"}`,
                    borderRadius: 6,
                  }}
                >
                  <span style={{ color: "#2A3324", fontSize: 13.5 }}>{s.containerKey === "cans330" ? "330ml Cans (cases of 24)" : s.containerLabel}</span>
                  <span
                    style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: 13,
                      color: s.available <= 0 ? "#B5502F" : "#5C9A3C",
                      textAlign: "right",
                    }}
                  >
                    {s.containerKey === "cans330" ? `${canCasesText(s.available)} available` : `${s.available} available`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
