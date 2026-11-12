import { useState, useRef, Suspense } from "react";
import { createPortal } from "react-dom";
import { Plus, ChevronLeft, X, Truck, CheckCircle2, Trash2, FileText, Box } from "lucide-react";
// Charts: recharts is imported directly. Lazy-loading each piece separately
// (as this used to) breaks recharts — a chart only draws children it
// recognises by type, so lazy-wrapped bars, lines and axes were skipped and
// every chart rendered as an empty frame.
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { BackdateField, EmptyState, Modal, NumberField, StageDateModal, TextField } from "./ui";
import { formatHistoryStamp } from "../lib/brewing";
import { batchCostPerContainer, canonicalBeerName, uid } from "../lib/production";
import { today } from "../lib/utils";

export function AddSalesOrderModal({ onClose, onAdd, customers, availableStock, mixedPackStock, nextOrderNumber }) {
  const [customerId, setCustomerId] = useState("");
  const [orderDate, setOrderDate] = useState(today());
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState([{ id: uid(), value: "", qty: "", unitPrice: "" }]);
  const [saving, setSaving] = useState(false);

  const stockOptions = availableStock.filter((s) => s.available > 0);
  const packOptions = (mixedPackStock || []).filter((t) => t.available > 0);

  const resolveValue = (value) => {
    if (!value) return null;
    if (value.startsWith("pack::")) {
      const packId = value.slice(6);
      const pack = packOptions.find((t) => t.id === packId);
      return pack ? { kind: "pack", pack } : null;
    }
    const [batchId, containerKey] = value.split("::");
    const stock = stockOptions.find((s) => s.batchId === batchId && s.containerKey === containerKey);
    return stock ? { kind: "stock", stock } : null;
  };

  const updateLine = (id, patch) => setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const addLine = () => setLines((prev) => [...prev, { id: uid(), value: "", qty: "", unitPrice: "" }]);
  const removeLine = (id) => setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.id !== id) : prev));

  const submit = async () => {
    const cleanLines = lines.filter((l) => l.value && Number(l.qty) > 0);
    if (!customerId || cleanLines.length === 0) return;
    setSaving(true);
    const customer = customers.find((c) => c.id === customerId);
    await onAdd({
      id: uid(),
      customerId,
      orderNumber: nextOrderNumber,
      status: "Draft",
      orderDate,
      notes: notes.trim(),
      lines: cleanLines.map((l) => {
        const resolved = resolveValue(l.value);
        if (resolved?.kind === "pack") {
          return {
            id: l.id,
            mixedPackTypeId: resolved.pack.id,
            mixedPackTypeName: resolved.pack.name,
            qty: Number(l.qty),
            unitPrice: l.unitPrice === "" ? resolved.pack.price || 0 : Number(l.unitPrice),
          };
        }
        return {
          id: l.id,
          batchId: resolved ? resolved.stock.batchId : "",
          batchName: resolved ? resolved.stock.batchName : "",
          containerKey: resolved ? resolved.stock.containerKey : "",
          containerLabel: resolved ? resolved.stock.containerLabel : "",
          qty: Number(l.qty),
          unitPrice: l.unitPrice === "" ? 0 : Number(l.unitPrice),
        };
      }),
    });
    setSaving(false);
    onClose();
  };

  return (
    <Modal title="New order" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {customers.length === 0 ? (
          <div style={{ color: "#9BA88A", fontSize: 13 }}>Add a customer first, then come back here to create an order for them.</div>
        ) : (
          <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B54" }}>Customer</span>
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              style={{ width: "100%", boxSizing: "border-box", background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 4, padding: "9px 10px", color: "#2A3324", fontFamily: "'Inter', sans-serif", fontSize: 14 }}
            >
              <option value="">Choose a customer…</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B54" }}>Order date</span>
          <input
            type="date"
            value={orderDate}
            onChange={(e) => setOrderDate(e.target.value)}
            style={{ boxSizing: "border-box", background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 4, padding: "9px 10px", color: "#2A3324", fontFamily: "'Inter', sans-serif", fontSize: 14 }}
          />
        </label>

        <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B54" }}>Order lines</div>
        {stockOptions.length === 0 && packOptions.length === 0 && (
          <div style={{ color: "#9BA88A", fontSize: 13 }}>Nothing packaged and available to sell yet — package a batch first.</div>
        )}
        {(stockOptions.length > 0 || packOptions.length > 0) &&
          lines.map((line) => {
            const resolved = resolveValue(line.value);
            const maxQty = resolved?.kind === "pack" ? resolved.pack.available : resolved?.kind === "stock" ? resolved.stock.available : undefined;
            return (
              <div key={line.id} style={{ display: "flex", flexDirection: "column", gap: 6, background: "#F8F5EA", border: "1px solid #EBE8D6", borderRadius: 6, padding: 10 }}>
                <select
                  value={line.value}
                  onChange={(e) => updateLine(line.id, { value: e.target.value })}
                  style={{ width: "100%", boxSizing: "border-box", background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 4, padding: "8px", color: "#2A3324", fontFamily: "'Inter', sans-serif", fontSize: 13 }}
                >
                  <option value="">Choose stock…</option>
                  {packOptions.length > 0 && (
                    <optgroup label="Mixed packs">
                      {packOptions.map((t) => (
                        <option key={t.id} value={`pack::${t.id}`}>
                          {t.name} ({t.available} available)
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {stockOptions.length > 0 && (
                    <optgroup label="Beers">
                      {stockOptions.map((s) => (
                        <option key={`${s.batchId}::${s.containerKey}`} value={`${s.batchId}::${s.containerKey}`}>
                          {s.batchName} — {s.containerLabel} ({s.available} available)
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    type="number"
                    step="1"
                    min="1"
                    max={maxQty}
                    value={line.qty}
                    onChange={(e) => updateLine(line.id, { qty: e.target.value })}
                    placeholder="Qty"
                    style={{ flex: 1, boxSizing: "border-box", background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 4, padding: "8px", color: "#2A3324", fontFamily: "'JetBrains Mono', monospace", fontSize: 13 }}
                  />
                  <input
                    type="number"
                    step="0.01"
                    value={line.unitPrice}
                    onChange={(e) => updateLine(line.id, { unitPrice: e.target.value })}
                    placeholder={resolved?.kind === "pack" && resolved.pack.price != null ? `Price each (default $${resolved.pack.price.toFixed(2)})` : "Price each ($)"}
                    style={{ flex: 1, boxSizing: "border-box", background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 4, padding: "8px", color: "#2A3324", fontFamily: "'JetBrains Mono', monospace", fontSize: 13 }}
                  />
                  {lines.length > 1 && (
                    <button onClick={() => removeLine(line.id)} aria-label="Remove line" style={{ background: "none", border: "none", color: "#5C6B54", cursor: "pointer", padding: 8 }}>
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        {(stockOptions.length > 0 || packOptions.length > 0) && (
          <button
            onClick={addLine}
            style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, background: "none", border: "1px dashed #C9D1AC", borderRadius: 5, padding: "8px", color: "#5C6B54", fontFamily: "'Inter', sans-serif", fontSize: 12.5, cursor: "pointer" }}
          >
            <Plus size={13} /> Add another line
          </button>
        )}
        <TextField label="Notes (optional)" value={notes} onChange={setNotes} />
        <button
          onClick={submit}
          disabled={saving || customers.length === 0}
          style={{
            background: saving || customers.length === 0 ? "#E8E4D4" : "#5C9A3C",
            border: "none",
            borderRadius: 5,
            padding: "12px",
            color: saving || customers.length === 0 ? "#A3AC94" : "#16191A",
            fontFamily: "'Oswald', sans-serif",
            fontWeight: 500,
            fontSize: 15,
            letterSpacing: "0.03em",
            cursor: saving || customers.length === 0 ? "default" : "pointer",
          }}
        >
          {saving ? "Saving…" : "Create order"}
        </button>
      </div>
    </Modal>
  );
}

export function SalesOrderStatusPill({ status }) {
  const color =
    status === "Fulfilled"
      ? "#5C9A3C"
      : status === "Partially fulfilled"
      ? "#4AA8C9"
      : status === "Confirmed"
      ? "#D9A441"
      : status === "Cancelled"
      ? "#B5502F"
      : "#5C6B54";
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
      {status === "Fulfilled" && <CheckCircle2 size={11} />}
      {status}
    </span>
  );
}

export const salesOrderTotal = (order) => (order.lines || []).reduce((sum, l) => sum + (Number(l.qty) || 0) * (Number(l.unitPrice) || 0), 0);

export function SalesOrderCard({ order, customerName, onOpen }) {
  return (
    <button
      onClick={() => onOpen(order.id)}
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
        boxSizing: "border-box",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#C9D1AC")}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = "#DDE0C8")}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#9BA88A", fontSize: 13 }}>{order.orderNumber}</span>
          <h3 style={{ fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 16, color: "#2A3324", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {customerName}
          </h3>
        </div>
        <div style={{ color: "#5C6B54", fontSize: 12.5, marginTop: 3 }}>
          {(order.lines || []).length} line{(order.lines || []).length !== 1 ? "s" : ""} · ${salesOrderTotal(order).toFixed(2)} · {order.orderDate ? order.orderDate.slice(5) : ""}
          {order.paid && <span style={{ color: "#5C9A3C" }}> · Paid</span>}
        </div>
      </div>
      <SalesOrderStatusPill status={order.status} />
    </button>
  );
}

// Real sales performance, not just an order log — best-selling products,
// top customers, and genuine margin using the same cost-per-container
// math already shown on a batch's own packaging section. Counts only
// what's actually been fulfilled (using fulfilledQty where it's been
// recorded, falling back to the full line for orders marked Fulfilled
// before that field existed) — a Confirmed-but-not-yet-shipped order
// isn't a realized sale yet, so it's deliberately excluded.
export function SalesAnalyticsView({ salesOrders, customers, batches, isOwner }) {
  const relevantOrders = (salesOrders || []).filter((o) => o.status !== "Draft" && o.status !== "Cancelled");

  const effectiveQty = (line, order) => {
    if (line.fulfilledQty != null) return line.fulfilledQty;
    return order.status === "Fulfilled" ? line.qty || 0 : 0;
  };

  const productMap = {};
  const customerMap = {};
  const monthMap = {};

  relevantOrders.forEach((o) => {
    const month = (o.orderDate || "").slice(0, 7);
    let orderRevenue = 0;

    (o.lines || []).forEach((l) => {
      const qty = effectiveQty(l, o);
      if (qty <= 0) return;
      const revenue = qty * (Number(l.unitPrice) || 0);
      orderRevenue += revenue;

      // One row per beer and container, however many batches it came from.
      const beer = l.mixedPackTypeId ? "" : canonicalBeerName(l.batchName || "");
      const key = l.mixedPackTypeId ? `mp:${l.mixedPackTypeId}` : `${beer.toLowerCase()}:${l.containerKey}`;
      const label = l.mixedPackTypeId ? l.mixedPackTypeName : `${beer} — ${l.containerLabel}`;
      if (!productMap[key]) productMap[key] = { label, qty: 0, revenue: 0, cogs: 0, hasCost: true };
      productMap[key].qty += qty;
      productMap[key].revenue += revenue;
      if (!l.mixedPackTypeId) {
        const batch = l.batchId ? batches.find((b) => b.id === l.batchId) : null;
        const costEach = batch ? batchCostPerContainer(batch, l.containerKey) : null;
        if (costEach != null) productMap[key].cogs += costEach * qty;
        else productMap[key].hasCost = false;
      } else {
        productMap[key].hasCost = false; // a mixed pack draws from several beers — no single cost basis to show here
      }
    });

    if (orderRevenue > 0) {
      if (!customerMap[o.customerId]) customerMap[o.customerId] = { revenue: 0, orders: 0 };
      customerMap[o.customerId].revenue += orderRevenue;
      customerMap[o.customerId].orders += 1;
      if (month) monthMap[month] = (monthMap[month] || 0) + orderRevenue;
    }
  });

  const products = Object.values(productMap).sort((a, b) => b.revenue - a.revenue);
  const topCustomers = Object.entries(customerMap)
    .map(([id, v]) => ({ id, name: customers.find((c) => c.id === id)?.name || "Unknown customer", ...v }))
    .sort((a, b) => b.revenue - a.revenue);
  const monthlyTrend = Object.entries(monthMap)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, revenue]) => ({ month, revenue: Math.round(revenue * 100) / 100 }));

  const totalRevenue = products.reduce((sum, p) => sum + p.revenue, 0);
  const totalCogs = products.reduce((sum, p) => sum + (p.hasCost ? p.cogs : 0), 0);
  const totalVolume = products.reduce((sum, p) => sum + p.qty, 0);
  const totalOrders = relevantOrders.filter((o) => (o.lines || []).some((l) => effectiveQty(l, o) > 0)).length;

  if (totalVolume === 0) {
    return (
      <div>
        <EmptyState icon={Truck} title="No fulfilled sales yet" subtitle="This fills in once orders start being marked fulfilled — draft and unfulfilled orders aren't counted, since nothing's actually gone out the door yet." />
      </div>
    );
  }

  const summaryCard = (label, value) => (
    <div style={{ background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "14px 16px", flex: 1, minWidth: 120 }}>
      <div style={{ fontSize: 10.5, letterSpacing: "0.05em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 4 }}>{label}</div>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 18, color: "#2A3324" }}>{value}</div>
    </div>
  );

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 22 }}>
        {summaryCard("Volume sold", `${totalVolume} units`)}
        {summaryCard("Orders", totalOrders)}
        {isOwner && summaryCard("Revenue", `$${totalRevenue.toFixed(2)}`)}
        {isOwner && summaryCard("Gross margin", totalCogs > 0 ? `$${(totalRevenue - totalCogs).toFixed(2)}` : "—")}
      </div>

      {isOwner && monthlyTrend.length > 1 && (
        <div style={{ background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "16px 12px 6px", marginBottom: 22 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 6, marginLeft: 8 }}>
            Revenue by month
          </div>
          <Suspense fallback={<div style={{ height: 160 }} />}>
            <ResponsiveContainer width="100%" height={160}>
              <LineChart data={monthlyTrend} margin={{ top: 5, right: 14, left: -14, bottom: 0 }}>
                <CartesianGrid stroke="#DDE0C8" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="month" stroke="#9BA88A" fontSize={11} />
                <YAxis stroke="#9BA88A" fontSize={11} />
                <Tooltip contentStyle={{ background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 4, fontSize: 12 }} labelStyle={{ color: "#5C6B54" }} />
                <Line type="monotone" dataKey="revenue" stroke="#5C9A3C" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </Suspense>
        </div>
      )}

      <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>
        Best-selling products
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 22 }}>
        {products.map((p) => (
          <div key={p.label} style={{ background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "10px 14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span style={{ color: "#2A3324", fontSize: 13.5 }}>{p.label}</span>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#5C6B54", fontSize: 12.5 }}>{p.qty} units</span>
            </div>
            {isOwner && (
              <div style={{ color: "#9BA88A", fontSize: 11.5, marginTop: 3 }}>
                ${p.revenue.toFixed(2)} revenue
                {p.hasCost ? ` · $${(p.revenue - p.cogs).toFixed(2)} margin (${((1 - p.cogs / p.revenue) * 100).toFixed(0)}%)` : " · margin unavailable"}
              </div>
            )}
          </div>
        ))}
      </div>

      <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>
        Top customers
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {topCustomers.map((c) => (
          <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "10px 14px" }}>
            <span style={{ color: "#2A3324", fontSize: 13.5 }}>{c.name}</span>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#5C6B54", fontSize: 12.5 }}>
              {isOwner ? `$${c.revenue.toFixed(2)} · ` : ""}{c.orders} order{c.orders !== 1 ? "s" : ""}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Tracks individual, physical kegs by number — separate from the
// existing volume-based container tracking, which stays unchanged.
// Lost kegs cost real money, so the point here is knowing which specific
// keg is where, not just how many litres went out in kegs overall.
// Numbers a batch of identical kegs at once — e.g. K-001 through K-050 —
// since that's how a brewery actually acquires and labels a keg fleet,
// rather than typing each one in individually.
export function AddKegsModal({ onClose, onSave }) {
  const [prefix, setPrefix] = useState("K-");
  const [startNumber, setStartNumber] = useState("1");
  const [count, setCount] = useState("1");
  const [padZeros, setPadZeros] = useState(true);
  const [sizeL, setSizeL] = useState("20");

  const preview = () => {
    const start = Number(startNumber) || 1;
    const n = Math.min(Number(count) || 1, 500);
    const width = padZeros ? String(start + n - 1).length : 0;
    const nums = [];
    for (let i = 0; i < Math.min(n, 3); i++) {
      const num = start + i;
      nums.push(`${prefix}${padZeros ? String(num).padStart(width, "0") : num}`);
    }
    return n > 3 ? `${nums.join(", ")}, … (${n} total)` : nums.join(", ");
  };

  const submit = () => {
    const start = Number(startNumber) || 1;
    const n = Math.min(Math.max(1, Number(count) || 1), 500);
    const size = Number(sizeL);
    if (!size || size <= 0) return;
    const width = padZeros ? String(start + n - 1).length : 0;
    const lines = [];
    for (let i = 0; i < n; i++) {
      const num = start + i;
      lines.push({ kegNumber: `${prefix}${padZeros ? String(num).padStart(width, "0") : num}`, sizeL: size });
    }
    onSave(lines);
    onClose();
  };

  return (
    <Modal title="Register kegs" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ color: "#5C6B54", fontSize: 13 }}>Numbers a batch of identical kegs at once — e.g. K-001 through K-050.</div>
        <TextField label="Number prefix" value={prefix} onChange={setPrefix} />
        <div style={{ display: "flex", gap: 10 }}>
          <NumberField label="Starting number" value={startNumber} onChange={setStartNumber} step="1" />
          <NumberField label="How many" value={count} onChange={setCount} step="1" />
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#5C6B54" }}>
          <input type="checkbox" checked={padZeros} onChange={(e) => setPadZeros(e.target.checked)} />
          Pad with zeros (K-001 instead of K-1)
        </label>
        <NumberField label="Keg size (L)" value={sizeL} onChange={setSizeL} step="0.1" />
        <div style={{ color: "#9BA88A", fontSize: 12, background: "#F8F5EA", border: "1px solid #EBE8D6", borderRadius: 5, padding: "8px 10px" }}>
          Will create: {preview()}
        </div>
        <button
          onClick={submit}
          style={{ background: "#5C9A3C", border: "none", borderRadius: 5, padding: "12px", color: "#16191A", fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 15, letterSpacing: "0.03em", cursor: "pointer" }}
        >
          Register kegs
        </button>
      </div>
    </Modal>
  );
}

export function KegDetail({ keg, batches, customers, onBack, onFill, onSend, onReturn, onMarkLost, onDelete }) {
  const [showFill, setShowFill] = useState(false);
  const [showSend, setShowSend] = useState(false);
  const [showReturn, setShowReturn] = useState(false);
  const [fillDate, setFillDate] = useState(today());
  const isOverdue = keg.dueBackDate && keg.dueBackDate < today();
  const eligibleBatches = batches.filter((b) => ["Brite Tank", "Packaged"].includes(b.stage) || b.stage === "Primary").slice(0, 50);

  return (
    <div>
      <button
        onClick={onBack}
        style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#5C6B54", cursor: "pointer", fontFamily: "'Inter', sans-serif", fontSize: 13, padding: 0, marginBottom: 18 }}
      >
        <ChevronLeft size={16} /> All kegs
      </button>

      <h1 style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 24, color: "#2A3324", margin: "0 0 4px" }}>{keg.kegNumber}</h1>
      <div style={{ color: "#5C6B54", fontSize: 14, marginBottom: 20 }}>{keg.sizeL}L</div>

      <div style={{ background: "#FFFFFF", border: isOverdue ? "1px solid #B5502F" : "1px solid #DDE0C8", borderRadius: 6, padding: "14px 16px", marginBottom: 20 }}>
        <div style={{ fontSize: 11, letterSpacing: "0.05em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 6 }}>Status</div>
        <div style={{ fontSize: 15, color: isOverdue ? "#B5502F" : "#2A3324", marginBottom: keg.currentBatchName || keg.currentCustomerName ? 8 : 0 }}>
          {keg.status}
          {isOverdue ? " — overdue" : ""}
        </div>
        {keg.currentBatchName && <div style={{ color: "#5C6B54", fontSize: 13 }}>Contents: {keg.currentBatchName}</div>}
        {keg.currentCustomerName && (
          <div style={{ color: "#5C6B54", fontSize: 13 }}>
            With: {keg.currentCustomerName}
            {keg.sentDate ? ` · sent ${keg.sentDate}` : ""}
            {keg.dueBackDate ? ` · due back ${keg.dueBackDate}` : ""}
          </div>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
        {keg.status === "In brewery" && (
          <button
            onClick={() => setShowFill(true)}
            style={{ background: "none", border: "1px solid #DDE0C8", borderRadius: 5, padding: "11px", color: "#5C6B54", fontFamily: "'Inter', sans-serif", fontSize: 13.5, cursor: "pointer" }}
          >
            {keg.currentBatchName ? "Change contents" : "Log what's filled in it"}
          </button>
        )}
        {keg.status === "In brewery" && (
          <button
            onClick={() => setShowSend(true)}
            style={{ background: "#5C9A3C", border: "none", borderRadius: 5, padding: "11px", color: "#16191A", fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 13.5, cursor: "pointer" }}
          >
            Send to a customer
          </button>
        )}
        {keg.status === "With customer" && (
          <button
            onClick={() => setShowReturn(true)}
            style={{ background: "#5C9A3C", border: "none", borderRadius: 5, padding: "11px", color: "#16191A", fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 13.5, cursor: "pointer" }}
          >
            Mark returned
          </button>
        )}
        {keg.status !== "Lost" && (
          <button
            onClick={() => onMarkLost(keg.id)}
            style={{ background: "none", border: "1px solid #DDE0C8", borderRadius: 5, padding: "11px", color: "#B5502F", fontFamily: "'Inter', sans-serif", fontSize: 13.5, cursor: "pointer" }}
          >
            Mark as lost
          </button>
        )}
      </div>

      {keg.history && keg.history.length > 0 && (
        <div>
          <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>History</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 20 }}>
            {[...keg.history].reverse().map((h) => (
              <div key={h.id} style={{ background: "#F8F5EA", border: "1px solid #EBE8D6", borderRadius: 5, padding: "8px 12px" }}>
                <div style={{ color: "#2A3324", fontSize: 13 }}>{h.note}</div>
                <div style={{ color: "#9BA88A", fontSize: 11, marginTop: 2 }}>{formatHistoryStamp(h.date)}{h.user ? ` · ${h.user}` : ""}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {onDelete && (
        <button
          onClick={() => onDelete(keg)}
          style={{ width: "100%", background: "none", border: "1px solid #E3D3A0", borderRadius: 5, padding: "11px", color: "#5C9A3C", fontFamily: "'Inter', sans-serif", fontSize: 13, cursor: "pointer" }}
        >
          Delete keg record
        </button>
      )}

      {showFill && (
        <Modal title="What's filled in this keg?" onClose={() => setShowFill(false)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <BackdateField value={fillDate} onChange={setFillDate} label="Filled on" />
            {eligibleBatches.length === 0 && <div style={{ color: "#9BA88A", fontSize: 13 }}>No packaged batches available to pick from.</div>}
            {eligibleBatches.map((b) => (
              <button
                key={b.id}
                onClick={() => {
                  onFill(keg.id, b.id, b.name, fillDate);
                  setShowFill(false);
                  setFillDate(today());
                }}
                style={{ textAlign: "left", background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 5, padding: "10px 12px", color: "#2A3324", fontSize: 13.5, cursor: "pointer" }}
              >
                {b.name} <span style={{ color: "#9BA88A", fontFamily: "'JetBrains Mono', monospace", fontSize: 11.5 }}>#{b.number}</span>
              </button>
            ))}
          </div>
        </Modal>
      )}

      {showReturn && <StageDateModal title="Mark keg returned" confirmLabel="Mark returned" onClose={() => setShowReturn(false)} onConfirm={(d) => onReturn(keg.id, d)} />}
      {showSend && <SendKegModal customers={customers} onClose={() => setShowSend(false)} onSave={(customerId, customerName, dueBackDate, sentOn) => { onSend(keg.id, customerId, customerName, dueBackDate, sentOn); setShowSend(false); }} />}
    </div>
  );
}

export function SendKegModal({ customers, onClose, onSave }) {
  const [customerId, setCustomerId] = useState("");
  const [dueBackDate, setDueBackDate] = useState("");
  const [sentOn, setSentOn] = useState(today());

  const submit = () => {
    const customer = customers.find((c) => c.id === customerId);
    if (!customer) return;
    onSave(customerId, customer.name, dueBackDate || null, sentOn);
  };

  return (
    <Modal title="Send keg to a customer" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B54" }}>Customer</span>
          <select
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            style={{ width: "100%", boxSizing: "border-box", background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 4, padding: "9px 10px", color: "#2A3324", fontFamily: "'Inter', sans-serif", fontSize: 14 }}
          >
            <option value="">Choose a customer…</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <BackdateField value={sentOn} onChange={setSentOn} label="Date sent" />
        <TextField label="Expected back by (optional)" type="date" value={dueBackDate} onChange={setDueBackDate} />
        <button
          onClick={submit}
          disabled={!customerId}
          style={{ background: customerId ? "#5C9A3C" : "#E8E4D4", border: "none", borderRadius: 5, padding: "12px", color: customerId ? "#16191A" : "#A3AC94", fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 15, cursor: customerId ? "pointer" : "default" }}
        >
          Send keg
        </button>
      </div>
    </Modal>
  );
}

export function KegsView({ kegs, onOpen, onAddNew }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const filtered = kegs.filter(
    (k) => !q || k.kegNumber.toLowerCase().includes(q) || (k.currentCustomerName || "").toLowerCase().includes(q) || (k.currentBatchName || "").toLowerCase().includes(q)
  );

  const inBrewery = filtered.filter((k) => k.status === "In brewery");
  const withCustomer = filtered.filter((k) => k.status === "With customer");
  const lost = filtered.filter((k) => k.status === "Lost");

  const isOverdue = (k) => k.dueBackDate && k.dueBackDate < today();

  const kegRow = (k) => (
    <div
      key={k.id}
      onClick={() => onOpen(k)}
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "12px 14px",
        background: "#FFFFFF",
        border: isOverdue(k) ? "1px solid #B5502F" : "1px solid #DDE0C8",
        borderRadius: 6,
        cursor: "pointer",
      }}
    >
      <div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", color: "#2A3324", fontSize: 14 }}>
          {k.kegNumber} <span style={{ color: "#9BA88A", fontSize: 12 }}>· {k.sizeL}L</span>
        </div>
        {k.currentBatchName && <div style={{ color: "#5C6B54", fontSize: 12.5, marginTop: 2 }}>{k.currentBatchName}</div>}
        {k.currentCustomerName && (
          <div style={{ color: isOverdue(k) ? "#B5502F" : "#5C6B54", fontSize: 12.5, marginTop: 2 }}>
            With {k.currentCustomerName}
            {k.dueBackDate ? ` · due back ${k.dueBackDate}${isOverdue(k) ? " (overdue)" : ""}` : ""}
          </div>
        )}
      </div>
      <ChevronLeft size={16} color="#9BA88A" style={{ transform: "rotate(180deg)" }} />
    </div>
  );

  return (
    <div>
      <button
        onClick={onAddNew}
        style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 7, background: "none", border: "1px dashed #C9D1AC", borderRadius: 5, padding: "10px", color: "#5C6B54", fontFamily: "'Inter', sans-serif", fontSize: 13, cursor: "pointer", marginBottom: 14 }}
      >
        <Plus size={14} /> Register kegs
      </button>
      {kegs.length > 5 && (
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search kegs…"
          style={{ width: "100%", boxSizing: "border-box", background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 5, padding: "10px 12px", color: "#2A3324", fontFamily: "'Inter', sans-serif", fontSize: 14, marginBottom: 16 }}
        />
      )}

      {kegs.length === 0 ? (
        <EmptyState icon={Box} title="No kegs registered yet" subtitle="Register your keg fleet by number to start tracking which ones are out with customers." action={{ label: "Register kegs", onClick: onAddNew }} />
      ) : (
        <>
          {withCustomer.length > 0 && (
            <>
              <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 8 }}>
                With customers ({withCustomer.length})
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 22 }}>{withCustomer.map(kegRow)}</div>
            </>
          )}
          {inBrewery.length > 0 && (
            <>
              <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 8 }}>
                In brewery ({inBrewery.length})
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 22 }}>{inBrewery.map(kegRow)}</div>
            </>
          )}
          {lost.length > 0 && (
            <>
              <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 8 }}>
                Lost ({lost.length})
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>{lost.map(kegRow)}</div>
            </>
          )}
          {filtered.length === 0 && q && <div style={{ color: "#9BA88A", fontSize: 13, textAlign: "center", padding: "24px 0" }}>No kegs match "{query}".</div>}
        </>
      )}
    </div>
  );
}

export function SalesOrdersView({ salesOrders, customers, onOpen }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const customerName = (id) => customers.find((c) => c.id === id)?.name || "Unknown customer";
  const matches = (o) => !q || customerName(o.customerId).toLowerCase().includes(q) || (o.orderNumber || "").toLowerCase().includes(q);

  const draft = salesOrders.filter((o) => o.status === "Draft" && matches(o));
  const confirmed = salesOrders.filter((o) => o.status === "Confirmed" && matches(o));
  const partiallyFulfilled = salesOrders.filter((o) => o.status === "Partially fulfilled" && matches(o));
  const fulfilled = salesOrders.filter((o) => o.status === "Fulfilled" && matches(o));
  const cancelled = salesOrders.filter((o) => o.status === "Cancelled" && matches(o));

  const section = (title, list) =>
    list.length > 0 && (
      <div style={{ marginBottom: 22 }}>
        <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>
          {title} ({list.length})
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {list.map((o) => (
            <SalesOrderCard key={o.id} order={o} customerName={customerName(o.customerId)} onOpen={onOpen} />
          ))}
        </div>
      </div>
    );

  return (
    <div>
      {salesOrders.length > 0 && (
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search orders by number or customer…"
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
            marginBottom: 16,
          }}
        />
      )}
      {section("Draft", draft)}
      {section("Confirmed", confirmed)}
      {section("Partially fulfilled", partiallyFulfilled)}
      {section("Fulfilled", fulfilled)}
      {section("Cancelled", cancelled)}
      {salesOrders.length === 0 && (
        <EmptyState icon={Truck} title="No orders yet" subtitle="Create an order against a customer once you've got stock packaged and ready to sell." />
      )}
      {salesOrders.length > 0 && draft.length === 0 && confirmed.length === 0 && partiallyFulfilled.length === 0 && fulfilled.length === 0 && cancelled.length === 0 && (
        <div style={{ color: "#9BA88A", fontSize: 13, textAlign: "center", padding: "24px 0" }}>No orders match "{query}".</div>
      )}
    </div>
  );
}

// Lets each line be fulfilled by whatever amount is actually shipping
// right now — not all-or-nothing. Leftover on any line stays open as a
// genuine backorder rather than forcing the whole order to wait until
// every line is ready at once.
// A simple, touch-first signature pad. Uses pointer events specifically
// rather than mouse events — the standard mouse/touch drag approach
// doesn't reliably fire from a genuine finger touch on iPad, only from
// an actual mouse or trackpad, which would make this silently useless
// for how this app is actually used day to day.
export function SignatureCanvas({ onChange }) {
  const canvasRef = useRef(null);
  const isDrawingRef = useRef(false);
  const lastPointRef = useRef(null);
  const [hasDrawn, setHasDrawn] = useState(false);

  const getPos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const handlePointerDown = (e) => {
    canvasRef.current.setPointerCapture(e.pointerId);
    isDrawingRef.current = true;
    lastPointRef.current = getPos(e);
  };
  const handlePointerMove = (e) => {
    if (!isDrawingRef.current) return;
    const ctx = canvasRef.current.getContext("2d");
    const pos = getPos(e);
    ctx.strokeStyle = "#2A3324";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(lastPointRef.current.x, lastPointRef.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    lastPointRef.current = pos;
    if (!hasDrawn) setHasDrawn(true);
  };
  const handlePointerUp = () => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    onChange(canvasRef.current.toDataURL("image/png"));
  };
  const clear = () => {
    const ctx = canvasRef.current.getContext("2d");
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    setHasDrawn(false);
    onChange(null);
  };

  return (
    <div>
      <canvas
        ref={canvasRef}
        width={400}
        height={150}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{ touchAction: "none", border: "1px solid #DDE0C8", borderRadius: 5, background: "#FFFFFF", width: "100%", height: 150, cursor: "crosshair" }}
      />
      {hasDrawn && (
        <button onClick={clear} style={{ background: "none", border: "none", color: "#9BA88A", fontSize: 11.5, cursor: "pointer", padding: "6px 0 0" }}>
          Clear and redo
        </button>
      )}
    </div>
  );
}

export function RecordFulfillmentModal({ order, onClose, onSave }) {
  const [amounts, setAmounts] = useState(() => {
    const init = {};
    (order.lines || []).forEach((l) => {
      const remaining = (l.qty || 0) - (l.fulfilledQty || 0);
      init[l.id] = remaining > 0 ? String(remaining) : "0";
    });
    return init;
  });
  const [receivedBy, setReceivedBy] = useState("");
  const [signature, setSignature] = useState(null);
  const [date, setDate] = useState(today());

  const submit = () => {
    const fulfillingNow = (order.lines || [])
      .map((l) => {
        const remaining = (l.qty || 0) - (l.fulfilledQty || 0);
        const fulfillNow = Math.max(0, Math.min(Number(amounts[l.id]) || 0, remaining));
        return { ...l, fulfillNow };
      })
      .filter((l) => l.fulfillNow > 0);
    if (fulfillingNow.length === 0) return;
    const pod = receivedBy.trim() || signature ? { receivedBy: receivedBy.trim() || null, signature: signature || null, date } : null;
    onSave(fulfillingNow, pod, date);
    onClose();
  };

  return (
    <Modal title={`Record fulfillment — ${order.orderNumber}`} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ color: "#5C6B54", fontSize: 13 }}>
          Enter how much of each line is going out right now — leave the rest for later if it's a partial delivery.
        </div>
        <BackdateField value={date} onChange={setDate} label="Delivery date" />
        {(order.lines || []).map((l) => {
          const remaining = (l.qty || 0) - (l.fulfilledQty || 0);
          return (
            <div key={l.id} style={{ background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 6, padding: "12px" }}>
              <div style={{ color: "#2A3324", fontSize: 13.5, marginBottom: 4 }}>
                {l.mixedPackTypeId ? l.mixedPackTypeName : `${l.batchName} — ${l.containerLabel}`}
              </div>
              <div style={{ color: "#9BA88A", fontSize: 11.5, marginBottom: 8 }}>
                Ordered {l.qty}
                {(l.fulfilledQty || 0) > 0 ? ` · ${l.fulfilledQty} already fulfilled · ${remaining} remaining` : ""}
              </div>
              {remaining > 0 ? (
                <NumberField label="Fulfill now" value={amounts[l.id]} onChange={(v) => setAmounts((prev) => ({ ...prev, [l.id]: v }))} step="1" />
              ) : (
                <div style={{ color: "#5C9A3C", fontSize: 12.5 }}>Fully fulfilled already</div>
              )}
            </div>
          );
        })}

        <div style={{ borderTop: "1px solid #DDE0C8", paddingTop: 14 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>
            Proof of delivery (optional)
          </div>
          <TextField label="Received by" value={receivedBy} onChange={setReceivedBy} placeholder="Name of whoever accepted the delivery" />
          <div style={{ marginTop: 10 }}>
            <span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B54", display: "block", marginBottom: 5 }}>Signature</span>
            <SignatureCanvas onChange={setSignature} />
          </div>
        </div>

        <button
          onClick={submit}
          style={{ background: "#5C9A3C", border: "none", borderRadius: 5, padding: "12px", color: "#16191A", fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 15, letterSpacing: "0.03em", cursor: "pointer" }}
        >
          Save fulfillment
        </button>
      </div>
    </Modal>
  );
}

// A clean, professional document for a sales order — titled "Quote" while
// still a Draft (nothing's been committed to yet), "Order Confirmation"
// once it's Confirmed or further along. Gives wholesale accounts that
// negotiate before committing something real to send, without needing a
// separate quoting system — the same order just gets confirmed once
// they agree, no re-entry.
export function PrintableOrderModal({ order, customer, companyName, onClose }) {
  const total = salesOrderTotal(order);
  const isQuote = order.status === "Draft";

  return createPortal(
    <div id="order-print" style={{ position: "fixed", inset: 0, zIndex: 200, background: "#F5F1E4", overflowY: "auto" }}>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #order-print, #order-print * { visibility: visible; }
          #order-print { position: absolute; top: 0; left: 0; width: 100%; background: #FFFFFF; }
          .no-print { display: none !important; }
        }
      `}</style>

      <div className="no-print" style={{ position: "sticky", top: 0, background: "#F5F1E4", borderBottom: "1px solid #DDE0C8", padding: "14px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", zIndex: 1 }}>
        <button
          onClick={onClose}
          style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#5C6B54", cursor: "pointer", fontFamily: "'Inter', sans-serif", fontSize: 13.5 }}
        >
          <X size={16} /> Close
        </button>
        <button
          onClick={() => window.print()}
          style={{ background: "#5C9A3C", border: "none", borderRadius: 5, padding: "9px 16px", color: "#16191A", fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 13.5, cursor: "pointer" }}
        >
          Print / Save as PDF
        </button>
      </div>

      <div style={{ maxWidth: 640, margin: "0 auto", padding: "36px 28px 60px", color: "#1A1F16" }}>
        <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 13, letterSpacing: "0.08em", textTransform: "uppercase", color: "#5C6B54" }}>
          {companyName || "Brewery"}
        </div>
        <h1 style={{ fontFamily: "'Oswald', sans-serif", fontSize: 26, fontWeight: 500, margin: "4px 0 6px" }}>
          {isQuote ? "Quote" : "Order Confirmation"}
        </h1>
        <div style={{ fontSize: 13, color: "#5C6B54", marginBottom: 6 }}>
          {order.orderNumber} · {order.orderDate}
        </div>
        {isQuote && (
          <div style={{ fontSize: 12.5, color: "#9BA88A", marginBottom: 22 }}>
            This is a quote, not a tax invoice — pricing may change if it isn't confirmed promptly.
          </div>
        )}
        {!isQuote && <div style={{ marginBottom: 22 }} />}

        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.05em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 4 }}>Billed to</div>
          <div style={{ fontSize: 14 }}>{customer?.name || "—"}</div>
          {customer?.email && <div style={{ fontSize: 13, color: "#5C6B54" }}>{customer.email}</div>}
        </div>

        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5, marginBottom: 20 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #DDE0C8", textAlign: "left" }}>
              <th style={{ padding: "6px 4px", fontWeight: 500, color: "#5C6B54" }}>Item</th>
              <th style={{ padding: "6px 4px", fontWeight: 500, color: "#5C6B54", textAlign: "right" }}>Qty</th>
              <th style={{ padding: "6px 4px", fontWeight: 500, color: "#5C6B54", textAlign: "right" }}>Price</th>
              <th style={{ padding: "6px 4px", fontWeight: 500, color: "#5C6B54", textAlign: "right" }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {(order.lines || []).map((l) => (
              <tr key={l.id} style={{ borderBottom: "1px solid #EBE8D6" }}>
                <td style={{ padding: "8px 4px" }}>{l.mixedPackTypeId ? l.mixedPackTypeName : `${l.batchName} — ${l.containerLabel}`}</td>
                <td style={{ padding: "8px 4px", textAlign: "right" }}>{l.qty}</td>
                <td style={{ padding: "8px 4px", textAlign: "right" }}>${Number(l.unitPrice).toFixed(2)}</td>
                <td style={{ padding: "8px 4px", textAlign: "right" }}>${(l.qty * l.unitPrice).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 24 }}>
          <div style={{ fontSize: 16, fontFamily: "'JetBrains Mono', monospace" }}>Total: ${total.toFixed(2)}</div>
        </div>

        {order.notes && (
          <div>
            <div style={{ fontSize: 11, letterSpacing: "0.05em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 4 }}>Notes</div>
            <div style={{ fontSize: 13, color: "#5C6B54" }}>{order.notes}</div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

export function SalesOrderDetail({ order, customer, onBack, onAdvance, onCancel, onTogglePaid, onDelete, onRecordFulfillment, onPrint }) {
  const total = salesOrderTotal(order);
  const nextStatus = order.status === "Draft" ? "Confirmed" : null;
  const canFulfill = order.status === "Confirmed" || order.status === "Partially fulfilled";
  // Invoices raised in Xero: Xero is in charge of them, so they're read-only here.
  const fromXero = order.source === "xero";

  return (
    <div>
      <button
        onClick={onBack}
        style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#5C6B54", cursor: "pointer", fontFamily: "'Inter', sans-serif", fontSize: 13, padding: 0, marginBottom: 18 }}
      >
        <ChevronLeft size={16} /> All orders
      </button>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#9BA88A", fontSize: 14 }}>{order.orderNumber}</span>
        <h1 style={{ fontFamily: "'Oswald', sans-serif", fontSize: 22, color: "#2A3324", margin: 0 }}>{customer ? customer.name : "Unknown customer"}</h1>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
        <SalesOrderStatusPill status={order.status} />
        <span style={{ color: "#9BA88A", fontSize: 12.5 }}>{order.orderDate}</span>
        {order.paid && <span style={{ color: "#5C9A3C", fontSize: 12.5, fontWeight: 500 }}>Paid</span>}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
        {(order.lines || []).map((l) => (
          <div key={l.id} style={{ padding: "10px 12px", background: "#F8F5EA", border: "1px solid #EBE8D6", borderRadius: 5, fontSize: 13.5, color: "#2A3324" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>
                {l.mixedPackTypeId ? l.mixedPackTypeName : `${l.batchName} — ${l.containerLabel}`}
                {l.batchNumber ? <span style={{ color: "#9BA88A" }}> · batch #{l.batchNumber}</span> : null}
                {fromXero && l.noBatch ? <span style={{ color: "#B5502F" }}> · batch not recorded</span> : null}
              </span>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#5C6B54" }}>
                {l.qty} × ${Number(l.unitPrice).toFixed(2)} = ${(l.qty * l.unitPrice).toFixed(2)}
              </span>
            </div>
            {(l.fulfilledQty || 0) > 0 && (l.fulfilledQty || 0) < l.qty && (
              <div style={{ color: "#4AA8C9", fontSize: 11.5, marginTop: 3 }}>
                {l.fulfilledQty} of {l.qty} fulfilled — {l.qty - l.fulfilledQty} still owed
              </div>
            )}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, fontFamily: "'Oswald', sans-serif", fontWeight: 500, color: "#2A3324", marginBottom: 20, padding: "0 4px" }}>
        <span>Total</span>
        <span>${total.toFixed(2)}</span>
      </div>

      {order.notes && (
        <div style={{ color: "#5C6B54", fontSize: 13, marginBottom: 20, background: "#F8F5EA", border: "1px solid #EBE8D6", borderRadius: 5, padding: "10px 12px" }}>
          {order.notes}
        </div>
      )}

      {fromXero && (
        <div style={{ color: "#5C6B54", fontSize: 12.5, marginBottom: 16, background: "#EEF4F8", border: "1px solid #C9DCE6", borderRadius: 5, padding: "10px 12px", lineHeight: 1.5 }}>
          This is a Xero invoice. Change or void it in Xero and Brewpoint follows. Stock for it was already taken off by the Xero sync.
        </div>
      )}

      {order.status !== "Cancelled" && !fromXero && (
        <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
          {nextStatus && (
            <button
              onClick={() => onAdvance(order.id, nextStatus)}
              style={{ flex: 1, background: "#5C9A3C", border: "none", borderRadius: 5, padding: "11px", color: "#16191A", fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 13.5, cursor: "pointer" }}
            >
              Confirm order
            </button>
          )}
          {canFulfill && (
            <button
              onClick={() => onRecordFulfillment(order)}
              style={{ flex: 1, background: "#5C9A3C", border: "none", borderRadius: 5, padding: "11px", color: "#16191A", fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 13.5, cursor: "pointer" }}
            >
              Record fulfillment
            </button>
          )}
          <button
            onClick={() => onTogglePaid(order.id, !order.paid)}
            style={{ flex: 1, background: "#EBE8D6", border: "1px solid #C9D1AC", borderRadius: 5, padding: "11px", color: "#2A3324", fontFamily: "'Inter', sans-serif", fontSize: 13.5, cursor: "pointer" }}
          >
            {order.paid ? "Mark unpaid" : "Mark paid"}
          </button>
        </div>
      )}

      {(order.proofsOfDelivery || []).length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>
            Proof of delivery
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {[...order.proofsOfDelivery].reverse().map((p) => (
              <div key={p.id} style={{ background: "#F8F5EA", border: "1px solid #EBE8D6", borderRadius: 6, padding: "12px 14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: p.signature ? 8 : 0 }}>
                  <span style={{ color: "#2A3324", fontSize: 13 }}>{p.receivedBy || "Received"}</span>
                  <span style={{ color: "#9BA88A", fontSize: 11.5, fontFamily: "'JetBrains Mono', monospace" }}>{p.date}</span>
                </div>
                {p.signature && (
                  <img src={p.signature} alt="Delivery signature" style={{ width: "100%", maxWidth: 300, height: "auto", background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 4 }} />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
        <button
          onClick={() => onPrint(order)}
          style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, background: "none", border: "1px solid #DDE0C8", borderRadius: 5, padding: "11px", color: "#5C6B54", fontFamily: "'Inter', sans-serif", fontSize: 13, cursor: "pointer" }}
        >
          <FileText size={14} /> {order.status === "Draft" ? "Print quote" : "Print / Save as PDF"}
        </button>
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        {order.status !== "Cancelled" && order.status !== "Fulfilled" && !fromXero && (
          <button
            onClick={() => onCancel(order.id)}
            style={{ flex: 1, background: "none", border: "1px solid #DDE0C8", borderRadius: 5, padding: "11px", color: "#B5502F", fontFamily: "'Inter', sans-serif", fontSize: 13.5, cursor: "pointer" }}
          >
            Cancel order
          </button>
        )}
        {onDelete && !fromXero && (
          <button
            onClick={() => onDelete(order)}
            style={{ background: "none", border: "1px solid #DDE0C8", borderRadius: 5, padding: "11px 16px", color: "#5C6B54", fontFamily: "'Inter', sans-serif", fontSize: 13.5, cursor: "pointer" }}
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}
