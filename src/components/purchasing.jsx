import { useState } from "react";
import { Plus, ChevronLeft, X, Truck, CheckCircle2, Trash2 } from "lucide-react";
import { nameSimilarity } from "./inventory";
import { BackdateField, Modal, NumberField, SelectField, TextField } from "./ui";
import { CATEGORIES, CATEGORY_COLOR } from "../lib/config";
import { formatQty, sameItemName, uid, unitFactor } from "../lib/production";
import { today } from "../lib/utils";

export function POStatusPill({ status }) {
  const color = status === "Received" ? "#D9A441" : status === "Sent" ? "#5C9A3C" : "#5C6B54";
  return (
    <span
      style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 11,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color,
        border: `1px solid ${color}`,
        borderRadius: 3,
        padding: "3px 7px",
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
      }}
    >
      {status === "Received" && <CheckCircle2 size={11} />}
      {status}
    </span>
  );
}

export function POCard({ po, onOpen }) {
  return (
    <button
      onClick={() => onOpen(po.id)}
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
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#9BA88A", fontSize: 13 }}>{po.poNumber}</span>
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
            {po.supplier}
          </h3>
        </div>
        <div style={{ color: "#5C6B54", fontSize: 12.5, marginTop: 3 }}>
          {po.lines.length} item{po.lines.length !== 1 ? "s" : ""} · ordered {po.orderDate.slice(5)}
        </div>
      </div>
      <POStatusPill status={po.status} />
    </button>
  );
}

export function AddPOModal({ onClose, onAdd, onSave, nextPONumber, suppliers, inventory, onExtractDocument, editingPO, presetItem }) {
  const [supplier, setSupplier] = useState(editingPO ? editingPO.supplier : presetItem?.supplierId ? suppliers.find((s) => s.id === presetItem.supplierId)?.name || "" : "");
  const [supplierFocused, setSupplierFocused] = useState(false);
  const [deliveryCost, setDeliveryCost] = useState(editingPO?.deliveryCost != null ? String(editingPO.deliveryCost) : "");
  const [lines, setLines] = useState(
    editingPO
      ? editingPO.lines.map((l) => ({
          id: l.id,
          name: l.name,
          category: l.category,
          qty: l.qty,
          unit: l.unit,
          costMode: "perUnit",
          costInput: l.costPerUnit != null ? String(l.costPerUnit) : "",
          lotNumber: l.lotNumber || "",
        }))
      : presetItem
      ? [{ id: uid(), name: presetItem.name, category: presetItem.category, qty: Math.max(1, Math.ceil((presetItem.threshold || 0) * 2 - presetItem.qty)), unit: presetItem.unit, costMode: "perUnit", costInput: "", lotNumber: "" }]
      : [{ id: uid(), name: "", category: "Grain", qty: 1, unit: "kg", costMode: "perUnit", costInput: "", lotNumber: "" }]
  );
  const [focusedLineId, setFocusedLineId] = useState(null);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState("");

  const handleImportFile = async (file) => {
    if (!file || !onExtractDocument) return;
    setExtracting(true);
    setExtractError("");
    const result = await onExtractDocument(file, "order");
    setExtracting(false);
    if (result.error) {
      setExtractError(result.error);
      return;
    }
    if (result.supplier) setSupplier(result.supplier);
    if (result.deliveryCost != null) setDeliveryCost(String(result.deliveryCost));
    if (result.lines && result.lines.length > 0) {
      setLines(
        result.lines.map((l) => ({
          id: uid(),
          name: l.name || "",
          category: "Grain",
          qty: l.qty ?? 1,
          unit: l.unit || "kg",
          costMode: "perUnit",
          costInput: l.costPerUnit != null ? String(l.costPerUnit) : "",
          lotNumber: l.lotNumber || "",
        }))
      );
    }
  };

  const supplierMatches = (suppliers || []).filter((s) => s.name.toLowerCase().includes(supplier.trim().toLowerCase()));

  const updateLine = (id, patch) =>
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  const addLine = () =>
    setLines((prev) => [...prev, { id: uid(), name: "", category: "Grain", qty: 1, unit: "kg", costMode: "perUnit", costInput: "", lotNumber: "" }]);

  const removeLine = (id) => setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.id !== id) : prev));
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const cleanLines = lines.filter((l) => l.name.trim());
    if (!supplier.trim() || cleanLines.length === 0) return;
    setSaving(true);
    const mappedLines = cleanLines.map((l) => {
      const qty = Number(l.qty) || 0;
      const raw = l.costInput === "" ? null : Number(l.costInput);
      const costPerUnit = raw == null ? null : l.costMode === "total" ? (qty > 0 ? raw / qty : null) : raw;
      return { id: l.id, name: l.name.trim(), category: l.category, qty, unit: l.unit, costPerUnit, lotNumber: l.lotNumber?.trim() || null };
    });
    if (editingPO) {
      await onSave(editingPO.id, {
        supplier: supplier.trim(),
        lines: mappedLines,
        deliveryCost: deliveryCost === "" ? null : Number(deliveryCost),
      });
    } else {
      await onAdd({
        id: uid(),
        poNumber: nextPONumber,
        supplier: supplier.trim(),
        orderDate: today(),
        receivedDate: null,
        status: "Draft",
        lines: mappedLines,
        deliveryCost: deliveryCost === "" ? null : Number(deliveryCost),
      });
    }
    setSaving(false);
    onClose();
  };

  return (
    <Modal title={editingPO ? `Edit ${editingPO.poNumber}` : "New purchase order"} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {onExtractDocument && (
          <div>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                background: extracting ? "#E8E4D4" : "#EAF2E4",
                border: `1px dashed ${extracting ? "#C9C4A8" : "#8FB86C"}`,
                borderRadius: 6,
                padding: "12px",
                color: extracting ? "#A3AC94" : "#3F6B32",
                fontFamily: "'Inter', sans-serif",
                fontSize: 13,
                cursor: extracting ? "default" : "pointer",
              }}
            >
              {extracting ? "Reading document…" : "📄 Import from a photo or PDF — fills in the fields below"}
              <input
                type="file"
                accept="image/*,application/pdf"
                onChange={(e) => handleImportFile(e.target.files?.[0])}
                disabled={extracting}
                style={{ display: "none" }}
              />
            </label>
            {extractError && (
              <div style={{ color: "#B5502F", fontSize: 12, marginTop: 6 }}>{extractError} — check the fields below and fill in anything missing.</div>
            )}
            {!extractError && !extracting && (
              <div style={{ color: "#9BA88A", fontSize: 11, marginTop: 6 }}>
                Always double-check what comes back — especially names, since a supplier's spelling might not match yours exactly.
              </div>
            )}
          </div>
        )}
        <div style={{ position: "relative" }}>
          <div style={{ color: "#9BA88A", fontSize: 11, marginBottom: 4 }}>Supplier</div>
          <input
            type="text"
            value={supplier}
            onChange={(e) => setSupplier(e.target.value)}
            onFocus={() => setSupplierFocused(true)}
            onBlur={() => setTimeout(() => setSupplierFocused(false), 150)}
            placeholder="Search suppliers, or type a new one"
            style={{ width: "100%", boxSizing: "border-box", background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 4, padding: "9px 10px", color: "#2A3324", fontFamily: "'Inter', sans-serif", fontSize: 14 }}
          />
          {supplierFocused && supplierMatches.length > 0 && (
            <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 10, background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 4, marginTop: 2, maxHeight: 180, overflowY: "auto" }}>
              {supplierMatches.map((s) => (
                <button
                  key={s.id}
                  onMouseDown={() => {
                    setSupplier(s.name);
                    setSupplierFocused(false);
                  }}
                  style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", borderBottom: "1px solid #EBE8D6", padding: "9px 10px", color: "#2A3324", fontSize: 13, cursor: "pointer" }}
                >
                  {s.name}
                </button>
              ))}
            </div>
          )}
        </div>
        <NumberField label="Delivery cost (optional)" value={deliveryCost} onChange={setDeliveryCost} step="0.01" />

        <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B54", marginTop: 4 }}>
          Line items
        </div>
        {lines.map((line, i) => (
          <div
            key={line.id}
            style={{
              background: "#F5F1E4",
              border: "1px solid #DDE0C8",
              borderRadius: 6,
              padding: "12px 12px 4px",
              position: "relative",
            }}
          >
            {lines.length > 1 && (
              <button
                onClick={() => removeLine(line.id)}
                aria-label="Remove line item"
                style={{
                  position: "absolute",
                  top: 8,
                  right: 8,
                  background: "none",
                  border: "none",
                  color: "#5C6B54",
                  cursor: "pointer",
                  padding: 8,
                }}
              >
                <Trash2 size={14} />
              </button>
            )}
            <div style={{ marginBottom: 10, position: "relative" }}>
              <div style={{ color: "#9BA88A", fontSize: 11, marginBottom: 4 }}>Item {i + 1}</div>
              <input
                type="text"
                value={line.name}
                onChange={(e) => updateLine(line.id, { name: e.target.value })}
                onFocus={() => setFocusedLineId(line.id)}
                onBlur={() => setTimeout(() => setFocusedLineId((cur) => (cur === line.id ? null : cur)), 150)}
                placeholder="Search inventory, or type a new item"
                style={{ width: "100%", boxSizing: "border-box", background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 4, padding: "9px 10px", color: "#2A3324", fontFamily: "'Inter', sans-serif", fontSize: 14 }}
              />
              {focusedLineId === line.id &&
                line.name.trim().length > 0 &&
                (() => {
                  const matches = (inventory || []).filter((it) => it.name.toLowerCase().includes(line.name.trim().toLowerCase()));
                  if (matches.length === 0) return null;
                  return (
                    <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 10, background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 4, marginTop: 2, maxHeight: 180, overflowY: "auto" }}>
                      {matches.map((it) => (
                        <button
                          key={it.id}
                          onMouseDown={() => {
                            updateLine(line.id, { name: it.name, category: it.category, unit: it.unit });
                            setFocusedLineId(null);
                          }}
                          style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", borderBottom: "1px solid #EBE8D6", padding: "9px 10px", color: "#2A3324", fontSize: 13, cursor: "pointer" }}
                        >
                          {it.name}
                        </button>
                      ))}
                    </div>
                  );
                })()}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 8 }}>
              <SelectField
                label="Category"
                value={line.category}
                onChange={(v) => updateLine(line.id, { category: v, ...(v === "Juice" ? { unit: "L" } : {}) })}
                options={CATEGORIES}
              />
              <SelectField label="Unit" value={line.unit} onChange={(v) => updateLine(line.id, { unit: v })} options={["kg", "g", "L", "ea"]} />
              <NumberField label="Quantity" value={line.qty} onChange={(v) => updateLine(line.id, { qty: v })} step="0.1" suffix={line.unit} />
              <NumberField
                label={line.costMode === "total" ? "Total cost for this line" : "Cost per unit (optional)"}
                value={line.costInput}
                onChange={(v) => updateLine(line.id, { costInput: v })}
                step="0.01"
              />
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <button
                onClick={() => updateLine(line.id, { costMode: line.costMode === "total" ? "perUnit" : "total" })}
                style={{ background: "none", border: "none", color: "#5C9A3C", cursor: "pointer", fontSize: 12, fontFamily: "'Inter', sans-serif", padding: 0 }}
              >
                {line.costMode === "total" ? "Switch to cost per unit instead" : "Know the total cost instead? Tap here"}
              </button>
              {line.costInput !== "" && Number(line.qty) > 0 && (
                <span style={{ fontSize: 12, color: "#9BA88A", fontFamily: "'JetBrains Mono', monospace" }}>
                  {line.costMode === "total"
                    ? `= $${(Number(line.costInput) / Number(line.qty)).toFixed(2)}/${line.unit}`
                    : `= $${(Number(line.costInput) * Number(line.qty)).toFixed(2)} total`}
                </span>
              )}
            </div>
            <TextField
              label="Lot / batch # (optional — only if your supplier shows it on the PO itself)"
              value={line.lotNumber || ""}
              onChange={(v) => updateLine(line.id, { lotNumber: v })}
            />
          </div>
        ))}
        <button
          onClick={addLine}
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
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          <Plus size={14} /> Add line item
        </button>

        <button
          onClick={submit}
          disabled={saving}
          style={{
            marginTop: 4,
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
          {saving ? "Saving…" : editingPO ? "Save changes" : `Create ${nextPONumber}`}
        </button>
      </div>
    </Modal>
  );
}

export function ReceivePOModal({ po, onClose, onConfirm, onConfirmMultiple, onExtractDocument, otherSentPOs, inventory = [] }) {
  // lineId → inventory item to put that line into, or "new" to keep it as a new item.
  const [lineMatches, setLineMatches] = useState({});
  const lookalikesFor = (line) => {
    if (inventory.some((it) => sameItemName(it.name, line.name))) return [];
    return inventory
      .map((it) => ({ it, score: nameSimilarity(line.name, it.name) + (it.category === line.category ? 0.1 : 0) }))
      .filter((x) => x.score >= 0.6 && unitFactor(line.unit, x.it.unit) != null)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((x) => x.it);
  };
  const [combinedPOs, setCombinedPOs] = useState([]);
  const [combineQuery, setCombineQuery] = useState("");
  const [combineFocused, setCombineFocused] = useState(false);
  const allPOs = [po, ...combinedPOs];
  const allLines = allPOs.flatMap((p) => p.lines.map((l) => ({ ...l, _poNumber: p.poNumber })));

  const [lotNumbers, setLotNumbers] = useState(() => {
    const init = {};
    po.lines.forEach((l) => (init[l.id] = l.lotNumber || ""));
    return init;
  });
  const [costOverrides, setCostOverrides] = useState(() => {
    const init = {};
    po.lines.forEach((l) => (init[l.id] = l.costPerUnit != null ? String(l.costPerUnit) : ""));
    return init;
  });
  const [deliveryCostInput, setDeliveryCostInput] = useState(po.deliveryCost != null ? String(po.deliveryCost) : "");
  const [receivedOn, setReceivedOn] = useState(today());
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState("");
  const [unmatchedItems, setUnmatchedItems] = useState([]);

  const combineMatches = combineQuery.trim()
    ? (otherSentPOs || []).filter(
        (p) =>
          !combinedPOs.some((c) => c.id === p.id) &&
          (p.poNumber.toLowerCase().includes(combineQuery.trim().toLowerCase()) || p.supplier.toLowerCase().includes(combineQuery.trim().toLowerCase()))
      )
    : (otherSentPOs || []).filter((p) => !combinedPOs.some((c) => c.id === p.id));

  const addCombinedPO = (otherPO) => {
    setCombinedPOs((prev) => [...prev, otherPO]);
    setLotNumbers((prev) => {
      const next = { ...prev };
      otherPO.lines.forEach((l) => (next[l.id] = l.lotNumber || ""));
      return next;
    });
    setCostOverrides((prev) => {
      const next = { ...prev };
      otherPO.lines.forEach((l) => (next[l.id] = l.costPerUnit != null ? String(l.costPerUnit) : ""));
      return next;
    });
    setDeliveryCostInput((prev) => {
      const current = prev === "" ? 0 : Number(prev);
      const added = otherPO.deliveryCost || 0;
      return String(Math.round((current + added) * 100) / 100);
    });
    setCombineQuery("");
    setCombineFocused(false);
  };

  const removeCombinedPO = (id) => {
    const removed = combinedPOs.find((p) => p.id === id);
    setCombinedPOs((prev) => prev.filter((p) => p.id !== id));
    if (removed) {
      setLotNumbers((prev) => {
        const next = { ...prev };
        removed.lines.forEach((l) => delete next[l.id]);
        return next;
      });
      setCostOverrides((prev) => {
        const next = { ...prev };
        removed.lines.forEach((l) => delete next[l.id]);
        return next;
      });
    }
  };

  const handleImportFile = async (file, targetPOId) => {
    if (!file || !onExtractDocument) return;
    setExtracting(true);
    setExtractError("");
    setUnmatchedItems([]);
    const result = await onExtractDocument(file, "receiving");
    setExtracting(false);
    if (result.error) {
      setExtractError(result.error);
      return;
    }
    // Match extracted lines back to the PO's existing lines by name — a
    // close, not necessarily exact, match, since a docket's wording often
    // differs slightly from what was typed when the order was placed.
    // Scoped to just the PO this scan is actually for — combined orders
    // can genuinely share near-identical item names (two "Munich Malt"
    // lines from different suppliers' invoices), and matching against the
    // full combined set let one order's scan silently overwrite another's
    // correct figures. Anything that doesn't match within its own PO gets
    // surfaced, not silently dropped.
    const scopedLines = targetPOId ? allLines.filter((l) => allPOs.find((p) => p.id === targetPOId)?.lines.some((pl) => pl.id === l.id)) : allLines;
    const unmatched = [];
    (result.lines || []).forEach((el) => {
      if (!el.name) return;
      const match = scopedLines.find((l) => l.name.toLowerCase().includes(el.name.toLowerCase()) || el.name.toLowerCase().includes(l.name.toLowerCase()));
      if (!match) {
        unmatched.push(el.name);
        return;
      }
      if (el.lotNumber) setLotNumbers((prev) => ({ ...prev, [match.id]: el.lotNumber }));
      if (el.costPerUnit != null) setCostOverrides((prev) => ({ ...prev, [match.id]: String(el.costPerUnit) }));
    });
    if (unmatched.length > 0) setUnmatchedItems(unmatched);
  };

  const submit = () => {
    const costs = {};
    Object.entries(costOverrides).forEach(([id, v]) => {
      costs[id] = v === "" ? null : Number(v);
    });
    const deliveryCostOverride = deliveryCostInput === "" ? null : Number(deliveryCostInput);
    const matches = {};
    Object.entries(lineMatches).forEach(([id, it]) => {
      if (it && it !== "new") matches[id] = { name: it.name, unit: it.unit, category: it.category };
    });
    if (combinedPOs.length > 0) {
      onConfirmMultiple(allPOs.map((p) => p.id), lotNumbers, costs, deliveryCostOverride, receivedOn, matches);
    } else {
      onConfirm(lotNumbers, costs, deliveryCostOverride, receivedOn, matches);
    }
    onClose();
  };

  return (
    <Modal title={combinedPOs.length > 0 ? `Receive ${allPOs.map((p) => p.poNumber).join(" & ")}` : `Receive ${po.poNumber}`} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {onExtractDocument && combinedPOs.length === 0 && (
          <div>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                background: extracting ? "#E8E4D4" : "#EAF2E4",
                border: `1px dashed ${extracting ? "#C9C4A8" : "#8FB86C"}`,
                borderRadius: 6,
                padding: "12px",
                color: extracting ? "#A3AC94" : "#3F6B32",
                fontFamily: "'Inter', sans-serif",
                fontSize: 13,
                cursor: extracting ? "default" : "pointer",
              }}
            >
              {extracting ? "Reading document…" : "📄 Import from a photo or PDF — fills in lot numbers and prices below"}
              <input
                type="file"
                accept="image/*,application/pdf"
                onChange={(e) => handleImportFile(e.target.files?.[0], po.id)}
                disabled={extracting}
                style={{ display: "none" }}
              />
            </label>
            {extractError && (
              <div style={{ color: "#B5502F", fontSize: 12, marginTop: 6 }}>{extractError} — check the fields below and fill in anything missing.</div>
            )}
            {!extractError && !extracting && unmatchedItems.length > 0 && (
              <div style={{ color: "#B5502F", fontSize: 12, marginTop: 6, lineHeight: 1.5 }}>
                Couldn't match {unmatchedItems.length} item{unmatchedItems.length !== 1 ? "s" : ""} on the document to anything on the order — enter these by hand: {unmatchedItems.join(", ")}.
              </div>
            )}
            {!extractError && !extracting && unmatchedItems.length === 0 && (
              <div style={{ color: "#9BA88A", fontSize: 11, marginTop: 6 }}>
                Matched to these order lines by name — double-check nothing landed on the wrong item if names differ from the docket.
              </div>
            )}
          </div>
        )}
        <div style={{ color: "#5C6B54", fontSize: 13 }}>
          Enter the lot or batch number printed on each item as it arrives, and adjust the price if the delivery docket differs from what was ordered. Already filled in below where a lot number was entered on the PO itself — double-check it matches what's actually arrived.
        </div>
        <div>
          <NumberField label="Delivery cost (optional)" value={deliveryCostInput} onChange={setDeliveryCostInput} step="0.01" />
          <div style={{ color: "#9BA88A", fontSize: 11, marginTop: 4 }}>
            Add or change this if the freight charge arrives separately from the supplier's invoice — it's still split across the items below in proportion to their value, same as if it'd been on the original order.
          </div>
        </div>

        {(otherSentPOs || []).length > 0 && (
          <div style={{ position: "relative" }}>
            <div style={{ color: "#9BA88A", fontSize: 11, marginBottom: 4 }}>
              Arrived in the same delivery as another order? Combine it here so the delivery cost splits across both.
            </div>
            <input
              type="text"
              value={combineQuery}
              onChange={(e) => setCombineQuery(e.target.value)}
              onFocus={() => setCombineFocused(true)}
              onBlur={() => setTimeout(() => setCombineFocused(false), 150)}
              placeholder="Search by PO number or supplier"
              style={{ width: "100%", boxSizing: "border-box", background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 4, padding: "9px 10px", color: "#2A3324", fontFamily: "'Inter', sans-serif", fontSize: 14 }}
            />
            {combineFocused && combineMatches.length > 0 && (
              <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 10, background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 4, marginTop: 2, maxHeight: 180, overflowY: "auto" }}>
                {combineMatches.map((p) => (
                  <button
                    key={p.id}
                    onMouseDown={() => addCombinedPO(p)}
                    style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", borderBottom: "1px solid #EBE8D6", padding: "9px 10px", color: "#2A3324", fontSize: 13, cursor: "pointer" }}
                  >
                    {p.poNumber} <span style={{ color: "#9BA88A" }}>— {p.supplier}</span>
                  </button>
                ))}
              </div>
            )}
            {combinedPOs.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                {combinedPOs.map((p) => (
                  <span
                    key={p.id}
                    style={{ display: "flex", alignItems: "center", gap: 6, background: "#EAF2E4", border: "1px solid #8FB86C", borderRadius: 20, padding: "4px 6px 4px 12px", fontSize: 12.5, color: "#3F6B32" }}
                  >
                    {p.poNumber}
                    <button
                      onClick={() => removeCombinedPO(p.id)}
                      aria-label={`Remove ${p.poNumber} from this combined delivery`}
                      style={{ background: "none", border: "none", color: "#3F6B32", cursor: "pointer", padding: 4, display: "flex" }}
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {allPOs.map((p) => (
          <div key={p.id}>
            {combinedPOs.length > 0 && (
              <div style={{ marginBottom: 8, marginTop: p.id === po.id ? 0 : 8 }}>
                <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 6 }}>
                  {p.poNumber} — {p.supplier}
                </div>
                {onExtractDocument && (
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                      background: extracting ? "#E8E4D4" : "#EAF2E4",
                      border: `1px dashed ${extracting ? "#C9C4A8" : "#8FB86C"}`,
                      borderRadius: 6,
                      padding: "10px",
                      color: extracting ? "#A3AC94" : "#3F6B32",
                      fontFamily: "'Inter', sans-serif",
                      fontSize: 12.5,
                      cursor: extracting ? "default" : "pointer",
                      marginBottom: 8,
                    }}
                  >
                    {extracting ? "Reading document…" : `📄 Import ${p.poNumber}'s invoice — fills in this order's lines only`}
                    <input
                      type="file"
                      accept="image/*,application/pdf"
                      onChange={(e) => handleImportFile(e.target.files?.[0], p.id)}
                      disabled={extracting}
                      style={{ display: "none" }}
                    />
                  </label>
                )}
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {p.lines.map((l) => (
                <div
                  key={l.id}
                  style={{
                    background: "#F5F1E4",
                    border: "1px solid #DDE0C8",
                    borderRadius: 6,
                    padding: "12px 12px",
                  }}
                >
                  <div style={{ color: "#2A3324", fontSize: 13.5, marginBottom: 8 }}>
                    {l.name} <span style={{ color: "#9BA88A", fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>({formatQty(l.qty, l.unit)})</span>
                  </div>
                  {(() => {
                    const looks = lookalikesFor(l);
                    const chosen = lineMatches[l.id];
                    if (looks.length === 0 && !(chosen && chosen !== "new")) return null;
                    const pill = (on) => ({ background: on ? "#5C9A3C" : "#FFFFFF", border: `1px solid ${on ? "#5C9A3C" : "#DDE0C8"}`, borderRadius: 999, padding: "6px 11px", fontSize: 12.5, color: on ? "#16191A" : "#2A3324", cursor: "pointer", fontFamily: "'Inter', sans-serif" });
                    return (
                      <div style={{ background: chosen ? "#EBF3E4" : "#FBE5D2", border: `1px solid ${chosen ? "#9BC48A" : "#E3B37A"}`, borderRadius: 6, padding: "9px 10px", marginBottom: 10 }}>
                        <div style={{ fontSize: 12.5, color: chosen ? "#3F7A28" : "#7A3E1D", marginBottom: 7, lineHeight: 1.4 }}>
                          {chosen && chosen !== "new"
                            ? `Going into ${chosen.name}${chosen.unit !== l.unit ? ` (as ${formatQty(Math.round(l.qty * unitFactor(l.unit, chosen.unit) * 1000) / 1000, chosen.unit)})` : ""}.`
                            : chosen === "new"
                            ? `Adding as a new item called "${l.name}".`
                            : `No inventory item is called "${l.name}", so this would add a new one. Is it one of these?`}
                        </div>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {looks.map((it) => (
                            <button key={it.id} type="button" onClick={() => setLineMatches((p) => ({ ...p, [l.id]: it }))} style={pill(chosen && chosen.id === it.id)}>
                              {it.name} · {it.qty}{it.unit}
                            </button>
                          ))}
                          <button type="button" onClick={() => setLineMatches((p) => ({ ...p, [l.id]: "new" }))} style={pill(chosen === "new")}>
                            Keep as new item
                          </button>
                        </div>
                      </div>
                    );
                  })()}
                  <div style={{ display: "flex", gap: 10 }}>
                    <div style={{ flex: 1 }}>
                      <TextField
                        label="Lot / batch #"
                        value={lotNumbers[l.id]}
                        onChange={(v) => setLotNumbers((prev) => ({ ...prev, [l.id]: v }))}
                      />
                    </div>
                    <div style={{ flex: 1 }}>
                      <NumberField
                        label="Cost per unit"
                        value={costOverrides[l.id]}
                        onChange={(v) => setCostOverrides((prev) => ({ ...prev, [l.id]: v }))}
                        step="0.01"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
        {combinedPOs.length > 0 && !extractError && !extracting && unmatchedItems.length > 0 && (
          <div style={{ color: "#B5502F", fontSize: 12, marginTop: -4, lineHeight: 1.5 }}>
            Couldn't match {unmatchedItems.length} item{unmatchedItems.length !== 1 ? "s" : ""} from the last scan — enter these by hand: {unmatchedItems.join(", ")}.
          </div>
        )}
        <BackdateField value={receivedOn} onChange={setReceivedOn} label="Date received" />
        <button
          onClick={submit}
          style={{
            marginTop: 4,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 7,
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
          <Truck size={16} /> {combinedPOs.length > 0 ? "Confirm receipt of both & add to inventory" : "Confirm receipt & add to inventory"}
        </button>
      </div>
    </Modal>
  );
}

export function PODetail({ po, onBack, onMarkSent, onReceive, onReceiveMultiple, inventory, onDelete, onExtractDocument, onEdit, allPOs }) {
  const [showReceive, setShowReceive] = useState(false);
  const batchesForLine = (lineName, lotNumber) => {
    const item = inventory.find((it) => sameItemName(it.name, lineName));
    if (!item || !item.history) return [];
    const targetLot = lotNumber || "no lot #";
    const notes = item.history
      .filter((h) => h.type === "batch" && Array.isArray(h.lots) && h.lots.some((l) => l.lotNumber === targetLot))
      .map((h) => h.note);
    return [...new Set(notes)];
  };

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
        <ChevronLeft size={16} /> All purchase orders
      </button>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
        <div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", color: "#9BA88A", fontSize: 13 }}>{po.poNumber}</div>
          <h1 style={{ fontFamily: "'Oswald', sans-serif", fontSize: 24, color: "#2A3324", margin: "2px 0 6px", fontWeight: 500 }}>
            {po.supplier}
          </h1>
        </div>
        <POStatusPill status={po.status} />
      </div>
      <div style={{ color: "#5C6B54", fontSize: 13, marginBottom: 22 }}>
        Created {po.orderDate}
        {po.receivedDate ? ` · Received ${po.receivedDate}` : ""}
      </div>

      <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>
        Line items
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 24 }}>
        {po.lines.map((l) => {
          const usedIn = po.status === "Received" ? batchesForLine(l.name, l.lotNumber) : [];
          return (
            <div
              key={l.id}
              style={{
                padding: "10px 12px",
                background: "#F8F5EA",
                border: "1px solid #EBE8D6",
                borderRadius: 5,
                fontSize: 13,
              }}
            >
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <span style={{ flex: 1, color: "#2A3324", fontFamily: "'Inter', sans-serif" }}>{l.name}</span>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", color: CATEGORY_COLOR[l.category], fontSize: 11 }}>
                  {l.category}
                </span>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#2A3324", width: 64, textAlign: "right", flexShrink: 0 }}>
                  {formatQty(l.qty, l.unit)}
                </span>
                {po.status === "Received" && (
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#9BA88A", width: 90, flexShrink: 0, textAlign: "right" }}>
                    {l.lotNumber || "no lot #"}
                  </span>
                )}
              </div>
              {po.status === "Received" && (
                <div style={{ color: "#9BA88A", fontSize: 11.5, marginTop: 6 }}>
                  {usedIn.length > 0 ? `Used in: ${usedIn.join(", ")}` : "Not used in any batch yet"}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {po.status === "Draft" && (
        <button
          onClick={() => onMarkSent(po.id)}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 7,
            background: "#5C9A3C",
            border: "none",
            borderRadius: 5,
            padding: "12px",
            color: "#16191A",
            fontFamily: "'Oswald', sans-serif",
            fontWeight: 500,
            fontSize: 14,
            cursor: "pointer",
          }}
        >
          Mark as sent
        </button>
      )}

      {po.status === "Sent" && (
        <button
          onClick={() => setShowReceive(true)}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 7,
            background: "#5C9A3C",
            border: "none",
            borderRadius: 5,
            padding: "12px",
            color: "#16191A",
            fontFamily: "'Oswald', sans-serif",
            fontWeight: 500,
            fontSize: 14,
            cursor: "pointer",
          }}
        >
          <Truck size={16} /> Mark received & add to inventory
        </button>
      )}

      {po.status !== "Received" && (
        <button
          onClick={() => onEdit(po)}
          style={{
            width: "100%",
            background: "none",
            border: "1px solid #DDE0C8",
            borderRadius: 5,
            padding: "11px",
            color: "#5C6B54",
            fontFamily: "'Inter', sans-serif",
            fontSize: 13,
            cursor: "pointer",
            marginTop: 10,
          }}
        >
          Edit order
        </button>
      )}

      {showReceive && (
        <ReceivePOModal
          po={po}
          onClose={() => setShowReceive(false)}
          onConfirm={(lotNumbers, costOverrides, deliveryCostOverride, receivedOn, lineMatches) => onReceive(po.id, lotNumbers, costOverrides, deliveryCostOverride, receivedOn, lineMatches)}
          onConfirmMultiple={(poIds, lotNumbers, costOverrides, deliveryCostOverride, receivedOn, lineMatches) => onReceiveMultiple(poIds, lotNumbers, costOverrides, deliveryCostOverride, receivedOn, lineMatches)}
          inventory={inventory}
          onExtractDocument={onExtractDocument}
          otherSentPOs={(allPOs || []).filter((p) => p.status === "Sent" && p.id !== po.id)}
        />
      )}

      {po.status !== "Received" && onDelete && (
        <button
          onClick={() => onDelete(po)}
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
            marginTop: 16,
          }}
        >
          Delete order
        </button>
      )}
    </div>
  );
}
