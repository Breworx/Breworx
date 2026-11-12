import { useState, useMemo } from "react";
import { Plus, ChevronLeft, AlertTriangle, Trash2, Users, Pencil } from "lucide-react";
import { canCasesText } from "./finishedStock";
import { ConfirmDialogModal, EmptyState, Modal, NumberField, SelectField, TextField } from "./ui";
import { formatHistoryStamp } from "../lib/brewing";
import { CATEGORIES, CATEGORY_COLOR, STEP_FOR_UNIT } from "../lib/config";
import { formatQty, normItemName, sameItemName, supplierPerformance, uid, unitFactor } from "../lib/production";
import { today } from "../lib/utils";

export function SuppliersModal({ suppliers, purchaseOrders, onClose, onAddNew, onEdit, onDelete, isOwner }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const filtered = suppliers.filter(
    (s) => !q || s.name.toLowerCase().includes(q) || (s.contactName || "").toLowerCase().includes(q) || (s.email || "").toLowerCase().includes(q)
  );
  return (
    <Modal title="Suppliers" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <button
          onClick={onAddNew}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 7,
            background: "none",
            border: "1px dashed #C9D1AC",
            borderRadius: 5,
            padding: "10px",
            color: "#5C6B54",
            fontFamily: "'Inter', sans-serif",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          <Plus size={14} /> Add supplier
        </button>
        {suppliers.length > 3 && (
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search suppliers…"
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
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {filtered.length === 0 && q && (
            <div style={{ color: "#9BA88A", fontSize: 13, padding: "12px 4px" }}>No suppliers match "{query}".</div>
          )}
          {filtered.map((s) => (
            <div
              key={s.id}
              style={{
                padding: "10px 12px",
                background: "#F8F5EA",
                border: "1px solid #EBE8D6",
                borderRadius: 5,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: "#2A3324", fontSize: 14, fontFamily: "'Oswald', sans-serif", fontWeight: 500 }}>{s.name}</div>
                  {(s.contactName || s.phone || s.email) && (
                    <div style={{ color: "#5C6B54", fontSize: 12, marginTop: 2 }}>
                      {[s.contactName, s.phone, s.email].filter(Boolean).join(" · ")}
                    </div>
                  )}
                  {(() => {
                    const perf = purchaseOrders ? supplierPerformance(s.name, purchaseOrders) : null;
                    if (!perf) return null;
                    return (
                      <div style={{ color: "#9BA88A", fontSize: 11.5, marginTop: 4 }}>
                        {perf.avgLeadTimeDays != null && (
                          <>
                            {perf.avgLeadTimeDays}d actual lead time
                            {s.leadTimeDays ? ` (stated ${s.leadTimeDays}d)` : ""}
                            {" · "}
                          </>
                        )}
                        {perf.poCount} order{perf.poCount !== 1 ? "s" : ""} received
                        {isOwner ? ` · $${perf.totalSpend.toFixed(2)} total` : ""}
                      </div>
                    );
                  })()}
                </div>
                <div style={{ display: "flex", gap: 10, flexShrink: 0 }}>
                  <button onClick={() => onEdit(s)} style={{ background: "none", border: "none", color: "#5C9A3C", cursor: "pointer", fontSize: 12.5, padding: 0 }}>
                    Edit
                  </button>
                  {onDelete && (
                    <button onClick={() => onDelete(s)} style={{ background: "none", border: "none", color: "#B5502F", cursor: "pointer", fontSize: 12.5, padding: 0 }}>
                      Delete
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
          {suppliers.length === 0 && (
            <EmptyState icon={Users} title="No suppliers added yet" subtitle="Add one to track contact details, and to attach documents like food safety certificates." />
          )}
        </div>
      </div>
    </Modal>
  );
}

export function StockTakeModal({ inventory, onClose, onComplete, itemLabel = "ingredient" }) {
  const [counts, setCounts] = useState(() => {
    const init = {};
    inventory.forEach((it) => (init[it.id] = String(it.qty)));
    return init;
  });

  const updateCount = (id, val) => setCounts((prev) => ({ ...prev, [id]: val }));
  // Grouped by category (Grain, Hops, Yeast, Juice, Other, then any others),
  // A–Z within each, so you can count one area of the brewery at a time.
  const [closed, setClosed] = useState({});
  const groups = useMemo(() => {
    const by = {};
    inventory.forEach((it) => (by[it.category || "Other"] = by[it.category || "Other"] || []).push(it));
    const order = (c) => { const i = CATEGORIES.indexOf(c); return i === -1 ? 100 : i; };
    return Object.keys(by)
      .sort((a, b) => order(a) - order(b) || a.localeCompare(b))
      .map((c) => ({ category: c, items: by[c].sort((a, b) => a.name.localeCompare(b.name)) }));
  }, [inventory]);
  const changedIn = (items) => items.filter((it) => counts[it.id] !== "" && Math.round((Number(counts[it.id]) - it.qty) * 100) / 100 !== 0).length;

  const discrepancyCount = inventory.filter((it) => {
    const counted = counts[it.id];
    return counted !== "" && Math.round((Number(counted) - it.qty) * 100) / 100 !== 0;
  }).length;

  const submit = () => {
    const lines = inventory.map((it) => {
      const counted = counts[it.id] === "" ? it.qty : Number(counts[it.id]);
      return {
        itemId: it.id,
        itemName: it.name,
        unit: it.unit,
        systemQty: it.qty,
        countedQty: counted,
        discrepancy: Math.round((counted - it.qty) * 100) / 100,
      };
    });
    onComplete(lines);
    onClose();
  };

  return (
    <Modal title="Stock take" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ color: "#5C6B54", fontSize: 13, lineHeight: 1.5 }}>
          Walk the brewery and enter what you actually count for each {itemLabel}. Anything left unchanged is
          assumed correct as-is.
        </div>
        {groups.length > 1 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {groups.map((g) => (
              <button key={g.category} type="button" onClick={() => document.getElementById(`stocktake-${g.category}`)?.scrollIntoView({ behavior: "smooth", block: "start" })} style={{ background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 999, padding: "5px 11px", fontSize: 12, color: "#2A3324", cursor: "pointer" }}>
                {g.category} ({g.items.length})
              </button>
            ))}
          </div>
        )}
        {groups.map((g) => (
        <div key={g.category} id={`stocktake-${g.category}`} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <button type="button" onClick={() => setClosed((p) => ({ ...p, [g.category]: !p[g.category] }))} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "none", border: "none", borderBottom: `2px solid ${CATEGORY_COLOR[g.category] || "#C9D1AC"}`, padding: "6px 2px", cursor: "pointer", textAlign: "left" }}>
            <span style={{ fontFamily: "'Oswald', sans-serif", fontSize: 15, color: "#2A3324" }}>
              {closed[g.category] ? "▸" : "▾"} {g.category} <span style={{ fontFamily: "'Inter', sans-serif", fontSize: 12, color: "#9BA88A" }}>{g.items.length} item{g.items.length === 1 ? "" : "s"}</span>
            </span>
            {changedIn(g.items) > 0 && <span style={{ fontSize: 11.5, color: "#8A6D0B" }}>{changedIn(g.items)} changed</span>}
          </button>
          {!closed[g.category] && g.items.map((it) => {
            const counted = counts[it.id];
            const diff = counted === "" ? 0 : Math.round((Number(counted) - it.qty) * 100) / 100;
            return (
              <div key={it.id} style={{ background: "#F5F1E4", border: `1px solid ${diff !== 0 ? "#E3D3A0" : "#DDE0C8"}`, borderRadius: 6, padding: "10px 12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ color: "#2A3324", fontSize: 13.5 }}>{it.name}</span>
                  <span style={{ color: "#9BA88A", fontFamily: "'JetBrains Mono', monospace", fontSize: 11.5 }}>
                    system: {it.casePack ? canCasesText(it.qty) : formatQty(it.qty, it.unit)}
                  </span>
                </div>
                {it.casePack ? (() => {
                  // Count cans as full cases plus any loose cans.
                  const total = counted === "" ? Number(it.qty) || 0 : Number(counted) || 0;
                  const cases = Math.floor(Math.max(0, total) / it.casePack);
                  const loose = Math.max(0, total) - cases * it.casePack;
                  const box = { width: 70, boxSizing: "border-box", background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 4, padding: "8px 9px", color: "#2A3324", fontFamily: "'JetBrains Mono', monospace", fontSize: 13 };
                  return (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <input type="number" inputMode="numeric" min="0" step="1" value={cases} onChange={(e) => updateCount(it.id, String((Math.max(0, parseInt(e.target.value || "0", 10)) || 0) * it.casePack + loose))} style={box} />
                      <span style={{ color: "#5C6B54", fontSize: 12 }}>cases +</span>
                      <input type="number" inputMode="numeric" min="0" step="1" value={loose} onChange={(e) => updateCount(it.id, String(cases * it.casePack + (Math.max(0, parseInt(e.target.value || "0", 10)) || 0)))} style={{ ...box, width: 60 }} />
                      <span style={{ color: "#5C6B54", fontSize: 12 }}>cans</span>
                      {diff !== 0 && (
                        <span style={{ color: diff > 0 ? "#D9A441" : "#5C9A3C", fontFamily: "'JetBrains Mono', monospace", fontSize: 12, marginLeft: "auto" }}>
                          {diff > 0 ? "+" : "-"}{canCasesText(Math.abs(diff))}
                        </span>
                      )}
                    </div>
                  );
                })() : (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="number"
                    step="0.01"
                    value={counted}
                    onChange={(e) => updateCount(it.id, e.target.value)}
                    style={{
                      flex: 1,
                      boxSizing: "border-box",
                      background: "#FFFFFF",
                      border: "1px solid #DDE0C8",
                      borderRadius: 4,
                      padding: "8px 9px",
                      color: "#2A3324",
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: 13,
                    }}
                  />
                  <span style={{ color: "#5C6B54", fontSize: 12, width: 30, flexShrink: 0 }}>{it.unit}</span>
                  {diff !== 0 && (
                    <span style={{ color: diff > 0 ? "#D9A441" : "#5C9A3C", fontFamily: "'JetBrains Mono', monospace", fontSize: 12, flexShrink: 0 }}>
                      {diff > 0 ? "+" : ""}
                      {diff}
                    </span>
                  )}
                </div>
                )}
              </div>
            );
          })}
        </div>
        ))}
        {inventory.length === 0 && <div style={{ color: "#9BA88A", fontSize: 13 }}>No {itemLabel}s to count yet.</div>}
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
          Complete stock take{discrepancyCount > 0 ? ` (${discrepancyCount} discrepanc${discrepancyCount !== 1 ? "ies" : "y"})` : ""}
        </button>
      </div>
    </Modal>
  );
}

export function StockTakeHistoryModal({ stockTakes, onClose, onOpenReport }) {
  return (
    <Modal title="Stock take reports" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {stockTakes.map((st) => {
          const discrepancies = st.lines.filter((l) => l.discrepancy !== 0).length;
          return (
            <button
              key={st.id}
              onClick={() => onOpenReport(st)}
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
                <div style={{ color: "#2A3324", fontSize: 14, fontFamily: "'Oswald', sans-serif", fontWeight: 500 }}>{st.date}</div>
                <div style={{ color: "#5C6B54", fontSize: 12, marginTop: 2 }}>
                  {st.userName || "Unknown"} · {st.lines.length} item{st.lines.length !== 1 ? "s" : ""} checked
                </div>
              </div>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: discrepancies > 0 ? "#5C9A3C" : "#D9A441" }}>
                {discrepancies > 0 ? `${discrepancies} off` : "all matched"}
              </span>
            </button>
          );
        })}
        {stockTakes.length === 0 && (
          <div style={{ color: "#9BA88A", fontSize: 13.5, padding: "20px 4px" }}>
            No stock takes recorded yet.
          </div>
        )}
      </div>
    </Modal>
  );
}

export function StockTakeReportModal({ stockTake, onClose }) {
  return (
    <Modal title={`Stock take — ${stockTake.date}`} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ color: "#5C6B54", fontSize: 12.5 }}>Done by {stockTake.userName || "Unknown"}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {stockTake.lines.map((l) => (
            <div
              key={l.itemId}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "9px 12px",
                background: "#F8F5EA",
                border: `1px solid ${l.discrepancy !== 0 ? "#E3D3A0" : "#EBE8D6"}`,
                borderRadius: 5,
                fontSize: 13,
              }}
            >
              <span style={{ color: "#2A3324" }}>{l.itemName}</span>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#5C6B54", fontSize: 12 }}>
                {formatQty(l.systemQty, l.unit)} → {formatQty(l.countedQty, l.unit)}
              </span>
              <span
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 12,
                  color: l.discrepancy === 0 ? "#9BA88A" : l.discrepancy > 0 ? "#D9A441" : "#5C9A3C",
                  width: 50,
                  textAlign: "right",
                  flexShrink: 0,
                }}
              >
                {l.discrepancy === 0 ? "match" : `${l.discrepancy > 0 ? "+" : ""}${l.discrepancy}`}
              </span>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

export function AdjustInventoryModal({ item, onClose, onSave }) {
  const [amount, setAmount] = useState("");
  const [batchRef, setBatchRef] = useState("");

  const submit = () => {
    const a = Number(amount);
    if (!a || a <= 0) return;
    onSave(item.id, -a, batchRef.trim());
    onClose();
  };

  return (
    <Modal title={`Log adjustment — ${item.name}`} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <NumberField label={`Amount to remove (${item.unit})`} value={amount} onChange={setAmount} step="0.01" />
        <TextField label="Batch ID (optional)" value={batchRef} onChange={setBatchRef} />
        <div style={{ color: "#9BA88A", fontSize: 12 }}>
          For stock used, wasted, or lost outside a normal batch. Add a batch number here if it relates to one specifically. To increase stock, use "Add a lot" instead — that keeps it properly costed and traceable.
        </div>
        <button
          onClick={submit}
          style={{
            marginTop: 4,
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
          Log adjustment
        </button>
      </div>
    </Modal>
  );
}

export function AddLotModal({ itemName, onClose, onSave }) {
  const [lotNumber, setLotNumber] = useState("");
  const [qty, setQty] = useState("");
  const [date, setDate] = useState(today());
  const [unitCost, setUnitCost] = useState("");

  const submit = () => {
    if (!lotNumber.trim() || !qty || Number(qty) <= 0) return;
    onSave({ lotNumber: lotNumber.trim(), qty: Number(qty), date, unitCost: unitCost === "" ? null : Number(unitCost) });
    onClose();
  };

  return (
    <Modal title={`Add a lot — ${itemName}`} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <TextField label="Lot number" value={lotNumber} onChange={setLotNumber} placeholder="e.g. MO-2291" />
        <NumberField label="Quantity received" value={qty} onChange={setQty} step="0.1" />
        <TextField label="Date received" type="date" value={date} onChange={setDate} />
        <NumberField label="Unit cost (optional)" value={unitCost} onChange={setUnitCost} step="0.01" />
        <button
          onClick={submit}
          style={{ background: "#5C9A3C", border: "none", borderRadius: 5, padding: "12px", color: "#16191A", fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 15, letterSpacing: "0.03em", cursor: "pointer" }}
        >
          Add lot
        </button>
      </div>
    </Modal>
  );
}

// For ingredients that existed before this app did — search for an
// existing item to add opening stock to it, or type a new name to create
// it. Each line becomes a genuine, dated, costed lot, so opening stock
// behaves exactly like anything received going forward, not a special
// case that skips traceability.
export function BulkOpeningStockModal({ inventory, onClose, onSave, categories = CATEGORIES, unitOptions = ["kg", "g", "L", "mL", "ea"], title = "Bring in opening stock" }) {
  const [lines, setLines] = useState([{ id: uid(), name: "", category: categories[0], unit: unitOptions[0], qty: "", unitCost: "", lotNumber: "" }]);
  const [focusedLineId, setFocusedLineId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const hasEnteredWork = lines.some((l) => l.name.trim() || l.qty !== "" || l.unitCost !== "");
  const requestClose = () => {
    if (hasEnteredWork) { setConfirmDiscard(true); return; }
    onClose();
  };

  const addLine = () => setLines((prev) => [...prev, { id: uid(), name: "", category: categories[0], unit: unitOptions[0], qty: "", unitCost: "", lotNumber: "" }]);
  const updateLine = (id, patch) => setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const removeLine = (id) => setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.id !== id) : prev));

  const submit = async () => {
    const cleanLines = lines.filter((l) => l.name.trim() && Number(l.qty) > 0);
    if (cleanLines.length === 0) return;
    setSaving(true);
    await onSave(
      cleanLines.map((l) => ({
        name: l.name.trim(),
        category: l.category,
        unit: l.unit,
        qty: Number(l.qty),
        unitCost: l.unitCost === "" ? null : Number(l.unitCost),
        lotNumber: l.lotNumber.trim() || "Opening stock",
      }))
    );
    setSaving(false);
    onClose();
  };

  return (
    <>
    <Modal title={title} onClose={requestClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ color: "#5C6B54", fontSize: 13 }}>
          For ingredients you already had before starting to track them here. Search for an existing item, or type a new name and it'll be created. Each line becomes its own dated, costed lot.
        </div>
        {lines.map((line, i) => {
          const matches = line.name.trim()
            ? inventory.filter((it) => it.name.toLowerCase().includes(line.name.trim().toLowerCase())).slice(0, 6)
            : [];
          return (
            <div key={line.id} style={{ background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 6, padding: "12px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ color: "#9BA88A", fontSize: 11 }}>Item {i + 1}</span>
                {lines.length > 1 && (
                  <button onClick={() => removeLine(line.id)} aria-label="Remove" style={{ background: "none", border: "none", color: "#9BA88A", cursor: "pointer", padding: 2 }}>
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
              <div style={{ position: "relative", marginBottom: 8 }}>
                <input
                  type="text"
                  value={line.name}
                  onChange={(e) => updateLine(line.id, { name: e.target.value })}
                  onFocus={() => setFocusedLineId(line.id)}
                  onBlur={() => setTimeout(() => setFocusedLineId(null), 150)}
                  placeholder="Search existing items, or type a new name"
                  style={{ width: "100%", boxSizing: "border-box", background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 4, padding: "9px 10px", color: "#2A3324", fontFamily: "'Inter', sans-serif", fontSize: 14 }}
                />
                {focusedLineId === line.id && matches.length > 0 && (
                  <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 10, background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 4, marginTop: 2, maxHeight: 160, overflowY: "auto" }}>
                    {matches.map((it) => (
                      <button
                        key={it.id}
                        onMouseDown={() => updateLine(line.id, { name: it.name, category: it.category, unit: it.unit })}
                        style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", borderBottom: "1px solid #EBE8D6", padding: "8px 10px", color: "#2A3324", fontSize: 13, cursor: "pointer" }}
                      >
                        {it.name} <span style={{ color: "#9BA88A", fontSize: 11 }}>· already have {it.qty} {it.unit}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                <SelectField label="Category" value={line.category} onChange={(v) => updateLine(line.id, { category: v, ...(v === "Juice" ? { unit: "L" } : {}) })} options={categories} />
                <SelectField label="Unit" value={line.unit} onChange={(v) => updateLine(line.id, { unit: v })} options={unitOptions} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <NumberField label="Quantity you have" value={line.qty} onChange={(v) => updateLine(line.id, { qty: v })} step="0.1" suffix={line.unit} />
                <NumberField label="Cost per unit (optional)" value={line.unitCost} onChange={(v) => updateLine(line.id, { unitCost: v })} step="0.01" />
              </div>
              <div style={{ marginTop: 8 }}>
                <TextField label="Lot / reference (optional — defaults to 'Opening stock')" value={line.lotNumber} onChange={(v) => updateLine(line.id, { lotNumber: v })} />
              </div>
            </div>
          );
        })}
        <button
          onClick={addLine}
          style={{ background: "none", border: "1px dashed #C9D1AC", borderRadius: 5, padding: "10px", color: "#5C6B54", fontFamily: "'Inter', sans-serif", fontSize: 13, cursor: "pointer" }}
        >
          + Add another item
        </button>
        <button
          onClick={submit}
          disabled={saving}
          style={{
            background: saving ? "#E8E4D4" : "#5C9A3C",
            border: "none",
            borderRadius: 5,
            padding: "12px",
            color: saving ? "#A3AC94" : "#16191A",
            fontFamily: "'Oswald', sans-serif",
            fontWeight: 500,
            fontSize: 15,
            letterSpacing: "0.03em",
            cursor: saving ? "default" : "pointer",
          }}
        >
          {saving ? "Saving…" : "Bring in stock"}
        </button>
      </div>
    </Modal>
    {confirmDiscard && (
      <ConfirmDialogModal
        message="Discard this opening stock entry? Nothing you've typed will be saved."
        confirmLabel="Discard"
        destructive
        onCancel={() => setConfirmDiscard(false)}
        onConfirm={() => { setConfirmDiscard(false); onClose(); }}
      />
    )}
    </>
  );
}

// For fixing a name or category typed wrong at creation — e.g. an item
// that was mistakenly filed as Grain when it's actually Yeast. Doesn't
// touch quantity or cost, those have their own dedicated paths.
export function EditInventoryItemModal({ item, categories, onClose, onSave, canChangeUnit = false, unitOptions = ["kg", "g", "L", "mL", "ea", "pkg"] }) {
  const [name, setName] = useState(item.name);
  const [category, setCategory] = useState(item.category);
  const [unit, setUnit] = useState(item.unit);
  const [sgMode, setSgMode] = useState("sg");
  const [gravity, setGravity] = useState(item.juiceSg != null ? String(item.juiceSg) : "");
  const [saving, setSaving] = useState(false);
  const units = unitOptions.includes(item.unit) ? unitOptions : [item.unit, ...unitOptions];
  const gravityAsSg = () => {
    const v = Number(gravity);
    if (gravity === "" || !Number.isFinite(v) || v <= 0) return null;
    return sgMode === "brix" ? Math.round((1 + v / (258.6 - (v / 258.2) * 227.1)) * 1000) / 1000 : v;
  };
  const factor = unit !== item.unit ? unitFactor(item.unit, unit) : 1;

  const submit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    await onSave({ name: name.trim(), category, ...(unit !== item.unit ? { unit, unitFactor: factor } : {}), ...(canChangeUnit && category === "Juice" ? { juiceSg: gravityAsSg() } : {}) });
    setSaving(false);
    onClose();
  };

  return (
    <Modal title="Edit item" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <TextField label="Name" value={name} onChange={setName} />
        <SelectField label="Category" value={category} onChange={(c) => { setCategory(c); if (c === "Juice" && item.unit === "kg") setUnit("L"); }} options={categories} />
        {canChangeUnit && item.unit != null && <SelectField label="Unit" value={unit} onChange={setUnit} options={units} />}
        {canChangeUnit && category === "Juice" && (
          <div>
            <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B54", marginBottom: 5 }}>Juice gravity</div>
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ display: "flex", border: "1px solid #DDE0C8", borderRadius: 4, overflow: "hidden" }}>
                {[["sg", "SG"], ["brix", "Brix"]].map(([m, l]) => (
                  <button key={m} type="button" onClick={() => setSgMode(m)} style={{ background: sgMode === m ? "#5C9A3C" : "#F5F1E4", border: "none", padding: "8px 12px", fontSize: 12.5, color: sgMode === m ? "#16191A" : "#5C6B54", cursor: "pointer" }}>{l}</button>
                ))}
              </div>
              <input type="number" inputMode="decimal" step={sgMode === "sg" ? "0.001" : "0.1"} value={gravity} onChange={(e) => setGravity(e.target.value)} placeholder={sgMode === "sg" ? "e.g. 1.048" : "e.g. 12"} style={{ flex: 1, minWidth: 0, background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 4, padding: "9px 10px", fontFamily: "'JetBrains Mono', monospace", fontSize: 14, color: "#2A3324" }} />
            </div>
            <div style={{ fontSize: 12, color: "#5C6B54", marginTop: 5 }}>Used by the cider plan to work out how much of this juice to use.{sgMode === "brix" && gravityAsSg() ? ` = SG ${gravityAsSg().toFixed(3)}` : ""}</div>
          </div>
        )}
        {unit !== item.unit && (
          <div style={{ fontSize: 12.5, color: "#5C6B54", lineHeight: 1.5 }}>
            {factor != null
              ? `Stock, lots and costs are converted: ${item.qty} ${item.unit} becomes ${Math.round(item.qty * factor * 1000) / 1000} ${unit}.`
              : `${item.unit} and ${unit} can't be converted, so the numbers stay the same: ${item.qty} ${item.unit} becomes ${item.qty} ${unit}. Recipes and batches that use it in ${item.unit} won't change.`}
          </div>
        )}
        <button
          onClick={submit}
          disabled={saving}
          style={{
            background: saving ? "#E8E4D4" : "#5C9A3C",
            border: "none",
            borderRadius: 5,
            padding: "12px",
            color: saving ? "#A3AC94" : "#16191A",
            fontFamily: "'Oswald', sans-serif",
            fontWeight: 500,
            fontSize: 15,
            letterSpacing: "0.03em",
            cursor: saving ? "default" : "pointer",
          }}
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>
    </Modal>
  );
}

export function RenameModal({ title, currentName, onClose, onSave }) {
  const [name, setName] = useState(currentName);

  const submit = () => {
    if (!name.trim() || name.trim() === currentName) {
      onClose();
      return;
    }
    onSave(name.trim());
    onClose();
  };

  return (
    <Modal title={title} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <TextField label="Name" value={name} onChange={setName} />
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

// Words in a name, for spotting likely duplicates ("Gladfield Pilsner Malt" / "Pilsner Malt").
export const NAME_FILLER = ["malt", "the", "bag", "and", "yeast", "hops", "pellets", "pellet"];
export const nameWords = (n) => new Set(normItemName(n).replace(/[^a-z0-9 ]/g, " ").split(" ").filter((w) => w.length > 2 && !/\d/.test(w) && !NAME_FILLER.includes(w)));
export function nameSimilarity(a, b) {
  const A = nameWords(a);
  const B = nameWords(b);
  if (!A.size || !B.size) return 0;
  let common = 0;
  A.forEach((w) => B.has(w) && common++);
  return common / Math.min(A.size, B.size);
}

export function MergeInventoryModal({ item, candidates, onClose, onMerge, initialTargetId = "" }) {
  const [query, setQuery] = useState("");
  const [targetId, setTargetId] = useState(initialTargetId);
  const [keep, setKeep] = useState("other"); // which name survives: "other" keeps the chosen item, "this" keeps this one
  const [busy, setBusy] = useState(false);
  const scored = candidates
    .map((c) => ({ c, score: nameSimilarity(item.name, c.name) + (c.category === item.category ? 0.2 : 0) }))
    .filter(({ c }) => !query.trim() || normItemName(c.name).includes(normItemName(query)))
    .sort((a, b) => b.score - a.score || a.c.name.localeCompare(b.c.name));
  const shown = query.trim() ? scored : scored.slice(0, 12);
  const target = candidates.find((c) => c.id === targetId) || null;
  const source = target ? (keep === "other" ? item : target) : null;
  const kept = target ? (keep === "other" ? target : item) : null;
  const factor = target ? unitFactor(source.unit, kept.unit) : 1;
  const row = (selected) => ({ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, width: "100%", textAlign: "left", background: selected ? "#EBF3E4" : "#FFFFFF", border: `1px solid ${selected ? "#9BC48A" : "#DDE0C8"}`, borderRadius: 5, padding: "9px 11px", cursor: "pointer", fontFamily: "'Inter', sans-serif", fontSize: 13, color: "#2A3324" });
  return (
    <Modal title={`Merge ${item.name}`} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ fontSize: 12.5, color: "#5C6B54", lineHeight: 1.5 }}>
          Pick the item this is a duplicate of. Stock, lots and history are combined into one item, recipes, batches and purchase orders are switched to the kept name, and the other item is removed.
        </div>
        <TextField label="Search" value={query} onChange={setQuery} />
        <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 260, overflowY: "auto" }}>
          {shown.map(({ c, score }) => (
            <button key={c.id} type="button" onClick={() => setTargetId(c.id)} style={row(c.id === targetId)}>
              <span>
                {c.name}
                <span style={{ display: "block", fontSize: 11, color: "#9BA88A" }}>{c.category}{score >= 0.7 ? " · looks like a match" : ""}</span>
              </span>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: "#5C6B54", whiteSpace: "nowrap" }}>{c.qty}{c.unit}</span>
            </button>
          ))}
          {shown.length === 0 && <div style={{ fontSize: 12.5, color: "#9BA88A" }}>No items match.</div>}
        </div>
        {target && (
          <>
            <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A" }}>Name to keep</div>
            <div style={{ display: "flex", gap: 6 }}>
              {[["other", target.name], ["this", item.name]].map(([k, label]) => (
                <button key={k} type="button" onClick={() => setKeep(k)} style={{ ...row(keep === k), justifyContent: "center", flex: 1 }}>{label}</button>
              ))}
            </div>
            {factor == null ? (
              <div style={{ fontSize: 12.5, color: "#B5502F", lineHeight: 1.5 }}>
                These can't be merged: {source.name} is counted in {source.unit} and {kept.name} in {kept.unit}. Change one item's unit first.
              </div>
            ) : (
              <div style={{ fontSize: 12.5, color: "#2A3324", lineHeight: 1.5, background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 6, padding: "10px 12px" }}>
                {source.name} ({source.qty}{source.unit}) goes into <strong>{kept.name}</strong>, which ends up with{" "}
                <strong>{Math.round((Number(kept.qty) + Number(source.qty || 0) * factor) * 1000) / 1000}{kept.unit}</strong>. {source.name} is then removed. This can't be undone.
              </div>
            )}
          </>
        )}
        <button
          disabled={!target || factor == null || busy}
          onClick={async () => {
            setBusy(true);
            const ok = await onMerge(source, kept);
            setBusy(false);
            if (ok) onClose();
          }}
          style={{ background: !target || factor == null ? "#DDE0C8" : "#5C9A3C", border: "none", borderRadius: 5, padding: "12px", color: "#16191A", fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 14, cursor: !target || factor == null ? "default" : "pointer" }}
        >
          {busy ? "Merging…" : target ? `Merge into ${kept.name}` : "Pick an item to merge with"}
        </button>
      </div>
    </Modal>
  );
}

// Pairs of inventory items whose names look like the same thing, for the
// "Possible duplicates" box at the top of Inventory.
export function findLikelyDuplicates(inventory, dismissed) {
  const pairs = [];
  for (let i = 0; i < inventory.length; i++) {
    for (let j = i + 1; j < inventory.length; j++) {
      const a = inventory[i];
      const b = inventory[j];
      const key = [a.id, b.id].sort().join("|");
      if (dismissed.has(key)) continue;
      const score = sameItemName(a.name, b.name) ? 2 : nameSimilarity(a.name, b.name);
      if (score >= 0.75) pairs.push({ a, b, key, score });
    }
  }
  return pairs.sort((x, y) => y.score - x.score || x.a.name.localeCompare(y.a.name));
}

export function InventoryDuplicatesPanel({ inventory, onMerge, onOpen }) {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem("brewpoint-not-duplicates") || "[]"));
    } catch {
      return new Set();
    }
  });
  const [showAll, setShowAll] = useState(false);
  const [merging, setMerging] = useState(null);
  const pairs = useMemo(() => findLikelyDuplicates(inventory, dismissed), [inventory, dismissed]);
  if (pairs.length === 0) return null;
  const dismiss = (key) => {
    const next = new Set(dismissed);
    next.add(key);
    setDismissed(next);
    try {
      localStorage.setItem("brewpoint-not-duplicates", JSON.stringify([...next]));
    } catch {}
  };
  const shown = showAll ? pairs : pairs.slice(0, 4);
  const small = { background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 4, padding: "6px 10px", fontSize: 12, color: "#2A3324", cursor: "pointer", fontFamily: "'Inter', sans-serif" };
  return (
    <div style={{ background: "#FBF3DF", border: "1px solid #E8D49A", borderRadius: 6, padding: "11px 12px", marginBottom: 12 }}>
      <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#8A6D0B", marginBottom: 8 }}>
        Possible duplicates ({pairs.length})
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {shown.map(({ a, b, key }) => {
          const canMerge = unitFactor(a.unit, b.unit) != null;
          return (
            <div key={key} style={{ background: "#FFFDF6", border: "1px solid #EFE3BC", borderRadius: 5, padding: "8px 10px" }}>
              <div style={{ fontSize: 13, color: "#2A3324", lineHeight: 1.45, marginBottom: 6 }}>
                <button type="button" onClick={() => onOpen(a.id)} style={{ background: "none", border: "none", padding: 0, color: "#2A3324", textDecoration: "underline", cursor: "pointer", fontSize: 13 }}>{a.name}</button>
                <span style={{ color: "#9BA88A", fontFamily: "'JetBrains Mono', monospace", fontSize: 11.5 }}> {a.qty}{a.unit}</span>
                <span style={{ color: "#9BA88A" }}> and </span>
                <button type="button" onClick={() => onOpen(b.id)} style={{ background: "none", border: "none", padding: 0, color: "#2A3324", textDecoration: "underline", cursor: "pointer", fontSize: 13 }}>{b.name}</button>
                <span style={{ color: "#9BA88A", fontFamily: "'JetBrains Mono', monospace", fontSize: 11.5 }}> {b.qty}{b.unit}</span>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                {canMerge ? (
                  <button type="button" onClick={() => setMerging({ a, b })} style={{ ...small, background: "#5C9A3C", border: "1px solid #5C9A3C", color: "#16191A" }}>Merge…</button>
                ) : (
                  <span style={{ fontSize: 11.5, color: "#B5502F" }}>Different units ({a.unit} / {b.unit}) — change one first</span>
                )}
                <button type="button" onClick={() => dismiss(key)} style={small}>Not the same</button>
              </div>
            </div>
          );
        })}
      </div>
      {pairs.length > 4 && (
        <button type="button" onClick={() => setShowAll((v) => !v)} style={{ background: "none", border: "none", color: "#5C9A3C", cursor: "pointer", fontSize: 12, padding: 0, marginTop: 8 }}>
          {showAll ? "Show fewer" : `Show all ${pairs.length}`}
        </button>
      )}
      {merging && (
        <MergeInventoryModal
          item={merging.a}
          candidates={inventory.filter((it) => it.id !== merging.a.id)}
          initialTargetId={merging.b.id}
          onClose={() => setMerging(null)}
          onMerge={onMerge}
        />
      )}
    </div>
  );
}

export function InventoryItemDetail({ item, onBack, onAdjust, onLogAdjustment, suppliers, onChangeSupplier, backLabel = "All inventory", showCost = false, onChangeCost, onDelete, onRename, onAddLot, categories, onEditDetails, onDeleteHistoryEntry, mergeCandidates, onMerge, canChangeUnit = false }) {
  const [showMerge, setShowMerge] = useState(false);
  const low = item.qty <= item.threshold;
  const step = STEP_FOR_UNIT[item.unit] ?? 1;
    const history = [...(item.history || [])].reverse();
  const [costDraft, setCostDraft] = useState(item.costPerUnit ?? "");
  const [showRename, setShowRename] = useState(false);
  const [showAddLot, setShowAddLot] = useState(false);

  const typeLabel = { batch: "Used in batch", manual: "Manual adjustment", received: "Stock received", restored: "Restored (batch deleted)", stocktake: "Stock take correction" };
  const typeColor = { batch: "#5C9A3C", manual: "#5C6B54", received: "#D9A441", restored: "#D9A441", stocktake: "#D4A24C" };

  return (
    <div>
      <button
        onClick={onBack}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: "none",
          border: "none",
          color: "#5C6B54",
          cursor: "pointer",
          fontFamily: "'Inter', sans-serif",
          fontSize: 13,
          padding: 0,
          marginBottom: 18,
        }}
      >
        <ChevronLeft size={16} /> {backLabel}
      </button>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <h1 style={{ fontFamily: "'Oswald', sans-serif", fontSize: 24, color: "#2A3324", margin: 0, fontWeight: 500 }}>
          {item.name}
        </h1>
        {low && <AlertTriangle size={16} color="#5C9A3C" />}
        {(onRename || onEditDetails) && (
          <button
            onClick={() => setShowRename(true)}
            aria-label="Edit"
            style={{ background: "none", border: "none", color: "#9BA88A", cursor: "pointer", padding: 4 }}
          >
            <Pencil size={15} />
          </button>
        )}
      </div>
      {showRename && onEditDetails && (
        <EditInventoryItemModal
          item={item}
          canChangeUnit={canChangeUnit}
          categories={categories}
          onClose={() => setShowRename(false)}
          onSave={(patch) => onEditDetails(item.id, patch)}
        />
      )}
      {showRename && !onEditDetails && (
        <RenameModal
          title="Rename item"
          currentName={item.name}
          onClose={() => setShowRename(false)}
          onSave={(newName) => onRename(item.id, newName)}
        />
      )}
      <div
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 11,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: CATEGORY_COLOR[item.category],
          marginBottom: 20,
        }}
      >
        {item.category}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "16px", marginBottom: 22 }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 24, color: low ? "#5C9A3C" : "#2A3324" }}>
            {formatQty(item.qty, item.unit)}
          </div>
          <div style={{ color: "#9BA88A", fontSize: 11.5, marginTop: 2 }}>low-stock alert at {formatQty(item.threshold, item.unit)}</div>
        </div>
      </div>
      <div style={{ color: "#9BA88A", fontSize: 11.5, marginTop: -14, marginBottom: 22 }}>
        To change stock, use "Add a lot" for stock coming in, or "Log an adjustment" below for anything else — that keeps every change costed and traceable, rather than just bumping a number.
      </div>

      <button
        onClick={() => onLogAdjustment(item)}
        style={{
          width: "100%",
          background: "none",
          border: "1px solid #DDE0C8",
          borderRadius: 5,
          padding: "10px",
          color: "#5C6B54",
          fontFamily: "'Inter', sans-serif",
          fontSize: 13,
          cursor: "pointer",
          marginBottom: 22,
        }}
      >
        Log an adjustment
      </button>

      {showCost && (
        <label style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 22 }}>
          <span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A" }}>
            Cost per unit
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="number"
              step="0.01"
              value={costDraft}
              onChange={(e) => setCostDraft(e.target.value)}
              placeholder="0.00"
              style={{
                flex: 1,
                boxSizing: "border-box",
                background: "#FFFFFF",
                border: "1px solid #DDE0C8",
                borderRadius: 4,
                padding: "9px 10px",
                color: "#2A3324",
                fontFamily: "'Inter', sans-serif",
                fontSize: 14,
              }}
            />
            <button
              onClick={() => onChangeCost(item.id, costDraft === "" ? null : Number(costDraft))}
              style={{
                background: "#EBE8D6",
                border: "1px solid #C9D1AC",
                borderRadius: 4,
                padding: "0 14px",
                color: "#2A3324",
                fontFamily: "'Inter', sans-serif",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              Save
            </button>
          </div>
        </label>
      )}

      <label style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 22 }}>
        <span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A" }}>
          Supplier
        </span>
        <select
          value={item.supplierId || ""}
          onChange={(e) => onChangeSupplier(item.id, e.target.value || null)}
          style={{
            width: "100%",
            boxSizing: "border-box",
            background: "#FFFFFF",
            border: "1px solid #DDE0C8",
            borderRadius: 4,
            padding: "9px 10px",
            color: "#2A3324",
            fontFamily: "'Inter', sans-serif",
            fontSize: 14,
          }}
        >
          <option value="">No supplier</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A" }}>Lots</div>
        {onAddLot && (
          <button
            onClick={() => setShowAddLot(true)}
            style={{ background: "none", border: "none", color: "#5C9A3C", cursor: "pointer", fontSize: 12, fontFamily: "'Inter', sans-serif", padding: 0 }}
          >
            + Add a lot
          </button>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 22 }}>
        {(item.lots || []).length === 0 ? (
          <div style={{ color: "#9BA88A", fontSize: 13 }}>No lots on record — add one, or receive a Purchase Order with a lot number.</div>
        ) : (
          [...(item.lots || [])].reverse().map((l) => (
            <div key={l.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", background: "#F8F5EA", border: "1px solid #EBE8D6", borderRadius: 5, fontSize: 12.5 }}>
              <span style={{ color: "#2A3324" }}>{l.lotNumber}{l.poNumber ? ` — ${l.poNumber}` : " — manual entry"}</span>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#9BA88A" }}>
                {l.remainingQty ?? l.qty}/{l.qty} {item.unit} left · {formatHistoryStamp(l.date)}
              </span>
            </div>
          ))
        )}
      </div>
      {showAddLot && (
        <AddLotModal itemName={item.name} onClose={() => setShowAddLot(false)} onSave={(entry) => onAddLot(item.id, entry)} />
      )}

      <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>
        History
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {history.map((h) => (
          <div
            key={h.id}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 10,
              padding: "10px 12px",
              background: "#F8F5EA",
              border: "1px solid #EBE8D6",
              borderRadius: 5,
              fontSize: 13,
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ color: typeColor[h.type] || "#5C6B54", fontSize: 11.5, fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                {typeLabel[h.type] || "Change"}
              </div>
              <div style={{ color: "#5C6B54", fontSize: 12.5, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {h.note}
              </div>
            </div>
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", color: h.delta >= 0 ? "#D9A441" : "#5C9A3C", fontSize: 13.5 }}>
                {h.delta >= 0 ? "+" : ""}
                {h.delta} {item.unit}
              </div>
              <div style={{ color: "#9BA88A", fontSize: 10.5, marginTop: 2 }}>{formatHistoryStamp(h.date)}</div>
              {h.user && <div style={{ color: "#9BA88A", fontSize: 10.5, marginTop: 1 }}>{h.user}</div>}
              {h.type === "manual" && onDeleteHistoryEntry && (
                <button
                  onClick={() => onDeleteHistoryEntry(item.id, h)}
                  aria-label="Delete this adjustment"
                  style={{ background: "none", border: "none", color: "#B5502F", cursor: "pointer", fontSize: 10.5, padding: 0, marginTop: 3 }}
                >
                  Delete
                </button>
              )}
            </div>
          </div>
        ))}
        {history.length === 0 && (
          <div style={{ color: "#9BA88A", fontSize: 13.5, padding: "20px 4px" }}>
            No changes logged yet — adjustments, batch usage, and received stock will show up here.
          </div>
        )}
      </div>

      {onMerge && mergeCandidates && mergeCandidates.length > 0 && (
        <button
          onClick={() => setShowMerge(true)}
          style={{ width: "100%", background: "#FFFFFF", border: "1px solid #C9D1AC", borderRadius: 5, padding: "11px", color: "#2A3324", fontFamily: "'Inter', sans-serif", fontSize: 13, cursor: "pointer", marginTop: 26 }}
        >
          Merge with another item…
        </button>
      )}
      {showMerge && <MergeInventoryModal item={item} candidates={mergeCandidates} onClose={() => setShowMerge(false)} onMerge={onMerge} />}
      {onDelete && (
        <button
          onClick={() => onDelete(item)}
          style={{
            width: "100%",
            background: "none",
            border: "1px solid #E3D3A0",
            borderRadius: 5,
            padding: "11px",
            color: "#5C9A3C",
            fontFamily: "'Inter', sans-serif",
            fontSize: 13,
            cursor: "pointer",
            marginTop: 26,
          }}
        >
          Delete {item.name}
        </button>
      )}
    </div>
  );
}

export function AddInventoryModal({ onClose, onAdd, suppliers, categories = CATEGORIES, unitOptions = ["kg", "g", "L", "ea"], title = "New inventory item", submitLabel = "Add to inventory", showCost = false, storageKey = "brewpoint-last-category" }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState(() => {
    try {
      const last = localStorage.getItem(storageKey);
      return last && categories.includes(last) ? last : categories[0];
    } catch {
      return categories[0];
    }
  });
  const [qty, setQty] = useState(10);
  const [unit, setUnit] = useState(category === "Juice" && unitOptions.includes("L") ? "L" : unitOptions[0]);
  const [threshold, setThreshold] = useState(5);
  const [supplierId, setSupplierId] = useState("");
  const [costPerUnit, setCostPerUnit] = useState("");
  const [saving, setSaving] = useState(false);
  const pickCategory = (c) => {
    setCategory(c);
    if (c === "Juice" && unitOptions.includes("L")) setUnit("L");
  };

  const submit = async () => {
    if (!name.trim()) return;
    try {
      localStorage.setItem(storageKey, category);
    } catch {}
    setSaving(true);
    await onAdd({
      id: uid(),
      name: name.trim(),
      category,
      qty: Number(qty) || 0,
      unit,
      threshold: Number(threshold) || 0,
      supplierId: supplierId || null,
      ...(showCost ? { costPerUnit: costPerUnit === "" ? null : Number(costPerUnit) } : {}),
    });
    setSaving(false);
    onClose();
  };

  return (
    <Modal title={title} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <TextField label="Name" value={name} onChange={setName} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <SelectField label="Category" value={category} onChange={pickCategory} options={categories} />
          <SelectField label="Unit" value={unit} onChange={setUnit} options={unitOptions} />
          <NumberField label="Quantity on hand" value={qty} onChange={setQty} step="0.1" suffix={unit} />
          <NumberField label="Low-stock alert at" value={threshold} onChange={setThreshold} step="0.1" suffix={unit} />
          {showCost && <NumberField label="Cost per unit (optional)" value={costPerUnit} onChange={setCostPerUnit} step="0.01" />}
        </div>
        <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B54" }}>
            Supplier (optional)
          </span>
          <select
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            style={{
              width: "100%",
              boxSizing: "border-box",
              background: "#F5F1E4",
              border: "1px solid #DDE0C8",
              borderRadius: 4,
              padding: "9px 10px",
              color: "#2A3324",
              fontFamily: "'Inter', sans-serif",
              fontSize: 14,
            }}
          >
            <option value="">No supplier</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={submit}
          disabled={saving}
          style={{
            marginTop: 8,
            background: saving ? "#E8E4D4" : "#5C9A3C",
            border: "none",
            borderRadius: 5,
            padding: "12px",
            color: saving ? "#A3AC94" : "#16191A",
            fontFamily: "'Oswald', sans-serif",
            fontWeight: 500,
            fontSize: 15,
            letterSpacing: "0.03em",
            cursor: saving ? "default" : "pointer",
          }}
        >
          {saving ? "Saving…" : submitLabel}
        </button>
      </div>
    </Modal>
  );
}

export function PackageTypeCard({ packageType, onOpen }) {
  return (
    <button
      onClick={() => onOpen(packageType.id)}
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 12,
        background: "#FFFFFF",
        border: "1px solid #DDE0C8",
        borderRadius: 6,
        padding: "14px 16px",
        cursor: "pointer",
        textAlign: "left",
        width: "100%",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#C9D1AC")}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = "#DDE0C8")}
    >
      <div style={{ minWidth: 0 }}>
        <h3
          style={{
            fontFamily: "'Oswald', sans-serif",
            fontWeight: 500,
            fontSize: 16,
            color: "#2A3324",
            margin: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {packageType.name}
        </h3>
        <div style={{ color: "#5C6B54", fontSize: 12.5, marginTop: 3 }}>
          {packageType.items.length} consumable{packageType.items.length !== 1 ? "s" : ""} {(packageType.unitsPerPack || 1) > 1 ? `per pack of ${packageType.unitsPerPack}` : "per unit"}
        </div>
      </div>
    </button>
  );
}

export function AddPackageTypeModal({ onClose, onAdd, consumables }) {
  const [name, setName] = useState("");
  const [unitsPerPack, setUnitsPerPack] = useState(1);
  const [items, setItems] = useState([{ id: uid(), consumableId: consumables[0]?.id || "", qtyPerUnit: 1, matchLabelByRecipeName: false }]);
  const [saving, setSaving] = useState(false);

  const updateItem = (id, patch) =>
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));

  const addItemRow = () =>
    setItems((prev) => [...prev, { id: uid(), consumableId: consumables[0]?.id || "", qtyPerUnit: 1, matchLabelByRecipeName: false }]);

  const removeItemRow = (id) => setItems((prev) => (prev.length > 1 ? prev.filter((it) => it.id !== id) : prev));

  const submit = async () => {
    const cleanItems = items
      .filter((it) => it.matchLabelByRecipeName || it.consumableId)
      .map((it) => {
        // Quantities are entered per pack (e.g. per 24-can case); stock is
        // taken off per unit packaged, so store both.
        const per = Math.max(1, Number(unitsPerPack) || 1);
        const qtyPerPack = Number(it.qtyPerUnit) || 0;
        const qty = { qtyPerPack, qtyPerUnit: qtyPerPack / per };
        if (it.matchLabelByRecipeName) {
          return { consumableId: null, consumableName: null, matchLabelByRecipeName: true, ...qty };
        }
        const consumable = consumables.find((c) => c.id === it.consumableId);
        return { consumableId: it.consumableId, consumableName: consumable ? consumable.name : "", matchLabelByRecipeName: false, ...qty };
      });
    if (!name.trim() || cleanItems.length === 0) return;
    setSaving(true);
    await onAdd({ id: uid(), name: name.trim(), items: cleanItems, unitsPerPack: Math.max(1, Number(unitsPerPack) || 1) });
    setSaving(false);
    onClose();
  };

  return (
    <Modal title="New package type" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <TextField label="Name" value={name} onChange={setName} />
        <NumberField label="Units per pack (e.g. 24 cans in a case, 1 for a keg)" value={unitsPerPack} onChange={setUnitsPerPack} step="1" />

        <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B54", marginTop: 4 }}>
          {Number(unitsPerPack) > 1 ? `Consumables used per pack of ${unitsPerPack}` : "Consumables used per unit packaged"}
        </div>

        {consumables.length === 0 && (
          <div style={{ color: "#9BA88A", fontSize: 12.5 }}>
            You don't have any consumables yet — add some in the Consumables screen first (cans, lids, boxes, etc.), then come back here.
          </div>
        )}

        {consumables.length > 0 &&
          items.map((line, i) => (
            <div
              key={line.id}
              style={{
                background: "#F5F1E4",
                border: "1px solid #DDE0C8",
                borderRadius: 6,
                padding: "12px",
                position: "relative",
              }}
            >
              {items.length > 1 && (
                <button
                  onClick={() => removeItemRow(line.id)}
                  aria-label="Remove consumable"
                  style={{ position: "absolute", top: 8, right: 8, background: "none", border: "none", color: "#5C6B54", cursor: "pointer", padding: 8 }}
                >
                  <Trash2 size={14} />
                </button>
              )}
              <label style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={line.matchLabelByRecipeName}
                  onChange={(e) => updateItem(line.id, { matchLabelByRecipeName: e.target.checked, consumableId: e.target.checked ? null : consumables[0]?.id || "" })}
                />
                <span style={{ fontSize: 12.5, color: "#5C6B54", fontFamily: "'Inter', sans-serif" }}>
                  Auto-match label by beer name (skip picking a specific label)
                </span>
              </label>
              <div style={{ display: "grid", gridTemplateColumns: line.matchLabelByRecipeName ? "1fr" : "1fr 100px", gap: 10, alignItems: "end" }}>
                {!line.matchLabelByRecipeName && (
                  <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                    <span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B54" }}>
                      Consumable
                    </span>
                    <select
                      value={line.consumableId}
                      onChange={(e) => updateItem(line.id, { consumableId: e.target.value })}
                      style={{
                        width: "100%",
                        boxSizing: "border-box",
                        background: "#FFFFFF",
                        border: "1px solid #DDE0C8",
                        borderRadius: 4,
                        padding: "9px 10px",
                        color: "#2A3324",
                        fontFamily: "'Inter', sans-serif",
                        fontSize: 14,
                      }}
                    >
                      {consumables.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <NumberField label="Qty each" value={line.qtyPerUnit} onChange={(v) => updateItem(line.id, { qtyPerUnit: v })} step="1" />
              </div>
              {line.matchLabelByRecipeName && (
                <div style={{ color: "#9BA88A", fontSize: 11.5, marginTop: 8 }}>
                  At packaging time, this'll look for a Label consumable with the same name as the beer being packaged.
                </div>
              )}
            </div>
          ))}

        {consumables.length > 0 && (
          <button
            onClick={addItemRow}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              background: "none",
              border: "1px dashed #C9D1AC",
              borderRadius: 5,
              padding: "9px",
              color: "#5C6B54",
              fontFamily: "'Inter', sans-serif",
              fontSize: 12.5,
              cursor: "pointer",
            }}
          >
            <Plus size={14} /> Add another consumable
          </button>
        )}

        <button
          onClick={submit}
          disabled={saving || consumables.length === 0}
          style={{
            marginTop: 8,
            background: saving || consumables.length === 0 ? "#E8E4D4" : "#5C9A3C",
            border: "none",
            borderRadius: 5,
            padding: "12px",
            color: saving || consumables.length === 0 ? "#A3AC94" : "#16191A",
            fontFamily: "'Oswald', sans-serif",
            fontWeight: 500,
            fontSize: 15,
            letterSpacing: "0.03em",
            cursor: saving || consumables.length === 0 ? "default" : "pointer",
          }}
        >
          {saving ? "Saving…" : "Create package type"}
        </button>
      </div>
    </Modal>
  );
}

export function PackageTypeDetail({ packageType, consumables, onBack, onDelete, onRename }) {
  const [showRename, setShowRename] = useState(false);
  const costableItems = packageType.items.filter((it) => !it.matchLabelByRecipeName);
  const hasVariableLabel = packageType.items.some((it) => it.matchLabelByRecipeName);
  const allCosted = costableItems.length > 0 && costableItems.every((it) => {
    const c = consumables.find((c) => c.id === it.consumableId);
    return c && c.costPerUnit != null;
  });
  const per = Math.max(1, Number(packageType.unitsPerPack) || 1);
  const packQty = (it) => (it.qtyPerPack != null ? Number(it.qtyPerPack) : (Number(it.qtyPerUnit) || 0) * per);
  const totalCost = costableItems.reduce((sum, it) => {
    const c = consumables.find((c) => c.id === it.consumableId);
    return sum + (c?.costPerUnit || 0) * packQty(it);
  }, 0);

  return (
    <div>
      <button
        onClick={onBack}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: "none",
          border: "none",
          color: "#5C6B54",
          cursor: "pointer",
          fontFamily: "'Inter', sans-serif",
          fontSize: 13,
          padding: 0,
          marginBottom: 18,
        }}
      >
        <ChevronLeft size={16} /> All package types
      </button>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20 }}>
        <h1 style={{ fontFamily: "'Oswald', sans-serif", fontSize: 24, color: "#2A3324", margin: 0 }}>
          {packageType.name}
        </h1>
        {onRename && (
          <button
            onClick={() => setShowRename(true)}
            aria-label="Rename"
            style={{ background: "none", border: "none", color: "#9BA88A", cursor: "pointer", padding: 4 }}
          >
            <Pencil size={15} />
          </button>
        )}
      </div>
      {showRename && (
        <RenameModal
          title="Rename package type"
          currentName={packageType.name}
          onClose={() => setShowRename(false)}
          onSave={(newName) => onRename(packageType.id, newName)}
        />
      )}

      {costableItems.length > 0 && (
        <div style={{ background: "#F8F5EA", border: "1px solid #EBE8D6", borderRadius: 6, padding: "12px 14px", marginBottom: 20 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 4 }}>
            {per > 1 ? `Cost per pack of ${per}` : "Cost per unit"}
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 20, color: "#2A3324" }}>
            {allCosted ? `$${totalCost.toFixed(2)}` : `~$${totalCost.toFixed(2)}`}
            {per > 1 && <span style={{ fontSize: 13, color: "#9BA88A", marginLeft: 10 }}>${(totalCost / per).toFixed(2)} each</span>}
          </div>
          {(!allCosted || hasVariableLabel) && (
            <div style={{ color: "#9BA88A", fontSize: 11.5, marginTop: 3 }}>
              {!allCosted && "Some consumables here don't have a cost set yet, so this is a partial total. "}
              {hasVariableLabel && "Doesn't include the auto-matched label, since its cost varies by recipe."}
            </div>
          )}
        </div>
      )}

      <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>
        {per > 1 ? `Consumables per pack of ${per}` : "Consumables used per unit packaged"}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 24 }}>
        {packageType.items.map((it, i) => {
          const c = it.consumableId ? consumables.find((c) => c.id === it.consumableId) : null;
          const lineCost = c?.costPerUnit != null ? c.costPerUnit * packQty(it) : null;
          return (
            <div
              key={i}
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "10px 12px",
                background: "#F8F5EA",
                border: "1px solid #EBE8D6",
                borderRadius: 5,
                fontSize: 13.5,
                color: "#2A3324",
              }}
            >
              <span>{it.matchLabelByRecipeName ? "Label (auto-matched by beer name)" : it.consumableName}</span>
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#5C6B54" }}>× {Math.round(packQty(it) * 1000) / 1000}</span>
                {lineCost != null && (
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#9BA88A", fontSize: 12 }}>${lineCost.toFixed(2)}</span>
                )}
              </span>
            </div>
          );
        })}
      </div>

      {onDelete && (
        <button
          onClick={() => onDelete(packageType.id)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            background: "none",
            border: "1px solid #DDE0C8",
            borderRadius: 5,
            padding: "9px 12px",
            color: "#5C6B54",
            fontFamily: "'Inter', sans-serif",
            fontSize: 12.5,
            cursor: "pointer",
          }}
        >
          <Trash2 size={14} /> Delete package type
        </button>
      )}
    </div>
  );
}
